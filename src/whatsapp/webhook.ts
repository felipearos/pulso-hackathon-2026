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
  /**
   * The name on her WhatsApp profile as Meta sends it, raw and unchecked;
   * absent when the delivery carried no contact with a name.
   */
  perfilNombre?: string;
  body:
    | { kind: "text"; text: string }
    | { kind: "audio"; mediaId: string; mimeType: string | null }
    | { kind: "image"; mediaId: string; mimeType: string | null }
    /** She answered Luna's audio with an emoji instead of writing; the emoji is the answer. */
    | { kind: "reaction"; emoji: string; toWhatsappId: string | null }
    | { kind: "other"; type: string };
};

export type WebhookDeps = {
  config: WebhookConfig;
  /** Claims the id for processing; false means it was taken before. */
  claim(whatsappId: string): boolean;
  /**
   * Gives a claimed id back after processing failed, so the message is not lost
   * for good: the 200 is already sent, so without this the id stays claimed and
   * every later delivery of it is discarded as a retry.
   */
  release(whatsappId: string): void;
  /** Processes one message, after the 200 has been sent. Rejections must not escape. */
  onMensaje(mensaje: InboundMensaje): Promise<void>;
  /** Called with every message taken in, before `onMensaje`; opens Meta's 24 h window. */
  recordInbound(at: Date): void;
  /**
   * The demo clock; stands in for `when` when Meta's timestamp is unreadable.
   * Meta's own timestamp is real time, so on that path `recordInbound` and the
   * port's 24 h window agree. On this fallback they only agree while the demo
   * clock is unset — an edge case kept deliberately, because ADR 0002 leaves
   * the app no other clock to read.
   */
  now(): Date;
  log?: (line: string, detail?: unknown) => void;
};

export type Webhook = {
  /** `GET /webhook/whatsapp`: Meta's subscription challenge. */
  verify(url: URL): Response;
  /** `POST /webhook/whatsapp`: one delivery. Returns before processing finishes. */
  receive(request: Request): Promise<Response>;
  /**
   * Takes in a message that did not come through Meta (the simulador's page):
   * claimed and processed like a delivered one, but without `recordInbound`,
   * because only a message Meta saw opens Meta's 24 h window. False means the
   * id was taken before and nothing is processed.
   */
  inject(mensaje: InboundMensaje): boolean;
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

/** One message object as delivered, with the `contacts` of the change it came in. */
type RawMessage = { message: unknown; contacts: unknown };

/** Every message object in the delivery, across all entries and changes. */
function rawMessages(payload: unknown): RawMessage[] {
  if (!isObject(payload) || !Array.isArray(payload.entry)) return [];
  const messages: RawMessage[] = [];
  for (const entry of payload.entry) {
    if (!isObject(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      // Status-only changes (delivery receipts) carry no `messages` and are skipped here.
      if (!isObject(change) || !isObject(change.value) || !Array.isArray(change.value.messages)) continue;
      const contacts = change.value.contacts;
      for (const message of change.value.messages) messages.push({ message, contacts });
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
  if (type === "reaction") return reactionBody(message.reaction, type);
  return { kind: "other", type };
}

/**
 * Reacting 👍 to Luna's audio is how most people answer on WhatsApp, so a
 * reaction carries the same weight as the emoji typed out. An empty `emoji`
 * means she removed a reaction, which says nothing.
 */
function reactionBody(reaction: unknown, type: string): InboundMensaje["body"] {
  if (!isObject(reaction)) return { kind: "other", type };
  const emoji = stringField(reaction, "emoji");
  if (emoji === null || emoji === "") return { kind: "other", type };
  return { kind: "reaction", emoji, toWhatsappId: stringField(reaction, "message_id") };
}

/**
 * The profile name of the contact whose `wa_id` is the sender, else of the
 * first contact; null when there is none or it is not a non-empty string.
 */
function profileName(contacts: unknown, from: string): string | null {
  if (!Array.isArray(contacts)) return null;
  const objects = contacts.filter(isObject);
  const contact = objects.find((candidate) => stringField(candidate, "wa_id") === from) ?? objects[0];
  if (contact === undefined || !isObject(contact.profile)) return null;
  const name = stringField(contact.profile, "name");
  return name === null || name === "" ? null : name;
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

  function toMensaje({ message: raw, contacts }: RawMessage): InboundMensaje | null {
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
    const from = stringField(raw, "from") ?? "";
    const perfilNombre = profileName(contacts, from);
    return {
      whatsappId,
      from,
      when,
      ...(perfilNombre === null ? {} : { perfilNombre }),
      body: bodyOf(raw),
    };
  }

  function start(mensaje: InboundMensaje): void {
    // Deliberately not awaited: Meta needs its 200 before Luna has finished
    // thinking. The handler waits for a macrotask, not a microtask, so the 200
    // is on its way before any processing begins whatever the message is —
    // a microtask would run before the caller of `receive` saw the response.
    const task: Promise<void> = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => deps.onMensaje(mensaje))
      .catch((error: unknown) => {
        // The write is one transaction, so a rejection means nothing landed:
        // give the id back, or a redelivery of this message is read as a retry
        // of one already taken in and Patricia's answer disappears.
        log("whatsapp webhook: handler failed, releasing the claim", { whatsappId: mensaje.whatsappId, error });
        try {
          deps.release(mensaje.whatsappId);
        } catch (releaseError: unknown) {
          // Nothing left to do but say so: this task must never reject.
          log("whatsapp webhook: could not release the claim", { whatsappId: mensaje.whatsappId, releaseError });
        }
      })
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  }

  /** Claims the id and, when it was free, opens the window if asked and starts processing. */
  function takeIn(mensaje: InboundMensaje, opensWindow: boolean): boolean {
    if (!deps.claim(mensaje.whatsappId)) return false;
    if (opensWindow) deps.recordInbound(mensaje.when);
    start(mensaje);
    return true;
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
    for (const rawMessage of rawMessages(payload)) {
      const mensaje = toMensaje(rawMessage);
      if (mensaje === null) continue;
      if (!takeIn(mensaje, true)) {
        log("whatsapp webhook: already taken, skipping a meta retry", { whatsappId: mensaje.whatsappId });
        continue;
      }
      received += 1;
    }
    return Response.json({ received });
  }

  async function drain(): Promise<void> {
    // A handler still running may start more work, so wait until the set stays empty.
    while (inFlight.size > 0) await Promise.allSettled(inFlight);
  }

  function inject(mensaje: InboundMensaje): boolean {
    return takeIn(mensaje, false);
  }

  return { verify, receive, inject, drain };
}
