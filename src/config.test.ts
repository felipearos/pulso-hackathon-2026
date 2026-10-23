import { describe, expect, test } from "bun:test";
import { databasePath } from "./config";

describe("databasePath", () => {
  test("uses DATABASE_PATH when set", () => {
    expect(databasePath({ DATABASE_PATH: "/data/pulso.db" })).toBe("/data/pulso.db");
  });

  test("falls back to a local file", () => {
    expect(databasePath({})).toBe("data/pulso.db");
    expect(databasePath({ DATABASE_PATH: "" })).toBe("data/pulso.db");
  });
});
