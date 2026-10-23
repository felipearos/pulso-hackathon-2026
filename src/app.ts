import { createDemoClock, type DemoClock } from "./clock/demo-clock";
import { migrate } from "./db";
import { createStore, type Store } from "./patricia/store";
import type { Ports } from "./ports";
import { handle } from "./server";

export type App = {
  /** Answers one HTTP request; `Bun.serve` in `main` and tests call it alike. */
  handle(request: Request): Response | Promise<Response>;
  /** Runs one pass of the scheduler at the clock's current time. */
  tick(): Promise<void>;
  /** Patricia's persisted state and the decision log. */
  store: Store;
  /** The demo clock: every domain time read goes through it (ADR 0002). */
  clock: DemoClock;
};

/**
 * Builds the app from its ports. The schema is brought up to date first, so a
 * deploy against the live file keeps every night Patricia already heard.
 */
export function createApp(ports: Ports): App {
  migrate(ports.db);
  const clock = createDemoClock(ports.db, ports.clock);
  return {
    handle,
    // The scheduler tickets fill this pass; until then a tick has nothing to do.
    tick: async () => {},
    store: createStore(ports.db, clock),
    clock,
  };
}
