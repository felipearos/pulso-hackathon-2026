import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Domain time comes from the reloj de demo (ADR 0002); only the system clock
// adapter may read the machine's time.
const SRC = join(import.meta.dir, "..");
const ALLOWED = new Set(["real-ports.ts"]);
const SYSTEM_TIME = [/Date\.now\s*\(/, /new\s+Date\s*\(\s*\)/, /new\s+Date\b(?!\s*\()/];

function readsSystemTime(line: string): boolean {
  const code = line.trimStart();
  if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return false;
  return SYSTEM_TIME.some((pattern) => pattern.test(code));
}

describe("no system time", () => {
  test("the matcher flags system time reads and accepts dates built from a value", () => {
    expect(readsSystemTime("Date.now()")).toBe(true);
    expect(readsSystemTime("new Date()")).toBe(true);
    expect(readsSystemTime("new Date")).toBe(true);
    expect(readsSystemTime("new Date(ms)")).toBe(false);
    expect(readsSystemTime('new Date("2026-10-22")')).toBe(false);
    expect(readsSystemTime("// new Date()")).toBe(false);
    expect(readsSystemTime(" * Date.now()")).toBe(false);
  });

  test("no source file outside the system clock adapter reads system time", () => {
    const offenders: string[] = [];
    for (const file of new Bun.Glob("**/*.ts").scanSync(SRC)) {
      if (file.endsWith(".test.ts") || ALLOWED.has(file)) continue;
      readFileSync(join(SRC, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (readsSystemTime(line)) offenders.push(`src/${file}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
