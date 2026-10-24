import { MissingEnvError } from "../missing-env";
import type { ContextoDePatricia } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Clock, Mail } from "../ports";
import { ARENA, LUNA, logoIcon, MARCA_HEAD, NOCHE, PAPEL, TINTA } from "../web/marca";
import { normalizeRut } from "./rut";

/*
 * Patricia's one «Permitir»: `/permitir` sends her to Google's read-only
 * consent page, and `/gmail/callback` is where Google sends her back. The
 * `state` each start issues is single-use and short-lived, so a callback this
 * server never started (a forged or replayed link) connects nothing. Who may
 * sign in at all is Google's call: the OAuth app stays in test mode with
 * Patricia's fictional Gmail as its only test user (#65), so a stranger who
 * opens the link cannot swap in their own mailbox.
 *
 * A connected callback then asks for her RUT, once: the banks lock the estado
 * de cuenta PDF with a clave made from it. The form carries its own
 * single-use token, so `/gmail/rut` only writes for someone who just finished
 * the «Permitir». The RUT is never logged, echoed back or put in a decision.
 *
 * Until she has answered it once, the page then offers three optional
 * questions about her life and her cuentas (`/gmail/contexto`, its own
 * single-use token) before its last message. Her answers are stored as her
 * contexto and, like the RUT, never logged or put in a decision.
 */

/** The welcome audio (#46) links Patricia here; keep the two in step. */
export const PERMITIR_PATH = "/permitir";
export const CALLBACK_PATH = "/gmail/callback";
/** Where the RUT form after a connected callback posts. */
export const RUT_PATH = "/gmail/rut";
/** Where the contexto form before the page's last message posts. */
export const CONTEXTO_PATH = "/gmail/contexto";
/** The Tailscale Funnel URL the live app is published at. */
export const DEFAULT_PUBLIC_BASE_URL = "https://desktop.taild8ed7e.ts.net";

/** The full «Permitir» link: `PUBLIC_BASE_URL`, or the Funnel URL, plus the route. */
export function permitirUrl(env: Record<string, string | undefined> = process.env): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || DEFAULT_PUBLIC_BASE_URL;
  return `${base}${PERMITIR_PATH}`;
}

/** How long she has between opening the link and coming back from Google. */
const STATE_TTL_MS = 15 * 60 * 1000;
/** A RUT form is a few dozen bytes; anything past this is not one. */
const MAX_RUT_BODY_BYTES = 4 * 1024;
/** The contexto form carries three answers of up to `MAX_ANSWER_LENGTH` each. */
const MAX_CONTEXTO_BODY_BYTES = MAX_RUT_BODY_BYTES * 2;
const MAX_ANSWER_LENGTH = 280;

const EXPIRED_LINK = "Este link ya no sirve. Abre de nuevo el link que te mandó Luna.";
const UNREADABLE = "Eso no lo pude leer. Abre de nuevo el link que te mandó Luna.";
const LISTO = "Listo. Desde ahora me entero sola de lo que te llega del banco y de la tienda. Puedes cerrar esta página.";

export type PermitirDeps = {
  mail: Mail;
  store: Store;
  /** Raw time source: only ages the `state`, which is real time, not the demo's. */
  clock: Clock;
};

export type Permitir = {
  /** Answers the «Permitir» routes and the RUT form; null for any other request. */
  handle(request: Request): Promise<Response> | null;
};

export function createPermitir(deps: PermitirDeps): Permitir {
  const { mail, store, clock } = deps;
  const issued = new Map<string, number>();
  /** Single-use tokens of the RUT forms shown, with when each was issued. */
  const rutTokens = new Map<string, number>();
  /** Single-use tokens of the contexto forms shown: when each was issued and the message the page ends with. */
  const contextoTokens = new Map<string, { at: number; message: string }>();

  const forgetExpired = () => {
    const now = clock.now().getTime();
    for (const [state, at] of issued) if (now - at > STATE_TTL_MS) issued.delete(state);
    for (const [token, at] of rutTokens) if (now - at > STATE_TTL_MS) rutTokens.delete(token);
    for (const [token, { at }] of contextoTokens) if (now - at > STATE_TTL_MS) contextoTokens.delete(token);
  };

  /** The page's last message, or first the contexto form while she has not answered it. */
  const finish = (message: string): Response => {
    if (store.getPatricia().contexto) return page(200, message);
    const token = crypto.randomUUID();
    contextoTokens.set(token, { at: clock.now().getTime(), message });
    return contextoForm(200, token, EMPTY_CONTEXTO);
  };

  const start = async (): Promise<Response> => {
    forgetExpired();
    const state = crypto.randomUUID();
    let url: string;
    try {
      url = mail.consentUrl(state);
    } catch (error) {
      if (error instanceof MissingEnvError) {
        console.error(`mail: «Permitir» unavailable: ${error.message}`);
        return page(503, "Todavía no puedo conectar tu correo. Avísale al equipo, no es nada que hayas hecho tú.");
      }
      throw error;
    }
    issued.set(state, clock.now().getTime());
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
  };

  const callback = async (url: URL): Promise<Response> => {
    forgetExpired();
    const state = url.searchParams.get("state") ?? "";
    if (!issued.delete(state)) {
      return page(400, EXPIRED_LINK);
    }
    if (url.searchParams.get("error")) {
      // She said no on Google's page: nothing to store, and nothing to insist on.
      return page(200, "Está bien, no conecté nada. Si algún día quieres, el link sigue siendo el mismo.");
    }
    const code = url.searchParams.get("code");
    if (!code) return page(400, "Google no me devolvió el permiso. Abre de nuevo el link que te mandó Luna.");
    try {
      await mail.connect(code);
    } catch (error) {
      // The adapter's errors carry a status and Google's code, never a token.
      console.error(`mail: «Permitir» failed: ${error instanceof Error ? error.message : String(error)}`);
      return page(502, "No pude terminar de conectar tu correo. Prueba de nuevo en un rato con el mismo link.");
    }
    store.updatePatricia({ gmailPermitido: true });
    store.recordDecision({
      tipo: "permitir-correo",
      motivo: "Patricia dio su «Permitir»: Luna lee su Gmail, solo los remitentes de la lista y sin poder escribir",
      datos: {},
    });
    if (store.getPatricia().rut) {
      // She gave it once already: the RUT is asked a single time.
      return finish(LISTO);
    }
    const token = crypto.randomUUID();
    rutTokens.set(token, clock.now().getTime());
    return rutForm(200, token);
  };

  const rut = async (request: Request): Promise<Response> => {
    forgetExpired();
    const body = await readCapped(request, MAX_RUT_BODY_BYTES);
    if (body === null) return page(413, UNREADABLE);
    const form = new URLSearchParams(body);
    const token = form.get("token") ?? "";
    if (!rutTokens.has(token)) return page(400, EXPIRED_LINK);
    const respuesta = form.get("respuesta");
    if (respuesta === "ahora-no") {
      rutTokens.delete(token);
      store.updatePatricia({ rut: null });
      return finish("Está bien, no guardé tu RUT. Tu correo sigue conectado y yo me las arreglo igual. Puedes cerrar esta página.");
    }
    if (respuesta !== "permitir") return page(400, EXPIRED_LINK);
    const normalized = normalizeRut(form.get("rut") ?? "");
    if (!normalized) {
      // The token stays valid: she gets to fix a swapped digit without starting over.
      return rutForm(422, token, "Ese RUT no me calza. Revísalo con calma, puede ser un número cambiado.");
    }
    rutTokens.delete(token);
    store.updatePatricia({ rut: normalized });
    store.recordDecision({
      tipo: "permitir-rut",
      motivo: "Patricia dio su RUT en la página del «Permitir», para abrir los estados de cuenta que llegan con clave",
      datos: {},
    });
    return finish(LISTO);
  };

  const contexto = async (request: Request): Promise<Response> => {
    forgetExpired();
    const body = await readCapped(request, MAX_CONTEXTO_BODY_BYTES);
    if (body === null) return page(413, UNREADABLE);
    const form = new URLSearchParams(body);
    const token = form.get("token") ?? "";
    const issuedForm = contextoTokens.get(token);
    if (!issuedForm) return page(400, EXPIRED_LINK);
    const respuesta = form.get("respuesta");
    if (respuesta === "ahora-no") {
      contextoTokens.delete(token);
      store.updatePatricia({ contexto: EMPTY_CONTEXTO });
      store.recordDecision({ tipo: "contar-contexto", motivo: "Patricia prefirió no contar su contexto", datos: {} });
      return page(200, issuedForm.message);
    }
    if (respuesta !== "guardar") return page(400, EXPIRED_LINK);
    const submitted: ContextoDePatricia = {
      deQueVive: answer(form.get("deQueVive")),
      queLePreocupa: answer(form.get("queLePreocupa")),
      queLePesa: answer(form.get("queLePesa")),
    };
    if (Object.values(submitted).some((value) => value !== null && value.length > MAX_ANSWER_LENGTH)) {
      // The token stays valid and her words come back: she only has to shorten one.
      return contextoForm(422, token, submitted, "Una respuesta quedó muy larga. Acórtala un poco, con 280 letras alcanza.");
    }
    contextoTokens.delete(token);
    store.updatePatricia({ contexto: submitted });
    const answered = Object.values(submitted).filter((value) => value !== null).length;
    store.recordDecision({
      tipo: "contar-contexto",
      motivo: `Patricia contó su contexto: ${answered} de 3 preguntas`,
      datos: {},
    });
    return page(200, issuedForm.message);
  };

  return {
    handle(request) {
      const url = new URL(request.url);
      if (request.method === "POST") {
        if (url.pathname === RUT_PATH) return rut(request);
        if (url.pathname === CONTEXTO_PATH) return contexto(request);
        return null;
      }
      if (request.method !== "GET") return null;
      if (url.pathname === PERMITIR_PATH) return start();
      if (url.pathname === CALLBACK_PATH) return callback(url);
      return null;
    },
  };
}

/** The request body as text, or null once it passes `limit` bytes; stops reading there. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** A small Spanish page for Patricia's phone. */
function page(status: number, message: string): Response {
  return html(status, `<p>${escapeHtml(message)}</p>`);
}

const FIELD_STYLE = "display: block; box-sizing: border-box; width: 100%; font-size: 1.2rem; padding: 0.75rem; margin: 0.5rem 0";

/** The RUT form after a connected callback; `notice` is the kind word when the RUT did not check out. */
function rutForm(status: number, token: string, notice?: string): Response {
  const body = [
    "<p>Listo, tu correo quedó conectado.</p>",
    "<p>Los bancos mandan el estado de cuenta en un PDF con clave, y esa clave sale de tu RUT. Si me lo das, puedo abrirlos sola y contarte lo que dicen.</p>",
    "<p>Nunca te voy a pedir tu RUT ni ninguna clave por WhatsApp. Si alguien te lo pide por chat, no soy yo.</p>",
    notice ? `<p role="alert"><strong>${escapeHtml(notice)}</strong></p>` : "",
    `<form method="post" action="${RUT_PATH}">`,
    `<input type="hidden" name="token" value="${escapeHtml(token)}">`,
    `<label for="rut">Tu RUT</label>`,
    `<input id="rut" name="rut" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="12.345.678-5" style="${FIELD_STYLE}">`,
    `<button type="submit" name="respuesta" value="permitir" style="${FIELD_STYLE}">Permitir abrir mis estados de cuenta</button>`,
    `<button type="submit" name="respuesta" value="ahora-no" style="${FIELD_STYLE}; background: none">Ahora no</button>`,
    "</form>",
  ].join("");
  return html(status, body);
}

const EMPTY_CONTEXTO: ContextoDePatricia = { deQueVive: null, queLePreocupa: null, queLePesa: null };

/** One answer of the contexto form: trimmed, and null when she left it blank. */
function answer(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

const CONTEXTO_PREGUNTAS: [keyof ContextoDePatricia, string][] = [
  ["deQueVive", "¿De qué vives hoy? Por ejemplo: ventas por catálogo, una pensión, ayuda de tu familia."],
  ["queLePreocupa", "¿Qué tarjetas o deudas son las que más te preocupan?"],
  ["queLePesa", "¿Qué es lo que más te pesa cuando piensas en tus cuentas?"],
];

/** The three optional questions before the page's last message; `values` refills them after a notice. */
function contextoForm(status: number, token: string, values: ContextoDePatricia, notice?: string): Response {
  const body = [
    "<p>Esto me ayuda a entenderte. Puedes dejar cualquiera en blanco.</p>",
    notice ? `<p role="alert"><strong>${escapeHtml(notice)}</strong></p>` : "",
    `<form method="post" action="${CONTEXTO_PATH}">`,
    `<input type="hidden" name="token" value="${escapeHtml(token)}">`,
    ...CONTEXTO_PREGUNTAS.map(
      ([name, pregunta]) =>
        `<label for="${name}">${escapeHtml(pregunta)}</label>` +
        `<textarea id="${name}" name="${name}" rows="3" maxlength="${MAX_ANSWER_LENGTH}" style="${FIELD_STYLE}">${escapeHtml(values[name] ?? "")}</textarea>`,
    ),
    `<button type="submit" name="respuesta" value="guardar" style="${FIELD_STYLE}">Guardar</button>`,
    `<button type="submit" name="respuesta" value="ahora-no" style="${FIELD_STYLE}; background: none">Ahora no</button>`,
    "</form>",
  ].join("");
  return html(status, body);
}

/** Luna's look on Patricia's phone: the message in a white card on Papel, under the logo. */
const PAGE_STYLE = [
  "* { box-sizing: border-box; }",
  `body { margin: 0; padding: 0 16px; background: ${PAPEL}; color: ${TINTA}; font-family: "Instrument Sans", "Helvetica Neue", Arial, sans-serif; font-size: 19px; line-height: 1.5; -webkit-text-size-adjust: 100%; }`,
  ".marca { display: flex; align-items: center; gap: 12px; max-width: 32rem; margin: 0 auto; padding: 28px 0 8px; }",
  ".marca svg { width: 44px; height: 44px; flex: none; }",
  `.marca span { font-family: Archivo, "Helvetica Neue", Arial, sans-serif; font-weight: 800; font-size: 30px; letter-spacing: -0.02em; color: ${NOCHE}; }`,
  "main { max-width: 32rem; margin: 16px auto 48px; padding: 28px 22px; background: #FFFFFF; border-radius: 24px; box-shadow: 0 1px 2px rgba(20, 29, 74, 0.05), 0 12px 32px rgba(20, 29, 74, 0.08); }",
  "p { margin: 0 0 16px; }",
  "p:last-child { margin-bottom: 0; }",
  "label { display: block; font-weight: 600; margin-top: 8px; }",
  `input, textarea { border: 2px solid #DDD5C4; border-radius: 14px; background: #FFFFFF; color: ${TINTA}; font-family: inherit; }`,
  `input:focus, textarea:focus { outline: 3px solid ${NOCHE}; outline-offset: 2px; border-color: ${NOCHE}; }`,
  `button { font-family: inherit; font-weight: 600; min-height: 56px; border: 0; border-radius: 999px; background: ${NOCHE}; color: ${PAPEL}; cursor: pointer; }`,
  `button[value="ahora-no"] { color: ${NOCHE}; border: 2px solid #DDD5C4; }`,
  `button:focus-visible { outline: 3px solid ${LUNA}; outline-offset: 2px; }`,
  `[role="alert"] { background: ${ARENA}; border-radius: 14px; padding: 12px 16px; }`,
].join("\n");

function html(status: number, body: string): Response {
  const document = `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="${PAPEL}"><title>Luna</title>${MARCA_HEAD}<style>${PAGE_STYLE}</style></head><body><header class="marca">${logoIcon()}<span>luna</span></header><main>${body}</main></body></html>`;
  return new Response(document, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
