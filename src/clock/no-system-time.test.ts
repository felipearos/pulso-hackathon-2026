import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Domain time comes from the demo clock (ADR 0002); only the system clock
// adapter may read the machine's time.
const SRC = join(import.meta.dir, "..");
const ALLOWED = new Set(["real-ports.ts"]);
const SYSTEM_TIME = [/Date\.now\s*\(/, /new\s+Date\s*\(\s*\)/, /new\s+Date\b(?!\s*\()/, /(?<![\w.]|new\s)Date\s*\(/];
// `ports.clock` is the raw source without the demo offset; only the factories wire it.
const RAW_CLOCK = /\bports\.clock\b/;
const RAW_CLOCK_ALLOWED = new Set(["app.ts", "testing.ts", "real-ports.ts"]);

function isComment(line: string): boolean {
  const code = line.trimStart();
  return code.startsWith("//") || code.startsWith("*") || code.startsWith("/*");
}

function readsSystemTime(line: string): boolean {
  return !isComment(line) && SYSTEM_TIME.some((pattern) => pattern.test(line));
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
    expect(readsSystemTime("const stamp = Date();")).toBe(true);
    expect(readsSystemTime("Date.UTC(2026, 9, 22)")).toBe(false);
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

  test("only the app factories read the raw clock port", () => {
    const offenders: string[] = [];
    for (const file of new Bun.Glob("**/*.ts").scanSync(SRC)) {
      if (file.endsWith(".test.ts") || RAW_CLOCK_ALLOWED.has(file)) continue;
      readFileSync(join(SRC, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (!isComment(line) && RAW_CLOCK.test(line)) offenders.push(`src/${file}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
