import type { Database } from "bun:sqlite";

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
};

/** Gmail: the inbox the bank's mails arrive in. `fetchNew` returns only mails not returned before. */
export type Mail = {
  fetchNew(): Promise<IncomingMail[]>;
};

export type OutgoingWhatsApp =
  | { kind: "text"; text: string }
  | { kind: "audio"; audio: Uint8Array; mimeType: string; durationSeconds: number }
  | { kind: "image"; image: Uint8Array; mimeType: string; caption?: string };

/** Meta WhatsApp Cloud: how messages reach Patricia. */
export type WhatsApp = {
  send(message: OutgoingWhatsApp): Promise<{ id: string }>;
};

export type LlmRequest = {
  /** Claude model id; unset means the adapter's default. */
  model?: string;
  system?: string;
  prompt: string;
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

/** ElevenLabs: turns text into spoken audio. */
export type Voice = {
  synthesize(text: string): Promise<SpokenAudio>;
};

/** Everything the app talks to. `main` passes the real ones, tests the fakes. */
export type Ports = {
  /** The raw time source the demo clock runs on; never read by domain code. */
  clock: Clock;
  mail: Mail;
  whatsapp: WhatsApp;
  llm: Llm;
  voice: Voice;
  db: Database;
};
