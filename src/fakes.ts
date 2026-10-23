import type {
  Clock,
  IncomingMail,
  Llm,
  LlmRequest,
  Mail,
  OutgoingWhatsApp,
  SpokenAudio,
  Voice,
  WhatsApp,
} from "./ports";
import { dominioDe } from "./mail/remitentes";

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
      const dominio = dominioDe(m.from);
      return dominio !== null && allowed.has(dominio);
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

  async synthesize(text: string): Promise<SpokenAudio> {
    this.calls.push(text);
    return {
      audio: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
      mimeType: "audio/ogg",
      durationSeconds: 3,
    };
  }
}
