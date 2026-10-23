import { createHash, timingSafeEqual } from "node:crypto";
import type { DemoClock } from "../clock/demo-clock";
import { SAMPLE_MAILS, type SampleMailKind } from "../mail/samples";
import type { Senal, TipoSenal } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail } from "../ports";
import type { Canal, Simulador } from "../whatsapp/simulador";
import type { InboundMensaje } from "../whatsapp/webhook";
import { findMomento, type MomentoDelGuion } from "./guion";

/** What the control room drives: the same flows Patricia's night runs on, no logic of its own. */
export type DemoDeps = {
  /** The operator token; unset or empty turns /sala off entirely. */
  token: string | undefined;
  clock: DemoClock;
  store: Store;
  tick(): Promise<void>;
  reset(): Promise<void>;
  guion: readonly MomentoDelGuion[];
  /** The control room page, served as is. */
  page: string;
  /** The channel the app sends through; /sala switches it between Meta and the simulador. */
  canal: Canal;
  /** The simulador, for the bytes of the audios and fotos the page plays and shows. */
  simulador: Simulador;
  /** The webhook's way in for a message that did not come through Meta. */
  inject(mensaje: InboundMensaje): boolean;
  /** The way in a Gmail mail takes in `tick` (its señal, then an S1's or S2's estado de cuenta), for a sample mail. */
  injectMail(mail: IncomingMail): Promise<Senal | null>;
};

/** What the control room calls each señal on screen. */
const ETIQUETAS: Record<TipoSenal, string> = {
  S1: "estado de cuenta del banco",
  S2: "estado de cuenta de la tienda",
  S3: "pedido del catálogo pagado",
  S4: "compra en cuotas",
  S5: "«recibimos tu pago»",
  S6: "aviso de vencimiento",
  S7: "sospechoso",
  ignorado: "ignorado",
};

/** Own keys only, so `toString` or `__proto__` is not a sample. */
const isSampleMailKind = (kind: string): kind is SampleMailKind => Object.hasOwn(SAMPLE_MAILS, kind);

/** One line of the conversation the simulador page shows. */
export type MensajeDeLaConversacion = {
  de: "luna" | "patricia";
  kind: "text" | "audio" | "image";
  text: string | null;
  /** Length of Luna's audio; null for anything else. */
  durationSeconds: number | null;
  at: string;
  /** Where the page gets the bytes of an audio or foto the simulador holds; null otherwise. */
  mediaUrl: string | null;
};

/** How many of the latest messages /sala/conversacion answers with. */
const MAX_MENSAJES = 100;

const NOT_FOUND = () => new Response("Not found", { status: 404 });

const digest = (text: string) => createHash("sha256").update(text).digest();

/** Compares in constant time; hashing first gives both sides the same length. */
function tokenMatches(expected: string, given: string | null): boolean {
  return given !== null && timingSafeEqual(digest(expected), digest(given));
}

/** The operator's token: the `x-demo-token` header (the page's calls) or else `?token=` (the projector's URL). */
function givenToken(request: Request, url: URL): string | null {
  return request.headers.get("x-demo-token") || url.searchParams.get("token");
}

/**
 * The /sala control room routes. Returns null for any other path so the app
 * falls through to its own routes. Without the right token every /sala path
 * answers 404, the same as a path that does not exist, because the app is
 * published on the internet.
 */
export function createDemoRoutes(deps: DemoDeps): (request: Request) => Promise<Response | null> {
  const state = () => {
    const now = deps.clock.now();
    return {
      now: now.toISOString(),
      relojReal: deps.clock.isReal(),
      etapa: deps.store.getPatricia().etapa,
      simulador: deps.canal.isSimulador(),
      guion: deps.guion.map(({ id, label, at }) => ({ id, label, at: at.toISOString() })),
      citas: deps.store.citas().slice(-5),
      decisiones: deps.store
        .decisions()
        .slice(-10)
        .map(({ at, tipo, motivo }) => ({ at: at.toISOString(), tipo, motivo })),
      correos: deps.store
        .senales()
        .slice(-10)
        .map(({ receivedAt, tipo, origen }) => ({
          at: receivedAt.toISOString(),
          tipo,
          subject: origen.subject,
          from: origen.from,
          etiqueta: ETIQUETAS[tipo],
        })),
    };
  };
  const run = async (step: () => void | Promise<void>): Promise<Response> => {
    try {
      await step();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`demo: ${message}`);
      let current = {};
      try {
        current = state();
      } catch {
        // The store itself may be what failed; the error alone still reaches the page.
      }
      return Response.json({ error: message, ...current }, { status: 500 });
    }
    return Response.json(state());
  };
  // Which media id holds the foto Patricia sent from the page, by her mensaje's whatsappId.
  const fotosDelSimulador = new Map<string, string>();
  const mediaUrl = (id: string | null): string | null =>
    id !== null && deps.simulador.media(id) !== null ? `/sala/simulador/media/${encodeURIComponent(id)}` : null;
  const conversacion = (): MensajeDeLaConversacion[] => {
    const luna = deps.store.mensajesSalientes().map((saliente) => ({
      time: saliente.sentAt.getTime(),
      mensaje: {
        de: "luna" as const,
        kind: saliente.kind,
        text: saliente.text,
        durationSeconds: saliente.kind === "audio" ? saliente.durationSeconds : null,
        at: saliente.sentAt.toISOString(),
        mediaUrl: saliente.kind === "text" ? null : mediaUrl(saliente.whatsappId),
      },
    }));
    const patricia = deps.store.mensajesEntrantes().map((entrante) => {
      const fotoId = entrante.whatsappId === null ? undefined : fotosDelSimulador.get(entrante.whatsappId);
      return {
        time: entrante.receivedAt.getTime(),
        mensaje: {
          de: "patricia" as const,
          kind: fotoId !== undefined ? ("image" as const) : ("text" as const),
          text: entrante.text,
          durationSeconds: null,
          at: entrante.receivedAt.toISOString(),
          mediaUrl: mediaUrl(fotoId ?? null),
        },
      };
    });
    // A stable sort keeps a message and its answer at the same instant in the order they were written.
    return [...luna, ...patricia]
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_MENSAJES)
      .map(({ mensaje }) => mensaje);
  };
  const badRequest = (error: string) => Response.json({ error }, { status: 400 });
  /** The body of what Patricia sends from the page, or the reason it cannot be read. */
  const mensajeBody = async (request: Request): Promise<InboundMensaje["body"] | string> => {
    const type = request.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      let foto: unknown;
      try {
        foto = (await request.formData()).get("foto");
      } catch {
        return "el formulario no se pudo leer";
      }
      if (!(foto instanceof Blob) || !foto.type.startsWith("image/") || foto.size === 0) {
        return "falta la foto (una imagen en el campo foto)";
      }
      const mimeType = foto.type;
      const mediaId = deps.simulador.addMedia({ bytes: new Uint8Array(await foto.arrayBuffer()), mimeType });
      return { kind: "image", mediaId, mimeType };
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return "el cuerpo no es JSON";
    }
    if (typeof body !== "object" || body === null) return "el cuerpo debe ser un objeto";
    const { text, emoji } = body as { text?: unknown; emoji?: unknown };
    if (typeof text === "string" && text.trim() !== "") return { kind: "text", text: text.trim() };
    if (typeof emoji === "string" && emoji.trim() !== "") {
      const toWhatsappId = deps.store.mensajesSalientes().at(-1)?.whatsappId ?? null;
      return { kind: "reaction", emoji: emoji.trim(), toWhatsappId };
    }
    return "falta un texto, un emoji o una foto";
  };

  return async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname !== "/sala" && !pathname.startsWith("/sala/")) return null;
    if (!deps.token || !tokenMatches(deps.token, givenToken(request, url))) return NOT_FOUND();

    if (request.method === "GET" && pathname === "/sala") {
      return new Response(deps.page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method === "GET" && pathname === "/sala/state") return Response.json(state());
    if (request.method === "POST" && pathname === "/sala/tick") return run(deps.tick);
    if (request.method === "POST" && pathname === "/sala/reset") return run(deps.reset);
    if (request.method === "GET" && pathname === "/sala/conversacion") {
      return Response.json({ simulador: deps.canal.isSimulador(), mensajes: conversacion() });
    }
    const mediaMatch = /^\/sala\/simulador\/media\/([^/]+)$/.exec(pathname);
    if (request.method === "GET" && mediaMatch) {
      let media: ReturnType<Simulador["media"]> = null;
      try {
        media = deps.simulador.media(decodeURIComponent(mediaMatch[1]!));
      } catch {
        // A malformed id is just an unknown one.
      }
      if (!media) return NOT_FOUND();
      return new Response(media.bytes, { headers: { "content-type": media.mimeType } });
    }
    if (request.method === "POST" && pathname === "/sala/simulador") {
      let activo: unknown;
      try {
        activo = ((await request.json()) as { activo?: unknown } | null)?.activo;
      } catch {
        return badRequest("el cuerpo no es JSON");
      }
      if (typeof activo !== "boolean") return badRequest("falta activo: true o false");
      deps.canal.setSimulador(activo);
      return Response.json(state());
    }
    if (request.method === "POST" && pathname === "/sala/simulador/mensaje") {
      if (!deps.canal.isSimulador()) return Response.json({ error: "el simulador no está activo" }, { status: 409 });
      const body = await mensajeBody(request);
      if (typeof body === "string") return badRequest(body);
      const whatsappId = `sim-in-${crypto.randomUUID()}`;
      if (body.kind === "image") fotosDelSimulador.set(whatsappId, body.mediaId);
      // The webhook's own way in, so her answer takes the same flow as one Meta delivered.
      deps.inject({ whatsappId, from: "simulador", when: deps.clock.now(), body });
      return Response.json({ whatsappId }, { status: 202 });
    }
    const correoMatch = /^\/sala\/correos\/([^/]+)$/.exec(pathname);
    if (request.method === "POST" && correoMatch) {
      let kind: string;
      try {
        kind = decodeURIComponent(correoMatch[1]!);
      } catch {
        return badRequest(`no hay correo de muestra ${correoMatch[1]}`);
      }
      if (!isSampleMailKind(kind)) return badRequest(`no hay correo de muestra ${kind}`);
      const sample = SAMPLE_MAILS[kind];
      // It arrives now on the room's clock; its fixed id makes a second press the señal already stored.
      return run(async () => {
        await deps.injectMail({ ...sample, receivedAt: deps.clock.now() });
      });
    }
    const match = /^\/sala\/momentos\/([^/]+)$/.exec(pathname);
    if (request.method === "POST" && match) {
      let id: string;
      try {
        id = decodeURIComponent(match[1]!);
      } catch {
        return Response.json({ error: `no momento ${match[1]}` }, { status: 400 });
      }
      const momento = findMomento(deps.guion, id);
      if (!momento) return Response.json({ error: `no momento ${id}` }, { status: 400 });
      // Jump, then tick at once, so the button shows what that moment brings.
      return run(async () => {
        deps.clock.set(momento.at);
        await deps.tick();
      });
    }
    return NOT_FOUND();
  };
}
