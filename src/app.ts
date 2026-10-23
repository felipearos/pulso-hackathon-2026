import { createDemoClock, type DemoClock } from "./clock/demo-clock";
import { migrate } from "./db";
import { receiveMail } from "./mail/ingest";
import { allowedSenderDomains } from "./mail/senders";
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
  receiveMail(mail: IncomingMail): Senal | null;
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
  // The señal and its decision land together or not at all.
  const receive = (mail: IncomingMail) => ports.db.transaction(() => receiveMail(store, mail))();
  return {
    handle,
    tick: async () => {
      let mails: IncomingMail[];
      try {
        mails = await ports.mail.fetchNew(allowedSenderDomains());
      } catch (error) {
        // Error policy, backoff and its decision belong to ticket #27.
        console.error(`mail: fetchNew failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      for (const mail of mails) {
        try {
          receive(mail);
        } catch (error) {
          // One mail that fails must not cost the rest of the batch.
          console.error(`mail: ${mail.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    receiveMail: receive,
    store,
    clock,
  };
}
