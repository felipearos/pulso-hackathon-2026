import { createDemoClock, type DemoClock } from "./clock/demo-clock";
import { migrate } from "./db";
import { nightAudioSender } from "./demo/night-audio";
import { createStore, type Store } from "./patricia/store";
import type { Ports } from "./ports";
import { createHandler } from "./server";

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

// The control room's page and test audio ship with the repo; Bun reads them on request.
const demoPage = Bun.file(new URL("./demo/page.html", import.meta.url));
const nightAudio = Bun.file(new URL("../assets/night-audio-test.ogg", import.meta.url));

export type AppOptions = {
  /** The control room's operator key (`DEMO_OPERATOR_KEY`); unset leaves `/demo` view-only. */
  demoOperatorKey?: string;
};

/**
 * Builds the app from its ports. The schema is brought up to date first, so a
 * deploy against the live file keeps every night Patricia already heard.
 */
export function createApp(ports: Ports, options: AppOptions = {}): App {
  migrate(ports.db);
  const clock = createDemoClock(ports.db, ports.clock);
  return {
    handle: createHandler({
      demoPage,
      nightAudio,
      sendNightAudio: nightAudioSender(ports.whatsapp, nightAudio),
      operatorKey: options.demoOperatorKey,
    }),
    // The scheduler tickets fill this pass; until then a tick has nothing to do.
    tick: async () => {},
    store: createStore(ports.db, clock),
    clock,
  };
}
