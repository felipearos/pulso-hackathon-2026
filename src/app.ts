import { readdirSync } from "node:fs";
import { recibirRespuestaBienvenida, tomarNombreDelPerfil } from "./citas/bienvenida-respuestas";
import { createCitaSender } from "./citas/envio";
import { createScheduler } from "./citas/scheduler";
import { createDemoClock, type DemoClock } from "./clock/demo-clock";
import { migrate } from "./db";
import { GUION } from "./demo/guion";
import { nightAudioSender } from "./demo/night-audio";
import { createQrRoutes } from "./demo/qr";
import { createDemoRoutes } from "./demo/routes";
import controlPage from "./demo/control.html" with { type: "text" };
import { pauseIfSilent } from "./escalera/pausa";
import type { EtapaMove } from "./escalera/policy";
import { receiveMensaje, type MensajeInput } from "./escalera/respuesta";
import { extractEstadoDeCuenta, linkDelEstadoDeCuenta } from "./mail/estado-de-cuenta";
import { receiveMail } from "./mail/ingest";
import { createPermitir, DEFAULT_PUBLIC_BASE_URL } from "./mail/permitir";
import { allowedSenderDomains } from "./mail/senders";
import type { Extraccion, Senal } from "./patricia/entities";
import { resetPatricia } from "./patricia/fixtures";
import { createStore, type Store } from "./patricia/store";
import type { IncomingMail, Ports, Web } from "./ports";
import { createHandler } from "./server";
import { receiveInbound } from "./whatsapp/inbound";
import { createCanal, createSimulador } from "./whatsapp/simulador";
import { createWebhook, type WebhookConfig } from "./whatsapp/webhook";

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
  /**
   * Resolves once every message the webhook took in has been processed; tests
   * await it, and SIGTERM does too.
   */
  drain(): Promise<void>;
  /** Patricia's persisted state and the decision log. */
  store: Store;
  /** The demo clock: every domain time read goes through it (ADR 0002). */
  clock: DemoClock;
  /** Takes a message from Patricia, moves her etapa if the política says so and logs the decision. */
  receiveMensaje(input: MensajeInput): Promise<EtapaMove>;
  /**
   * Puts Patricia and the demo clock back at the starting point of her story.
   * A tick still running is finished first and ticks asked for meanwhile run
   * after it, so nothing from the old story is sent once the reset resolves.
   * With no tick running the reset is done before this returns.
   */
  reset(): Promise<void>;
};

// The control room's page and test audio ship with the repo; Bun reads them on request.
const demoPage = Bun.file(new URL("./demo/page.html", import.meta.url));
// The landing and its coming-soon page ship with the repo the same way.
const landingPage = Bun.file(new URL("./web/pages/landing.html", import.meta.url));
const soonPage = Bun.file(new URL("./web/pages/pronto.html", import.meta.url));
const landingImageDir = new URL("./web/pages/img/", import.meta.url);
const landingImages = Object.fromEntries(
  readdirSync(landingImageDir)
    .filter((name) => name.endsWith(".webp"))
    .map((name) => [name, Bun.file(new URL(name, landingImageDir))]),
);
const nightAudio = Bun.file(new URL("../assets/night-audio-test.ogg", import.meta.url));

/** How many times an S2's link is tried before Luna gives that mail up. */
const MAX_INTENTOS_S2 = 5;

/** The web port when none is given: every link is refused, so no S2 is ever read. */
const noWeb: Web = {
  fetchDocument: (url) => Promise.reject(new Error(`web: no web port; refused ${url}`)),
};

/**
 * What the app is configured with beside its ports. A secret is not something
 * the app talks to, so it does not belong on `Ports`.
 */
export type AppOptions = {
  /** The control room's operator key (`DEMO_OPERATOR_KEY`); unset leaves `/demo` view-only. */
  demoOperatorKey?: string;
  /** The webhook's Meta secrets; unset leaves every delivery refused. */
  /** The operator token that opens /sala; without it /sala answers 404. */
  demoToken?: string;
  /** The webhook's Meta secrets; unset leaves every delivery refused. */
  webhook?: WebhookConfig;
  /** Whether the /sala simulador is the channel at boot instead of Meta (`WHATSAPP_SIMULADOR`); /sala can switch it. */
  simulador?: boolean;
  /** The WhatsApp number the entrada QR opens a chat with (`WHATSAPP_ENTRADA_PHONE`); unset, that page answers 503. */
  entradaPhone?: string;
  /** The public base the jurado QR points at (`PUBLIC_BASE_URL`); defaults to the Funnel URL. */
  publicBaseUrl?: string;
};

/**
 * Builds the app from its ports. The schema is brought up to date first, so a
 * deploy against the live file keeps every night Patricia already heard.
 */
export function createApp(ports: Ports, options: AppOptions = {}): App {
  migrate(ports.db);
  const clock = createDemoClock(ports.db, ports.clock);
  const store = createStore(ports.db, clock);
  // Every flow sends through the canal, so the simulador can stand in for Meta while the app runs.
  const simulador = createSimulador();
  const canal = createCanal(ports.whatsapp, simulador, options.simulador ?? false);
  // The señal and its decision land together or not at all.
  const receive = (mail: IncomingMail) =>
    receiveMail(store, ports.llm, mail, (fn) => ports.db.transaction(fn)());
  const web = ports.web ?? noWeb;
  // A mail whose PDF did not open is closed for good, and two calls on one mail share one run.
  const cerrados = new Set<string>();
  const enCurso = new Map<string, Promise<Extraccion | null>>();
  const extract = (mail: IncomingMail): Promise<Extraccion | null> => {
    if (cerrados.has(mail.id)) return Promise.resolve(null);
    const inFlight = enCurso.get(mail.id);
    if (inFlight !== undefined) return inFlight;
    const run = extractEstadoDeCuenta({ store, llm: ports.llm, db: ports.db, web }, mail)
      .then((result) => {
        if (result !== "cerrado") return result;
        cerrados.add(mail.id);
        return null;
      })
      .finally(() => enCurso.delete(mail.id));
    enCurso.set(mail.id, run);
    return run;
  };
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
    if ((await extract(mail)) === null && !cerrados.has(mail.id) && retryable(mail)) porLeer.set(mail.id, mail);
    else {
      porLeer.delete(mail.id);
      intentosS2.delete(mail.id);
    }
  };
  // One mail's whole way in, the same whether Gmail brought it or /sala injected it.
  const ingestMail = async (mail: IncomingMail) => {
    const senal = await receive(mail);
    if (senal?.tipo === "S1" || senal?.tipo === "S2") await extractOrKeep(mail);
    return senal;
  };
  // How many polls in a row failed. The poll keeps trying every tick, but only
  // the first failure of a run is logged and recorded, so a Gmail outage left
  // alone all night writes two lines, not one per minute.
  let failedPolls = 0;
  // The entrante and its line in the registro land together too.
  const inTransaction = <T,>(write: () => T): T => ports.db.transaction(write)();
  const mensaje = async (input: MensajeInput) => {
    try {
      await recibirRespuestaBienvenida({ store, llm: ports.llm }, input.text);
    } catch (error) {
      // A failed bienvenida answer must not cost the escalera its step.
      console.error(`bienvenida: answer failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return receiveMensaje({ store, llm: ports.llm, whatsapp: canal, voice: ports.voice, db: ports.db }, input);
  };
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
        await ingestMail(mail);
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
    whatsapp: canal,
  });
  const permitir = createPermitir({ mail: ports.mail, store, clock: ports.clock });
  const webhook = createWebhook({
    config: options.webhook ?? {},
    claim: (whatsappId) => store.claimWhatsappId(whatsappId),
    release: (whatsappId) => store.releaseWhatsappId(whatsappId),
    onMensaje: (inbound) => {
      try {
        inTransaction(() => tomarNombreDelPerfil(store, inbound.perfilNombre));
      } catch (error) {
        // A failed profile name must not cost the message.
        console.error(`perfil: nombre failed: ${errorMessage(error)}`);
      }
      return receiveInbound(
        { store, mensaje, inTransaction, whatsapp: canal, voice: ports.voice, llm: ports.llm },
        inbound,
      );
    },
    recordInbound: (at) => canal.recordInbound(at),
    now: () => clock.now(),
  });
  const routes = createHandler({
    demoPage,
    landingPage,
    soonPage,
    landingImages,
    nightAudio,
    sendNightAudio: nightAudioSender(canal, nightAudio),
    operatorKey: options.demoOperatorKey,
    webhook,
  });
  // Ticks and resets take turns: a reset in the middle of a tick would let the
  // tick send the old story's audio and then fail on a cita that is gone. A
  // step asked for while nothing is in turn starts at once, synchronously up to
  // its first await, and a step with no await (the reset) is out of the turn
  // when it returns, so a reset with nothing running is done on return.
  let tail: Promise<unknown> = Promise.resolve();
  let busy = 0;
  const inTurn = <T>(step: () => T | Promise<T>): Promise<T> => {
    const run = (): Promise<T> => {
      let result: T | Promise<T>;
      try {
        result = step();
      } catch (error) {
        busy -= 1;
        return Promise.reject(error);
      }
      if (!(result instanceof Promise)) {
        busy -= 1;
        return Promise.resolve(result);
      }
      return result.finally(() => {
        busy -= 1;
      });
    };
    busy += 1;
    const result = busy === 1 ? run() : tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
  const tickNow = async () => {
    // Mail first, so tonight's cita is decided with every señal already in.
    await pollMail();
    // Fourteen days without a reply silence Luna before tonight's slot is decided.
    pauseIfSilent(ports.db, store, clock.now());
    scheduler.tick();
    await sender.tick();
  };
  const tick = () => inTurn(tickNow);
  // The jump and its tick share one turn, so a reset cannot land between them.
  const tickAt = (at: Date) =>
    inTurn(() => {
      clock.set(at);
      return tickNow();
    });
  // Back at the starting point, a mail closed before the reset can be read again.
  const reset = () =>
    inTurn(() => {
      cerrados.clear();
      return resetPatricia(ports.db, clock);
    });
  // A text import hands over the file's contents; Bun's types only know the HTML-bundle import.
  const controlPageText = controlPage as unknown as string;
  const demo = createDemoRoutes({
    token: options.demoToken,
    clock,
    store,
    tick,
    tickAt,
    reset,
    guion: GUION,
    page: controlPageText,
    canal,
    simulador,
    inject: (inbound) => webhook.inject(inbound),
    injectMail: ingestMail,
  });
  // The jurado gets a simulador of their own, never the canal: nothing reaches Meta or Patricia's conversation.
  const qr = createQrRoutes({
    token: options.demoToken,
    entradaPhone: options.entradaPhone,
    publicBaseUrl: options.publicBaseUrl?.replace(/\/+$/, "") || DEFAULT_PUBLIC_BASE_URL,
    voice: ports.voice,
    simulador: createSimulador(),
  });
  return {
    // The QR routes go first: the control room answers 404 for any /sala path it does not know.
    handle: async (request) => (await qr(request)) ?? (await demo(request)) ?? permitir.handle(request) ?? routes(request),
    tick,
    receiveMail: receive,
    extractEstadoDeCuenta: extract,
    drain: () => webhook.drain(),
    store,
    clock,
    receiveMensaje: mensaje,
    reset,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
