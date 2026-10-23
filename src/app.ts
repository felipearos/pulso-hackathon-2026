import { createCitaSender } from "./citas/envio";
import { createScheduler } from "./citas/scheduler";
import { createDemoClock, type DemoClock } from "./clock/demo-clock";
import { migrate } from "./db";
import { nightAudioSender } from "./demo/night-audio";
import { pauseIfSilent } from "./escalera/pausa";
import type { EtapaMove } from "./escalera/policy";
import { receiveMensaje, type MensajeInput } from "./escalera/respuesta";
import { extractEstadoDeCuenta, linkDelEstadoDeCuenta } from "./mail/estado-de-cuenta";
import { receiveMail } from "./mail/ingest";
import { createPermitir } from "./mail/permitir";
import { allowedSenderDomains } from "./mail/senders";
import type { Extraccion, Senal } from "./patricia/entities";
import { resetPatricia } from "./patricia/fixtures";
import { createStore, type Store } from "./patricia/store";
import type { IncomingMail, Ports, Web } from "./ports";
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
  /** Reads an S1 or S2 mail's estado de cuenta after `receiveMail`; `tick` calls it for every new S1 or S2. */
  extractEstadoDeCuenta(mail: IncomingMail): Promise<Extraccion | null>;
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

/** How many times an S2's link is tried before Luna gives that mail up. */
const MAX_INTENTOS_S2 = 5;

/** The web port when none is given: every link is refused, so no S2 is ever read. */
const noWeb: Web = {
  fetchDocument: (url) => Promise.reject(new Error(`web: no web port; refused ${url}`)),
};

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
  const web = ports.web ?? noWeb;
  const extract = (mail: IncomingMail) => extractEstadoDeCuenta({ store, llm: ports.llm, db: ports.db, web }, mail);
  // fetchNew hands each mail over once, so an S1 Claude could not read, or an
  // S2 whose link could not be read, is kept here and read again on the next
  // tick instead of being lost. An S2 with no allowed link never will be, and
  // one whose link keeps failing is dropped after a few ticks so a dead tienda
  // page does not slow every tick before tonight's cita.
  const porLeer = new Map<string, IncomingMail>();
  const intentosS2 = new Map<string, number>();
  const retryable = (mail: IncomingMail) => {
    const tipo = store.senalForMail(mail.id)?.tipo;
    if (tipo === "S1") return true;
    if (tipo !== "S2" || linkDelEstadoDeCuenta(mail) === null) return false;
    const intentos = (intentosS2.get(mail.id) ?? 0) + 1;
    intentosS2.set(mail.id, intentos);
    return intentos < MAX_INTENTOS_S2;
  };
  const extractOrKeep = async (mail: IncomingMail) => {
    if ((await extract(mail)) === null && retryable(mail)) porLeer.set(mail.id, mail);
    else {
      porLeer.delete(mail.id);
      intentosS2.delete(mail.id);
    }
  };
  // How many polls in a row failed. The poll keeps trying every tick, but only
  // the first failure of a run is logged and recorded, so a Gmail outage left
  // alone all night writes two lines, not one per minute.
  let failedPolls = 0;
  const pollMail = async () => {
    // Gmail is read only while Patricia's «Permitir» stands; /demo injection is not gated.
    if (!store.getPatricia().gmailPermitido) return;
    for (const mail of porLeer.values()) {
      try {
        await extractOrKeep(mail);
      } catch (error) {
        console.error(`mail: ${mail.id} failed again: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let mails: IncomingMail[];
    try {
      mails = await ports.mail.fetchNew(allowedSenderDomains());
    } catch (error) {
      failedPolls += 1;
      if (failedPolls === 1) {
        const message = errorMessage(error);
        console.error(`mail: fetchNew failed, retrying every tick quietly: ${message}`);
        store.recordDecision({
          tipo: "error-correo",
          motivo: "No pude leer el Gmail de Patricia; sigo intentando en cada vuelta sin repetir el aviso",
          datos: { error: message },
        });
      }
      return;
    }
    if (failedPolls > 0) {
      console.error(`mail: fetchNew is back after ${failedPolls} failed polls`);
      failedPolls = 0;
    }
    for (const mail of mails) {
      try {
        const tipo = (await receive(mail))?.tipo;
        if (tipo === "S1" || tipo === "S2") await extractOrKeep(mail);
      } catch (error) {
        // One mail that fails must not cost the rest of the batch.
        console.error(`mail: ${mail.id} failed: ${errorMessage(error)}`);
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
  const permitir = createPermitir({ mail: ports.mail, store, clock: ports.clock });
  const routes = createHandler({
    demoPage,
    nightAudio,
    sendNightAudio: nightAudioSender(ports.whatsapp, nightAudio),
    operatorKey: options.demoOperatorKey,
  });
  return {
    handle: (request) => permitir.handle(request) ?? routes(request),
    tick: async () => {
      // Mail first, so tonight's cita is decided with every señal already in.
      await pollMail();
      // Fourteen days without a reply silence Luna before tonight's slot is decided.
      pauseIfSilent(ports.db, store, clock.now());
      scheduler.tick();
      await sender.tick();
    },
    receiveMail: receive,
    extractEstadoDeCuenta: extract,
    store,
    clock,
    receiveMensaje: (input) => receiveMensaje({ store, llm: ports.llm, whatsapp: ports.whatsapp, db: ports.db }, input),
    reset: () => resetPatricia(ports.db, clock),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
