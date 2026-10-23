import { createDemoClock, type DemoClock } from "./clock/demo-clock";
import { migrate } from "./db";
import { recibirCorreo } from "./mail/ingest";
import { dominiosPermitidos } from "./mail/remitentes";
import type { Senal } from "./patricia/entities";
import { createStore, type Store } from "./patricia/store";
import type { IncomingMail, Ports } from "./ports";
import { handle } from "./server";

export type App = {
  /** Answers one HTTP request; `Bun.serve` in `main` and tests call it alike. */
  handle(request: Request): Response | Promise<Response>;
  /** Runs one pass of the scheduler at the clock's current time: reads new mail into señales. */
  tick(): Promise<void>;
  /** Turns one mail into at most one señal; Gmail, the fake and the /demo injection all end here. */
  recibirCorreo(mail: IncomingMail): Senal | null;
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
  const store = createStore(ports.db, clock);
  const recibir = (mail: IncomingMail) => recibirCorreo(store, mail);
  return {
    handle,
    tick: async () => {
      let mails: IncomingMail[];
      try {
        mails = await ports.mail.fetchNew(dominiosPermitidos());
      } catch (error) {
        // Error policy, backoff and its decision belong to ticket #27.
        console.error(`mail: fetchNew failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      for (const mail of mails) recibir(mail);
    },
    recibirCorreo: recibir,
    store,
    clock,
  };
}
