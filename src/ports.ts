/** The demo clock: the only source of domain time (ADR 0002). */
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
