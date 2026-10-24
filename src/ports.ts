import type { Database } from "bun:sqlite";
import type { Voz } from "./voice/voces";

/**
 * Something that tells the time. The app's `ports.clock` is only the raw time
 * source the demo clock runs on; domain code reads `App.clock` (ADR 0002).
 */
export type Clock = {
  now(): Date;
};

export type IncomingMail = {
  id: string;
  from: string;
  subject: string;
  text: string;
  receivedAt: Date;
  links: string[];
  /** PDF attachments, set only when at least one was kept. */
  adjuntos?: AdjuntoCorreo[];
};

/** A PDF attached to a mail, as downloaded from the inbox. */
export type AdjuntoCorreo = { nombre: string; mimeType: string; bytes: Uint8Array };

/**
 * Gmail: the inbox the bank's mails arrive in. `fetchNew` returns only mails
 * not returned before, and only from `senders` (allowed sender domains): the
 * rest are never downloaded. `consentUrl` and `connect` are Patricia's one
 * «Permitir»: the Google page she is sent to, and the code it hands back.
 * Only PDF attachments of non-suspicious mails come along, each under a size cap.
 */
export type Mail = {
  fetchNew(senders: readonly string[]): Promise<IncomingMail[]>;
  /** Google's read-only consent page; `state` comes back on the callback untouched. */
  consentUrl(state: string): string;
  /** Trades the callback's code for a token kept in the base, outside the repo. */
  connect(code: string): Promise<void>;
};

export type OutgoingWhatsApp =
  /** `button` sends the text with one button that opens `url`, in place of a bare link. */
  | { kind: "text"; text: string; button?: { label: string; url: string } }
  | { kind: "audio"; audio: Uint8Array; mimeType: string; durationSeconds: number }
  | { kind: "image"; image: Uint8Array; mimeType: string; caption?: string };

/** A file Patricia sent by WhatsApp, such as a nota de voz, as downloaded from Meta. */
export type IncomingMedia = { bytes: Uint8Array; mimeType: string };

/**
 * Meta WhatsApp Cloud: how messages reach Patricia. `recordInbound` is how the
 * webhook tells the port that she wrote, which opens Meta's 24 h window; outside
 * it only the approved template goes out.
 */
export type WhatsApp = {
  send(message: OutgoingWhatsApp): Promise<{ id: string }>;
  recordInbound(at: Date): void;
  /**
   * Downloads the media an incoming message carries, by the id the webhook
   * received. Optional while other branches still build `WhatsApp` without it:
   * unset means a nota de voz cannot be heard.
   */
  downloadMedia?(mediaId: string): Promise<IncomingMedia>;
};

export type LlmImage = { bytes: Uint8Array; mimeType: string };

export type LlmRequest = {
  /** Claude model id; unset means the adapter's default. */
  model?: string;
  system?: string;
  prompt: string;
  /** Images Claude sees before the prompt (vision); unset means text only. */
  images?: readonly LlmImage[];
  /** Longest answer in tokens; unset means the adapter's default. */
  maxTokens?: number;
  /** How long to wait for the answer; unset means the adapter's default. */
  timeoutMs?: number;
};

/** Claude: turns a prompt into text. */
export type Llm = {
  complete(request: LlmRequest): Promise<string>;
};

export type SpokenAudio = {
  audio: Uint8Array;
  mimeType: string;
  durationSeconds: number;
};

/**
 * ElevenLabs: turns text into spoken audio, in the voz given (the principal
 * voice when none is), and a nota de voz back into text.
 */
export type Voice = {
  synthesize(text: string, voz?: Voz): Promise<SpokenAudio>;
  /**
   * ElevenLabs speech-to-text; returns the transcript text. Optional while
   * other branches still build `Voice` without it: unset means a nota de voz
   * cannot be heard.
   */
  transcribe?(audio: Uint8Array, mimeType: string): Promise<string>;
};

export type WebDocument = { contentType: string; body: Uint8Array };

/**
 * The web: downloads the page or PDF a mail links to, only from `domains`
 * (allowed link domains); any other URL, or a redirect out of them, is refused.
 */
export type Web = { fetchDocument(url: string, domains: readonly string[]): Promise<WebDocument> };

/** Everything the app talks to. `main` passes the real ones, tests the fakes. */
export type Ports = {
  /** The raw time source the demo clock runs on; never read by domain code. */
  clock: Clock;
  mail: Mail;
  whatsapp: WhatsApp;
  llm: Llm;
  voice: Voice;
  /**
   * Where Luna downloads what a mail links to, only from allowed link domains.
   * Optional while other branches still build `Ports` without it: unset refuses every link.
   */
  web?: Web;
  db: Database;
};
