import { describe, expect, test } from "bun:test";
import { fromSantiago, parseSantiago, santiagoDate, santiagoParts } from "./santiago";

const HOUR_MS = 60 * 60 * 1000;

/** Santiago's UTC offset at `iso`, in hours, as Intl reports it. */
function offsetHours(iso: string): number {
  const instant = new Date(iso);
  const p = santiagoParts(instant);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime()) / HOUR_MS;
}

describe("santiagoParts", () => {
  test("reads the wall clock and weekday in Santiago", () => {
    // Thursday 22 October 2026, 22:30 in Santiago (-03).
    expect(santiagoParts(new Date("2026-10-23T01:30:15Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 22,
      hour: 22,
      minute: 30,
      second: 15,
      weekday: 4,
    });
  });

  test("uses 0 for midnight, not 24", () => {
    expect(santiagoParts(new Date("2026-10-23T03:00:00Z")).hour).toBe(0);
  });
});

describe("santiagoDate", () => {
  test("changes day at Santiago midnight, not UTC midnight", () => {
    expect(santiagoDate(new Date("2026-10-23T02:59:59Z"))).toBe("2026-10-22");
    expect(santiagoDate(new Date("2026-10-23T03:00:00Z"))).toBe("2026-10-23");
  });
});

describe("fromSantiago", () => {
  test("resolves a plain wall time", () => {
    expect(fromSantiago({ year: 2026, month: 10, day: 22, hour: 22, minute: 30 }).toISOString()).toBe(
      "2026-10-23T01:30:00.000Z",
    );
    expect(fromSantiago({ year: 2026, month: 7, day: 1 }).toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });

  test("moves a time skipped when DST starts forward by the gap", () => {
    // Intl confirms the jump: -04 until 04:00Z on 2026-09-06, -03 from then.
    expect(offsetHours("2026-09-06T03:59:59Z")).toBe(-4);
    expect(offsetHours("2026-09-06T04:00:00Z")).toBe(-3);
    expect(santiagoParts(new Date("2026-09-06T04:00:00Z"))).toMatchObject({ day: 6, hour: 1, minute: 0 });

    const skipped = fromSantiago({ year: 2026, month: 9, day: 6, hour: 0, minute: 30 });
    expect(skipped.toISOString()).toBe("2026-09-06T04:30:00.000Z");
    expect(santiagoParts(skipped)).toMatchObject({ day: 6, hour: 1, minute: 30 });
    expect(fromSantiago({ year: 2026, month: 9, day: 6, hour: 1 }).toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });

  test("picks the earlier instant for a time repeated when DST ends", () => {
    // Intl confirms the fall back: -03 until 03:00Z on 2026-04-05, -04 from then,
    // so 23:00-23:59 on Saturday 4 April happens twice.
    expect(offsetHours("2026-04-05T02:59:59Z")).toBe(-3);
    expect(offsetHours("2026-04-05T03:00:00Z")).toBe(-4);
    expect(santiagoParts(new Date("2026-04-05T02:30:00Z"))).toMatchObject({ day: 4, hour: 23, minute: 30 });
    expect(santiagoParts(new Date("2026-04-05T03:30:00Z"))).toMatchObject({ day: 4, hour: 23, minute: 30 });

    expect(fromSantiago({ year: 2026, month: 4, day: 4, hour: 23, minute: 30 }).toISOString()).toBe(
      "2026-04-05T02:30:00.000Z",
    );
    expect(fromSantiago({ year: 2026, month: 4, day: 5 }).toISOString()).toBe("2026-04-05T04:00:00.000Z");
  });

  test("rejects an impossible wall time", () => {
    expect(() => fromSantiago({ year: 2026, month: 2, day: 30 })).toThrow(RangeError);
    expect(() => fromSantiago({ year: 2026, month: 10, day: 22, hour: 24 })).toThrow(RangeError);
  });
});

describe("parseSantiago", () => {
  test("parses a wall time with and without seconds", () => {
    expect(parseSantiago("2026-10-22T22:30").toISOString()).toBe("2026-10-23T01:30:00.000Z");
    expect(parseSantiago("2026-10-22T22:30:45").toISOString()).toBe("2026-10-23T01:30:45.000Z");
  });

  test("rejects offsets, Z and malformed text", () => {
    for (const text of [
      "2026-10-22T22:30Z",
      "2026-10-22T22:30:00-03:00",
      "2026-10-22T22:30+00:00",
      "2026-10-22",
      "2026-10-22 22:30",
      "22/10/2026 22:30",
      "2026-13-01T00:00",
      "2026-10-22T25:00",
      "",
    ]) {
      expect(() => parseSantiago(text)).toThrow(RangeError);
    }
  });
});
