import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase, type Migration } from "./db";

const steps: Migration[] = [
  { version: 1, name: "notes", sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)" },
  { version: 2, name: "notes_tag", sql: "ALTER TABLE notes ADD COLUMN tag TEXT" },
];

describe("migrate", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("applies pending steps in version order", () => {
    const db = openDatabase(":memory:");
    expect(migrate(db, [steps[1]!, steps[0]!])).toEqual([1, 2]);
    db.run("INSERT INTO notes (body, tag) VALUES ('hola', 'x')");
  });

  test("is idempotent on an existing file and keeps its rows", () => {
    dir = mkdtempSync(join(tmpdir(), "pulso-db-"));
    const path = join(dir, "nested", "pulso.db");

    const first = openDatabase(path);
    expect(migrate(first, [steps[0]!])).toEqual([1]);
    first.run("INSERT INTO notes (body) VALUES ('noche 1')");
    first.close();

    const second = openDatabase(path);
    expect(migrate(second, steps)).toEqual([2]);
    expect(migrate(second, steps)).toEqual([]);
    expect(second.query<{ body: string }, []>("SELECT body FROM notes").all()).toEqual([{ body: "noche 1" }]);
    second.close();
  });

  test("a failing step leaves no trace and is retried next time", () => {
    const db = openDatabase(":memory:");
    const broken: Migration = { version: 1, name: "broken", sql: "CREATE TABLE oops (" };
    expect(() => migrate(db, [broken])).toThrow();
    expect(migrate(db, [steps[0]!])).toEqual([1]);
  });
});
