import { describe, expect, test } from "bun:test";
import { santiagoParts } from "../clock/santiago";
import { findMomento, GUION, parseGuion } from "./guion";

const VALID = { id: "jue-2230", label: "Jue 22:30", at: "2026-10-22T22:30" };

describe("guion", () => {
  test("the shipped guion parses and holds Thursday 22:30 in Santiago", () => {
    expect(GUION.length).toBeGreaterThan(0);
    const momento = findMomento(GUION, "jue-2230");
    expect(momento).not.toBeNull();
    const parts = santiagoParts(momento!.at);
    expect(parts.weekday).toBe(4);
    expect(parts.hour).toBe(22);
    expect(parts.minute).toBe(30);
  });

  test("parseGuion rejects a non-array", () => {
    expect(() => parseGuion({ momentos: [VALID] })).toThrow();
  });

  test("parseGuion rejects an empty array", () => {
    expect(() => parseGuion([])).toThrow();
  });

  test("parseGuion rejects an entry without a label", () => {
    expect(() => parseGuion([{ id: "jue-2230", at: "2026-10-22T22:30" }])).toThrow(/jue-2230/);
  });

  test("parseGuion rejects an at with an offset", () => {
    expect(() => parseGuion([{ ...VALID, at: "2026-10-22T22:30Z" }])).toThrow(/jue-2230/);
  });

  test("parseGuion rejects a duplicate id", () => {
    expect(() => parseGuion([VALID, { ...VALID, label: "Otra vez" }])).toThrow(/repeats the id jue-2230/);
  });

  test("findMomento returns null for an unknown id", () => {
    expect(findMomento(GUION, "vie-1200")).toBeNull();
  });
});
