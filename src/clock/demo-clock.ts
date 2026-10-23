import type { Database } from "bun:sqlite";
import type { Clock } from "../ports";

/**
 * The demo clock: the only source of domain time (ADR 0002). SQLite keeps an
 * offset rather than a frozen time, so the clock runs at the pace of its source
 * and the demo can jump to «jueves 22:30» and keep flowing from there.
 */
export type DemoClock = Clock & {
  /** Moves the clock to `at`; time keeps flowing from there. */
  set(at: Date): void;
  /** Moves the clock forward by `ms`. */
  advance(ms: number): void;
  /** Goes back to the source's time. */
  reset(): void;
  /** True when no offset is set and the clock shows the source's time. */
  isReal(): boolean;
};

/**
 * A demo clock over `source` (the system clock in production, a FakeClock in
 * tests). Every read goes to the `reloj_demo` row, so clocks sharing a database
 * agree and the offset survives a restart. Assumes `migrate` has run.
 */
export function createDemoClock(db: Database, source: Clock): DemoClock {
  const readOffset = (): number | null =>
    db.query<{ offset_ms: number | null }, []>("SELECT offset_ms FROM reloj_demo WHERE id = 1").get()?.offset_ms ??
    null;
  const writeOffset = (offset: number | null): void => {
    db.run("UPDATE reloj_demo SET offset_ms = ? WHERE id = 1", [offset]);
  };

  return {
    now() {
      return new Date(source.now().getTime() + (readOffset() ?? 0));
    },
    set(at) {
      if (!Number.isFinite(at.getTime())) throw new RangeError("cannot set the demo clock to an invalid date");
      writeOffset(at.getTime() - source.now().getTime());
    },
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`cannot advance the demo clock by ${ms} ms`);
      writeOffset((readOffset() ?? 0) + ms);
    },
    reset() {
      writeOffset(null);
    },
    isReal() {
      return readOffset() === null;
    },
  };
}
