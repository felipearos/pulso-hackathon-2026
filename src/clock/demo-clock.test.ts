import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase } from "../db";
import { FakeClock } from "../fakes";
import { createDemoClock } from "./demo-clock";
import { parseSantiago } from "./santiago";

const MINUTE_MS = 60 * 1000;
const REAL = new Date("2026-10-23T15:00:00Z");

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const source = new FakeClock(REAL);
  return { db, source, clock: createDemoClock(db, source) };
}

describe("createDemoClock", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("shows the source's time by default", () => {
    const { source, clock } = setup();
    expect(clock.isReal()).toBe(true);
    expect(clock.now()).toEqual(REAL);
    source.advance(MINUTE_MS);
    expect(clock.now()).toEqual(new Date(REAL.getTime() + MINUTE_MS));
  });

  test("keeps flowing from the moment it was set", () => {
    const { source, clock } = setup();
    const jueves = parseSantiago("2026-10-22T22:30");
    clock.set(jueves);
    expect(clock.isReal()).toBe(false);
    expect(clock.now()).toEqual(jueves);

    source.advance(5 * MINUTE_MS);
    expect(clock.now()).toEqual(parseSantiago("2026-10-22T22:35"));
  });

  test("advance adds to the current offset", () => {
    const { clock } = setup();
    clock.set(parseSantiago("2026-10-22T22:30"));
    clock.advance(30 * MINUTE_MS);
    clock.advance(60 * MINUTE_MS);
    expect(clock.now()).toEqual(parseSantiago("2026-10-23T00:00"));
  });

  test("advance from real time starts an offset", () => {
    const { clock } = setup();
    clock.advance(MINUTE_MS);
    expect(clock.isReal()).toBe(false);
    expect(clock.now()).toEqual(new Date(REAL.getTime() + MINUTE_MS));
  });

  test("advance rejects negative or non-finite amounts", () => {
    const { clock } = setup();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(clock.isReal()).toBe(true);
  });

  test("reset returns to the source's time", () => {
    const { clock } = setup();
    clock.set(parseSantiago("2026-10-22T22:30"));
    clock.reset();
    expect(clock.isReal()).toBe(true);
    expect(clock.now()).toEqual(REAL);
  });

  test("a second clock on the same database sees the same time", () => {
    const { db, source, clock } = setup();
    const other = createDemoClock(db, source);
    clock.set(parseSantiago("2026-10-22T22:30"));
    expect(other.now()).toEqual(clock.now());
    other.advance(MINUTE_MS);
    expect(clock.now()).toEqual(parseSantiago("2026-10-22T22:31"));
  });

  test("the offset survives reopening the file", () => {
    dir = mkdtempSync(join(tmpdir(), "pulso-clock-"));
    const path = join(dir, "pulso.db");
    const source = new FakeClock(REAL);

    const first = openDatabase(path);
    migrate(first);
    createDemoClock(first, source).set(parseSantiago("2026-10-22T22:30"));
    first.close();

    const second = openDatabase(path);
    migrate(second);
    const clock = createDemoClock(second, source);
    expect(clock.isReal()).toBe(false);
    expect(clock.now()).toEqual(parseSantiago("2026-10-22T22:30"));
    second.close();
  });
});
