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

/** A hold a test put on a fake: `reached` resolves once a call waits on it, `release` lets that call go on. */
export type Hold = { reached: Promise<void>; release: () => void };

type PendingHold<T> = { matches: (value: T) => boolean; arrive: () => void; released: Promise<void> };

function addHold<T>(holds: PendingHold<T>[], matches: (value: T) => boolean): Hold {
  let arrive!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  holds.push({ matches, arrive, released });
  return { reached, release };
}

/**
 * The release of the first hold `value` matches, which is used up by it, or
 * null with no match, so an unheld call awaits nothing extra.
 */
function heldBy<T>(holds: PendingHold<T>[], value: T): Promise<void> | null {
  const index = holds.findIndex((hold) => hold.matches(value));
  if (index === -1) return null;
  const [hold] = holds.splice(index, 1);
  hold!.arrive();
  return hold!.released;
}

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
  /** The next this-many image sends throw instead of reaching the outbox. */
  failNextImages = 0;
  private readonly holds: PendingHold<OutgoingWhatsApp>[] = [];

  /**
   * Holds the next send of `match` (a message kind, a predicate, or any send
   * when omitted) before it reaches the outbox, until the hold is released.
   */
  hold(match?: OutgoingWhatsApp["kind"] | ((message: OutgoingWhatsApp) => boolean)): Hold {
    const matches =
      match === undefined ? () => true : typeof match === "string" ? (m: OutgoingWhatsApp) => m.kind === match : match;
    return addHold(this.holds, matches);
  }

  async send(message: OutgoingWhatsApp): Promise<{ id: string }> {
    const held = heldBy(this.holds, message);
    if (held) await held;
    if (message.kind === "text" && this.failNextTexts > 0) {
      this.failNextTexts--;
      throw new Error("FakeWhatsApp failed on purpose");
    }
    if (message.kind === "image" && this.failNextImages > 0) {
      this.failNextImages--;
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
  private readonly holds: PendingHold<LlmRequest>[] = [];

  constructor(private readonly table: Array<[match: string | RegExp, reply: string]>) {}

  /** Holds the next call whose prompt has `match` (any call when omitted), after it is recorded, until released. */
  hold(match?: string | RegExp): Hold {
    return addHold(this.holds, ({ prompt }) =>
      match === undefined ? true : typeof match === "string" ? prompt.includes(match) : match.test(prompt),
    );
  }

  async complete(request: LlmRequest): Promise<string> {
    this.calls.push(request);
    const held = heldBy(this.holds, request);
    if (held) await held;
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
  private readonly holds: PendingHold<string>[] = [];

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

  /** Holds the next `synthesize`, after it is recorded, until released. */
  holdSynthesis(): Hold {
    return addHold(this.holds, () => true);
  }

  async synthesize(text: string, voz?: Voz): Promise<SpokenAudio> {
    this.calls.push(text);
    this.voces.push(voz ?? VOZ_PRINCIPAL);
    const held = heldBy(this.holds, text);
    if (held) await held;
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
