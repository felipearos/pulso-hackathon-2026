import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import type { Voice } from "../ports";
import type { Simulador } from "../whatsapp/simulador";
import { LUNA, logoAvatar, logoIcon, MARCA_HEAD, NOCHE, PAPEL, TINTA, TINTA_2 } from "../web/marca";
import { guionNoche1 } from "./moments";
import { givenToken, tokenMatches } from "./routes";

/** What the QR pages and the jurado's own audio need. */
export type QrDeps = {
  /** The operator token; unset or empty turns the QR pages and /jurado off entirely. */
  token: string | undefined;
  /** The WhatsApp number the entrada QR opens a chat with (`WHATSAPP_ENTRADA_PHONE`), in any format. */
  entradaPhone: string | undefined;
  /** The public base the jurado QR points at, without a trailing slash. */
  publicBaseUrl: string;
  voice: Pick<Voice, "synthesize">;
  /** The jurado's own simulador, never the canal: nothing reaches Meta or Patricia's conversation. */
  simulador: Simulador;
};

/** How many jurado audios one app run synthesizes; the pase is on a projector, and ElevenLabs is paid. */
export const MAX_AUDIOS_JURADO = 30;

/** How long the pase is; enough that it cannot be guessed. */
const PASE_LENGTH = 22;

/** A nombre: Unicode letters, spaces, apostrophes and hyphens, starting with a letter. */
const NOMBRE = /^\p{L}[\p{L}\p{M} '’-]*$/u;
const MAX_NOMBRE = 40;
/** The most a POST /jurado/audio body may weigh. */
const MAX_BODY_BYTES = 4096;

const NOT_FOUND = () => new Response("Not found", { status: 404 });

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The jurado's pase, derived from the operator token so there is nothing to store; it does not give the token back. */
export function paseDelJurado(token: string): string {
  return createHmac("sha256", token).update("jurado").digest("base64url").slice(0, PASE_LENGTH);
}

/** A projector page: one big line and the QR under it. */
function projectorPage(title: string, line: string, svg: string, link: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Luna · ${escapeHtml(title)}</title>
${MARCA_HEAD}
<style>
html { font-size: max(18px, 1.4vw); }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.2rem; padding: 1.2rem 0; box-sizing: border-box; background: ${PAPEL}; color: ${TINTA}; font-family: "Instrument Sans", "Helvetica Neue", Arial, sans-serif; text-align: center; }
.marca { display: flex; align-items: center; gap: .7rem; }
.marca svg { width: 3.2rem; height: 3.2rem; }
.marca span { font-family: Archivo, "Helvetica Neue", Arial, sans-serif; font-weight: 800; font-size: 2.4rem; letter-spacing: -0.02em; color: ${NOCHE}; }
h1 { font-family: Archivo, "Helvetica Neue", Arial, sans-serif; font-weight: 800; font-size: 2.6rem; line-height: 1.1; margin: 0 1rem; letter-spacing: -0.015em; }
.qr { width: min(48vh, 80vw); box-sizing: border-box; padding: 1.1rem; background: #FFFFFF; border-radius: 1.6rem; box-shadow: 0 1px 2px rgba(20, 29, 74, .05), 0 12px 32px rgba(20, 29, 74, .1); }
.qr svg { width: 100%; height: auto; display: block; }
p { font-size: 1.2rem; margin: 0 1rem; word-break: break-all; color: ${TINTA_2}; }
</style>
</head>
<body>
<header class="marca">${logoIcon()}<span>luna</span></header>
<h1>${escapeHtml(line)}</h1>
<div class="qr">${svg}</div>
<p>${escapeHtml(link)}</p>
</body>
</html>
`;
}

/** The jurado's phone page: Luna asks the name and sends the audio de la noche back, like the simulador's chat. */
function juradoPage(pase: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Luna</title>
${MARCA_HEAD}
<style>
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; background: #EFEAE2; color: ${TINTA}; font-family: "Instrument Sans", "Helvetica Neue", Arial, sans-serif; font-size: 18px; line-height: 1.4; }
.bar { display: flex; align-items: center; gap: .7rem; padding: .7rem 1rem; background: #FFFFFF; border-bottom: 1px solid #DAD8D0; }
.avatar { width: 2.6rem; height: 2.6rem; border-radius: 50%; overflow: hidden; background: ${NOCHE}; flex: none; }
.avatar svg { width: 100%; height: 100%; display: block; }
.bar b { font-family: Archivo, "Helvetica Neue", Arial, sans-serif; font-weight: 700; }
.bar small { display: block; color: ${TINTA_2}; font-size: .8rem; }
.chat { flex: 1; overflow: auto; padding: .9rem; display: flex; flex-direction: column; gap: .5rem; }
.msg { max-width: 88%; border-radius: 12px; padding: .55rem .75rem; background: #fff; align-self: flex-start; box-shadow: 0 1px 0 rgba(0,0,0,.06); }
.msg.yo { background: #D9FDD3; align-self: flex-end; }
.msg audio { width: 16rem; max-width: 100%; display: block; margin-bottom: .4rem; }
.msg.error { background: #FCE8E6; }
form { display: flex; gap: .5rem; padding: .7rem; background: #F7F5F1; border-top: 1px solid #DAD8D0; }
input { flex: 1; min-width: 0; font: inherit; padding: .65rem .9rem; border: 1px solid #DAD8D0; border-radius: 22px; background: #FFFFFF; }
input:focus { outline: 2px solid ${NOCHE}; outline-offset: 1px; }
button { font: inherit; font-weight: 600; padding: .65rem 1.1rem; border: 0; border-radius: 22px; background: ${NOCHE}; color: ${PAPEL}; }
button:focus-visible { outline: 3px solid ${LUNA}; outline-offset: 2px; }
button:disabled { opacity: .5; }
</style>
</head>
<body>
<div class="bar"><div class="avatar">${logoAvatar()}</div><div><b>Luna</b><small>en línea</small></div></div>
<div class="chat" id="chat">
<div class="msg">Hola, soy Luna. ¿Cómo te llamas?</div>
</div>
<form id="form">
<input id="nombre" name="nombre" maxlength="40" autocomplete="given-name" placeholder="Tu nombre" required>
<button id="enviar" type="submit">Enviar</button>
</form>
<script>
const pase = ${JSON.stringify(pase).replace(/</g, "\\u003c")};
const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("nombre");
const button = document.getElementById("enviar");
function bubble(className, text) {
  const div = document.createElement("div");
  div.className = "msg" + (className ? " " + className : "");
  if (text) div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nombre = input.value.trim();
  if (!nombre) return;
  bubble("yo", nombre);
  button.disabled = true;
  const waiting = bubble("", "Grabando tu audio de la noche…");
  try {
    const response = await fetch("/jurado/audio?pase=" + encodeURIComponent(pase), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre }),
    });
    const data = await response.json();
    waiting.remove();
    if (!response.ok) {
      bubble("error", data.error || "No pude grabar tu audio. Prueba de nuevo.");
      return;
    }
    const div = bubble("", "");
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = data.mediaUrl;
    div.appendChild(audio);
    div.appendChild(document.createTextNode(data.text));
    input.value = "";
  } catch {
    waiting.remove();
    bubble("error", "No pude grabar tu audio. Prueba de nuevo.");
  } finally {
    button.disabled = false;
  }
});
</script>
</body>
</html>
`;
}

/**
 * The QR pages the projector shows and the jurado's own audio de la noche.
 * Returns null for any other path. The QR pages take the operator token like
 * every /sala route; /jurado takes the pase the jurado QR carries. Without the
 * right one each answers 404, the same as a path that does not exist.
 */
export function createQrRoutes(deps: QrDeps): (request: Request) => Promise<Response | null> {
  const pase = deps.token ? paseDelJurado(deps.token) : null;
  // Sent counts only audios that went out; inFlight holds a place for those being synthesized, so a burst cannot pass the cap.
  let sent = 0;
  let inFlight = 0;

  const entrada = async () => {
    const digits = (deps.entradaPhone ?? "").replace(/\D/g, "");
    if (!digits) {
      return html(
        "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Luna</title><p>El número de entrada no está configurado (<code>WHATSAPP_ENTRADA_PHONE</code>).</p></html>",
        503,
      );
    }
    const link = `https://wa.me/${digits}?text=Hola%20Luna`;
    const svg = await QRCode.toString(link, { type: "svg", margin: 1 });
    return html(projectorPage("entrada", "Escanéalo y Luna te saluda", svg, link));
  };

  const juradoQr = async (validPase: string) => {
    const link = `${deps.publicBaseUrl}/jurado?pase=${encodeURIComponent(validPase)}`;
    const svg = await QRCode.toString(link, { type: "svg", margin: 1 });
    return html(projectorPage("jurado", "Escanéalo y te llega tu propio audio de la noche", svg, link));
  };

  const audio = async (request: Request, validPase: string) => {
    // The route is public: a nombre fits in far less, so a big body is not read at all.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return Response.json({ error: "El mensaje es demasiado largo." }, { status: 413 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "No entendí el mensaje." }, { status: 400 });
    }
    const raw = typeof body === "object" && body !== null ? (body as { nombre?: unknown }).nombre : undefined;
    const nombre = typeof raw === "string" ? raw.trim() : "";
    if (!nombre || nombre.length > MAX_NOMBRE || !NOMBRE.test(nombre)) {
      return Response.json(
        { error: "Escribe tu nombre: solo letras, hasta 40 caracteres." },
        { status: 400 },
      );
    }
    if (sent + inFlight >= MAX_AUDIOS_JURADO) {
      return Response.json({ error: "Luna ya grabó todos los audios que tenía. ¡Gracias!" }, { status: 429 });
    }
    inFlight += 1;
    try {
      const text = guionNoche1(nombre);
      let spoken;
      try {
        spoken = await deps.voice.synthesize(text);
      } catch (error) {
        console.error(`jurado: voice failed: ${error instanceof Error ? error.message : String(error)}`);
        return Response.json({ error: "No pude grabar tu audio. Prueba de nuevo." }, { status: 502 });
      }
      const { audio, mimeType, durationSeconds } = spoken;
      const { id } = await deps.simulador.send({ kind: "audio", audio, mimeType, durationSeconds });
      sent += 1;
      const mediaUrl = `/jurado/media/${encodeURIComponent(id)}?pase=${encodeURIComponent(validPase)}`;
      return Response.json({ id, text, durationSeconds, mediaUrl }, { status: 201 });
    } finally {
      inFlight -= 1;
    }
  };

  return async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/sala/qr/entrada" || pathname === "/sala/qr/jurado") {
      if (!deps.token || pase === null || !tokenMatches(deps.token, givenToken(request, url))) return NOT_FOUND();
      if (request.method !== "GET") return NOT_FOUND();
      return pathname === "/sala/qr/entrada" ? entrada() : juradoQr(pase);
    }

    if (pathname !== "/jurado" && !pathname.startsWith("/jurado/")) return null;
    if (pase === null || !tokenMatches(pase, url.searchParams.get("pase"))) return NOT_FOUND();

    if (request.method === "GET" && pathname === "/jurado") return html(juradoPage(pase));
    if (request.method === "POST" && pathname === "/jurado/audio") return audio(request, pase);
    const mediaMatch = /^\/jurado\/media\/([^/]+)$/.exec(pathname);
    if (request.method === "GET" && mediaMatch) {
      let media: ReturnType<Simulador["media"]> = null;
      try {
        media = deps.simulador.media(decodeURIComponent(mediaMatch[1]!));
      } catch {
        // A malformed escape in the id is an id that does not exist.
      }
      if (!media) return NOT_FOUND();
      return new Response(media.bytes, { headers: { "content-type": media.mimeType } });
    }
    return NOT_FOUND();
  };
}
