import type {
  Clock,
  IncomingMail,
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

  async send(message: OutgoingWhatsApp): Promise<{ id: string }> {
    this.outbox.push(message);
    return { id: `wamid-${this.outbox.length}` };
  }

  recordInbound(at: Date): void {
    this.inbound.push(new Date(at.getTime()));
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
  private readonly durations: number[];
  private failures: number;

  /** Each call takes the next of `durations` (3 s once they run out); the first `failures` calls throw. */
  constructor(options: { durations?: number[]; failures?: number } = {}) {
    this.durations = [...(options.durations ?? [])];
    this.failures = options.failures ?? 0;
  }

  async synthesize(text: string): Promise<SpokenAudio> {
    this.calls.push(text);
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
