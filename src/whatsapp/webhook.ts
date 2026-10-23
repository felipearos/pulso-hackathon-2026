import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The HTTP half of Meta's WhatsApp webhook. Meta retries any delivery that does
 * not get a 200 within a few seconds, and Luna's answer (Claude, then ElevenLabs,
 * then the upload) takes longer than that, so this module answers first and
 * processes after: it checks the signature, claims each message id so a retry is
 * never processed twice, and hands the message to `onMensaje` without waiting.
 *
 * It knows nothing about intenciones or Patricia; whatever the message means is
 * the handler's business.
 */

export type WebhookConfig = {
  /** Meta's app secret; the key the X-Hub-Signature-256 HMAC is checked with. */
  appSecret?: string;
  /** The token echoed back in Meta's GET subscription challenge. */
  verifyToken?: string;
};

export type InboundMensaje = {
  /** Meta's message id (`wamid.…`), the key processing is deduplicated by. */
  whatsappId: string;
  /** Her phone number as Meta reports it, international form, no plus. */
  from: string;
  when: Date;
  body:
    | { kind: "text"; text: string }
    | { kind: "audio"; mediaId: string; mimeType: string | null }
    | { kind: "image"; mediaId: string; mimeType: string | null }
    | { kind: "other"; type: string };
};

export type WebhookDeps = {
  config: WebhookConfig;
  /** Claims the id for processing; false means it was taken before. */
  claim(whatsappId: string): boolean;
  /** Processes one message, after the 200 has been sent. Rejections must not escape. */
  onMensaje(mensaje: InboundMensaje): Promise<void>;
  /** Called with every message taken in, before `onMensaje`; opens Meta's 24 h window. */
  recordInbound(at: Date): void;
  /** The demo clock; stands in for `when` when Meta's timestamp is unreadable. */
  now(): Date;
  log?: (line: string, detail?: unknown) => void;
};

export type Webhook = {
  /** `GET /webhook/whatsapp`: Meta's subscription challenge. */
  verify(url: URL): Response;
  /** `POST /webhook/whatsapp`: one delivery. Returns before processing finishes. */
  receive(request: Request): Promise<Response>;
  /** Resolves once every message taken in so far has been processed. */
  drain(): Promise<void>;
};

const SIGNATURE_PREFIX = "sha256=";
const HEX = /^[0-9a-f]+$/i;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(object: Json, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}

function plainText(status: number, text: string): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

/**
 * Whether `header` is Meta's HMAC of `body`; no secret configured never passes.
 * `body` is the bytes as they arrived, never a decoded and re-encoded string:
 * a byte Meta signed that does not survive the round trip through UTF-8 would
 * turn every delivery into a 401, which is the hardest failure here to read.
 */
function signatureMatches(body: Buffer, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith(SIGNATURE_PREFIX)) return false;
  const hex = header.slice(SIGNATURE_PREFIX.length);
  if (!HEX.test(hex) || hex.length % 2 !== 0) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest();
  const given = Buffer.from(hex, "hex");
  // timingSafeEqual throws on unequal lengths; a short signature is just a mismatch.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Every message object in the delivery, across all entries and changes. */
function rawMessages(payload: unknown): unknown[] {
  if (!isObject(payload) || !Array.isArray(payload.entry)) return [];
  const messages: unknown[] = [];
  for (const entry of payload.entry) {
    if (!isObject(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      // Status-only changes (delivery receipts) carry no `messages` and are skipped here.
      if (!isObject(change) || !isObject(change.value) || !Array.isArray(change.value.messages)) continue;
      messages.push(...change.value.messages);
    }
  }
  return messages;
}

function mediaBody(kind: "audio" | "image", media: unknown): InboundMensaje["body"] {
  const mediaId = isObject(media) ? stringField(media, "id") : null;
  if (mediaId === null) return { kind: "other", type: kind };
  return { kind, mediaId, mimeType: isObject(media) ? stringField(media, "mime_type") : null };
}

function bodyOf(message: Json): InboundMensaje["body"] {
  const type = stringField(message, "type") ?? "unknown";
  if (type === "text") {
    const text = isObject(message.text) ? stringField(message.text, "body") : null;
    return text === null ? { kind: "other", type } : { kind: "text", text };
  }
  if (type === "audio" || type === "image") return mediaBody(type, message[type]);
  return { kind: "other", type };
}

/** Meta's timestamp is unix seconds as a string; null when it is unreadable. */
function parseWhen(timestamp: unknown): Date | null {
  if (typeof timestamp !== "string" && typeof timestamp !== "number") return null;
  if (typeof timestamp === "string" && timestamp.trim() === "") return null;
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

export function createWebhook(deps: WebhookDeps): Webhook {
  const log = deps.log ?? ((line: string, detail?: unknown) => console.error(line, detail ?? ""));
  const inFlight = new Set<Promise<void>>();

  function toMensaje(raw: unknown): InboundMensaje | null {
    if (!isObject(raw)) {
      log("whatsapp webhook: skipped a message that is not an object");
      return null;
    }
    const whatsappId = stringField(raw, "id");
    if (whatsappId === null) {
      log("whatsapp webhook: skipped a message with no id", { type: raw.type });
      return null;
    }
    let when = parseWhen(raw.timestamp);
    if (when === null) {
      log("whatsapp webhook: unreadable timestamp, using the demo clock", { whatsappId });
      when = deps.now();
    }
    return { whatsappId, from: stringField(raw, "from") ?? "", when, body: bodyOf(raw) };
  }

  function start(mensaje: InboundMensaje): void {
    // Deliberately not awaited: Meta needs its 200 before Luna has finished thinking.
    const task: Promise<void> = Promise.resolve()
      .then(() => deps.onMensaje(mensaje))
      .catch((error: unknown) => log("whatsapp webhook: handler failed", { whatsappId: mensaje.whatsappId, error }))
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  }

  function verify(url: URL): Response {
    const params = url.searchParams;
    const challenge = params.get("hub.challenge");
    const token = params.get("hub.verify_token");
    const expected = deps.config.verifyToken;
    if (!expected || params.get("hub.mode") !== "subscribe" || token !== expected || challenge === null) {
      return plainText(403, "forbidden");
    }
    // Meta compares the body literally, so the challenge goes back bare.
    return plainText(200, challenge);
  }

  async function receive(request: Request): Promise<Response> {
    const raw = Buffer.from(await request.arrayBuffer());
    if (!signatureMatches(raw, request.headers.get("X-Hub-Signature-256"), deps.config.appSecret)) {
      return plainText(401, "invalid signature");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      log("whatsapp webhook: body is not JSON", { error: String(error) });
      return plainText(400, "invalid json");
    }

    let received = 0;
    for (const raw of rawMessages(payload)) {
      const mensaje = toMensaje(raw);
      if (mensaje === null) continue;
      if (!deps.claim(mensaje.whatsappId)) {
        log("whatsapp webhook: already taken, skipping a meta retry", { whatsappId: mensaje.whatsappId });
        continue;
      }
      deps.recordInbound(mensaje.when);
      start(mensaje);
      received += 1;
    }
    return Response.json({ received });
  }

  async function drain(): Promise<void> {
    // A handler still running may start more work, so wait until the set stays empty.
    while (inFlight.size > 0) await Promise.allSettled(inFlight);
  }

  return { verify, receive, drain };
}
