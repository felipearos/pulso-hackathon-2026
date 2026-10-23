import { createCitaSender } from "./citas/envio";
import { createScheduler } from "./citas/scheduler";
import { createDemoClock, type DemoClock } from "./clock/demo-clock";
import { migrate } from "./db";
import { nightAudioSender } from "./demo/night-audio";
import type { EtapaMove } from "./escalera/policy";
import { receiveMensaje, type MensajeInput } from "./escalera/respuesta";
import { receiveMail } from "./mail/ingest";
import { allowedSenderDomains } from "./mail/senders";
import type { Senal } from "./patricia/entities";
import { resetPatricia } from "./patricia/fixtures";
import { createStore, type Store } from "./patricia/store";
import type { IncomingMail, Ports } from "./ports";
import { createHandler } from "./server";

export type App = {
  /** Answers one HTTP request; `Bun.serve` in `main` and tests call it alike. */
  handle(request: Request): Response | Promise<Response>;
  /**
   * Runs one pass at the clock's current time: reads new mail into señales if
   * Patricia allowed it, fixes the cita, then sends today's programada cita as
   * a nota de voz if it has not gone out yet.
   */
  tick(): Promise<void>;
  /** Turns one mail into at most one señal; Gmail, the fake and the /demo injection all end here. */
  receiveMail(mail: IncomingMail): Promise<Senal | null>;
  /** Patricia's persisted state and the decision log. */
  store: Store;
  /** The demo clock: every domain time read goes through it (ADR 0002). */
  clock: DemoClock;
  /** Takes a message from Patricia, moves her etapa if the política says so and logs the decision. */
  receiveMensaje(input: MensajeInput): Promise<EtapaMove>;
  /** Puts Patricia and the demo clock back at the starting point of her story. */
  reset(): void;
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
  const store = createStore(ports.db, clock);
  // The señal and its decision land together or not at all.
  const receive = (mail: IncomingMail) =>
    receiveMail(store, ports.llm, mail, (fn) => ports.db.transaction(fn)());
  const pollMail = async () => {
    // Gmail is read only while Patricia's «Permitir» stands; /demo injection is not gated.
    if (!store.getPatricia().gmailPermitido) return;
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
        await receive(mail);
      } catch (error) {
        // One mail that fails must not cost the rest of the batch.
        console.error(`mail: ${mail.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const scheduler = createScheduler({ db: ports.db, store, clock });
  const sender = createCitaSender({
    db: ports.db,
    store,
    clock,
    llm: ports.llm,
    voice: ports.voice,
    whatsapp: ports.whatsapp,
  });
  return {
    handle: createHandler({
      demoPage,
      nightAudio,
      sendNightAudio: nightAudioSender(ports.whatsapp, nightAudio),
      operatorKey: options.demoOperatorKey,
    }),
    tick: async () => {
      // Mail first, so tonight's cita is decided with every señal already in.
      await pollMail();
      scheduler.tick();
      await sender.tick();
    },
    receiveMail: receive,
    store,
    clock,
    receiveMensaje: (input) => receiveMensaje({ store, llm: ports.llm }, input),
    reset: () => resetPatricia(ports.db, clock),
  };
}
