import type {
  Clock,
  IncomingMail,
  IncomingMedia,
  Llm,
  LlmRequest,
  Mail,
  OutgoingWhatsApp,
  SpokenAudio,
  Voice,
  Web,
  WebDocument,
  WhatsApp,
} from "./ports";
import { senderDomain } from "./mail/senders";
import { VOZ_PRINCIPAL, type Voz } from "./voice/voces";
import { allowedLink } from "./web/link";

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export type InjectedMail = Pick<IncomingMail, "from" | "subject" | "receivedAt"> &
  Partial<Pick<IncomingMail, "id" | "text" | "links">>;

export class FakeMail implements Mail {
  private pending: IncomingMail[] = [];
  private nextId = 1;
  /** Codes `connect` was given, oldest first. */
  readonly connected: string[] = [];

  consentUrl(state: string): string {
    return `https://accounts.example.test/consent?state=${encodeURIComponent(state)}`;
  }

  async connect(code: string): Promise<void> {
    this.connected.push(code);
  }

  inject(mail: InjectedMail): IncomingMail {
    const full: IncomingMail = {
      id: mail.id ?? `mail-${this.nextId++}`,
      from: mail.from,
      subject: mail.subject,
      text: mail.text ?? "",
      receivedAt: mail.receivedAt,
      links: mail.links ?? [],
    };
    this.pending.push(full);
    return full;
  }

  /** Drains the queue; mails from other senders are dropped, as if Gmail never handed them over. */
  async fetchNew(senders: readonly string[]): Promise<IncomingMail[]> {
    const allowed = new Set(senders.map((s) => s.toLowerCase()));
    const drained = this.pending.filter((m) => {
      const domain = senderDomain(m.from);
      return domain !== null && allowed.has(domain);
    });
    this.pending = [];
    return drained;
  }
}

export class FakeWhatsApp implements WhatsApp {
  readonly outbox: OutgoingWhatsApp[] = [];
  readonly inbound: Date[] = [];
  /** The next this-many text sends throw instead of reaching the outbox. */
  failNextTexts = 0;
  /** By media id; a test fills it with what Patricia sent. */
  readonly media = new Map<string, IncomingMedia>();
  readonly downloads: string[] = [];

  async send(message: OutgoingWhatsApp): Promise<{ id: string }> {
    if (message.kind === "text" && this.failNextTexts > 0) {
      this.failNextTexts--;
      throw new Error("FakeWhatsApp failed on purpose");
    }
    this.outbox.push(message);
    return { id: `wamid-${this.outbox.length}` };
  }

  recordInbound(at: Date): void {
    this.inbound.push(new Date(at.getTime()));
  }

  async downloadMedia(mediaId: string): Promise<IncomingMedia> {
    this.downloads.push(mediaId);
    const media = this.media.get(mediaId);
    if (!media) throw new Error(`FakeWhatsApp has no media ${mediaId}`);
    return media;
  }
}

export class FakeLlm implements Llm {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly table: Array<[match: string | RegExp, reply: string]>) {}

  async complete(request: LlmRequest): Promise<string> {
    this.calls.push(request);
    for (const [match, reply] of this.table) {
      const found = typeof match === "string" ? request.prompt.includes(match) : match.test(request.prompt);
      if (found) return reply;
    }
    throw new Error(`FakeLlm has no reply for prompt: "${request.prompt.slice(0, 80)}"`);
  }
}

export class FakeVoice implements Voice {
  readonly calls: string[] = [];
  /** The voz of each call, in the same order as `calls`. */
  readonly voces: Voz[] = [];
  readonly transcribed: Array<{ bytes: number; mimeType: string }> = [];
  private readonly durations: number[];
  private failures: number;
  private readonly transcripts: string[];
  private transcribeFailures: number;

  /**
   * Each `synthesize` takes the next of `durations` (3 s once they run out); the first `failures` calls throw.
   * Each `transcribe` takes the next of `transcripts` and throws once they run out; the first `transcribeFailures` calls throw.
   */
  constructor(
    options: { durations?: number[]; failures?: number; transcripts?: string[]; transcribeFailures?: number } = {},
  ) {
    this.durations = [...(options.durations ?? [])];
    this.failures = options.failures ?? 0;
    this.transcripts = [...(options.transcripts ?? [])];
    this.transcribeFailures = options.transcribeFailures ?? 0;
  }

  async synthesize(text: string, voz?: Voz): Promise<SpokenAudio> {
    this.calls.push(text);
    this.voces.push(voz ?? VOZ_PRINCIPAL);
    const durationSeconds = this.durations.shift() ?? 3;
    if (this.failures > 0) {
      this.failures--;
      throw new Error("FakeVoice failed on purpose");
    }
    return {
      audio: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
      mimeType: "audio/ogg",
      durationSeconds,
    };
  }

  async transcribe(audio: Uint8Array, mimeType: string): Promise<string> {
    this.transcribed.push({ bytes: audio.length, mimeType });
    if (this.transcribeFailures > 0) {
      this.transcribeFailures--;
      throw new Error("FakeVoice failed to transcribe on purpose");
    }
    const transcript = this.transcripts.shift();
    if (transcript === undefined) throw new Error("FakeVoice has no transcript");
    return transcript;
  }
}

export class FakeWeb implements Web {
  readonly calls: string[] = [];
  /** By url; a test may add or remove entries between fetches. */
  readonly documents: Map<string, WebDocument>;

  /** A string document is served as UTF-8 HTML. */
  constructor(documents: Record<string, WebDocument | string> = {}) {
    this.documents = new Map(
      Object.entries(documents).map(([url, doc]) => [
        url,
        typeof doc === "string" ? { contentType: "text/html; charset=utf-8", body: new TextEncoder().encode(doc) } : doc,
      ]),
    );
  }

  async fetchDocument(url: string, domains: readonly string[]): Promise<WebDocument> {
    this.calls.push(url);
    if (allowedLink(url, domains) === null) throw new Error(`web: refused link outside the allowed domains: ${url}`);
    const doc = this.documents.get(url);
    if (!doc) throw new Error(`FakeWeb has no document for ${url}`);
    return doc;
  }
}
