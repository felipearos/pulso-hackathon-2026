import type { Clock, OutgoingWhatsApp, WhatsApp } from "./ports";
import { MissingEnvError } from "./missing-env";

/*
 * Meta WhatsApp Cloud client. Outside the 24 h customer-service window Meta only
 * accepts an approved template, so a closed window sends the `audio_noche`
 * template instead of the free-form message: the cita goes out as the template
 * and the audio waits for Patricia's reply (spec #17).
 */

type Env = Record<string, string | undefined>;

const REQUIRED = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_RECIPIENT_PHONE"];
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const DETAIL_LIMIT = 200;

/** One failed attempt to reach Meta. Never carries the access token. */
export type SendLogEntry = {
  at: Date;
  kind: OutgoingWhatsApp["kind"] | "template";
  attempt: number;
  status: number | null;
  detail: string;
};

/** Everything the client needs from outside; only `clock` is required. */
export type WhatsAppCloudDeps = {
  env?: Env;
  clock: Clock;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (entry: SendLogEntry) => void;
};

/** The WhatsApp port plus the window's inbound record and the failure log. */
export type WhatsAppCloud = WhatsApp & {
  recordInbound(at: Date): void;
  readonly failures: SendLogEntry[];
};

/** Thrown when every attempt failed, or the madrugada stopped the retries. */
export class WhatsAppSendError extends Error {
  constructor(
    readonly attempts: SendLogEntry[],
    stoppedByMadrugada: boolean,
  ) {
    const count = `${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`;
    super(
      stoppedByMadrugada
        ? `whatsapp send failed after ${count}; the madrugada stopped the retries`
        : `whatsapp send failed after ${count}`,
    );
    this.name = "WhatsAppSendError";
  }
}

const santiagoTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santiago",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

/** Whether `now` falls in the madrugada: 00:00 to 05:30, America/Santiago. */
export function isMadrugada(now: Date): boolean {
  const parts = santiagoTime.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute < 5 * 60 + 30;
}

type Config = {
  token: string;
  baseUrl: string;
  to: string;
  templateName: string;
  templateLanguage: string;
};

/** Reads the variables on each call so the server starts with none set. */
function readConfig(env: Env): Config {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new MissingEnvError("whatsapp", missing);
  const version = env.WHATSAPP_API_VERSION || "v21.0";
  return {
    token: env.WHATSAPP_ACCESS_TOKEN as string,
    baseUrl: `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID as string}`,
    to: env.WHATSAPP_RECIPIENT_PHONE as string,
    templateName: env.WHATSAPP_TEMPLATE_NAME || "audio_noche",
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE || "es",
  };
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extensionOf(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim();
  if (!subtype) return "bin";
  return subtype === "jpeg" ? "jpg" : subtype;
}

/** Shortens Meta's error body and strips the token in case it was echoed back. */
function shortDetail(text: string, token: string): string {
  return text.split(token).join("[redacted]").slice(0, DETAIL_LIMIT);
}

/** Builds the real WhatsApp port on top of Meta's Cloud API. */
export function createWhatsAppCloud(deps: WhatsAppCloudDeps): WhatsAppCloud {
  const env = deps.env ?? process.env;
  const { clock } = deps;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? realSleep;
  const log = deps.log ?? ((entry: SendLogEntry) => console.error("whatsapp send failed", entry));
  const failures: SendLogEntry[] = [];
  let lastInbound: Date | undefined;

  function windowOpen(): boolean {
    if (!lastInbound) return false;
    return clock.now().getTime() - lastInbound.getTime() < WINDOW_MS;
  }

  function fail(entry: SendLogEntry, attempts: SendLogEntry[]): void {
    attempts.push(entry);
    failures.push(entry);
    log(entry);
  }

  /** Sends one request with retries; returns the parsed JSON body of the 2xx response. */
  async function request(
    config: Config,
    kind: SendLogEntry["kind"],
    path: string,
    init: () => { body: string | FormData; json: boolean },
  ): Promise<unknown> {
    const attempts: SendLogEntry[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        if (isMadrugada(clock.now())) throw new WhatsAppSendError(attempts, true);
        await sleep(1000 * 2 ** (attempt - 2));
      }
      const { body, json } = init();
      const headers: Record<string, string> = { Authorization: `Bearer ${config.token}` };
      if (json) headers["Content-Type"] = "application/json";
      let response: Response;
      try {
        response = await doFetch(`${config.baseUrl}${path}`, { method: "POST", headers, body });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail({ at: clock.now(), kind, attempt, status: null, detail: shortDetail(detail, config.token) }, attempts);
        continue;
      }
      if (response.ok) return response.json();
      const text = await response.text().catch(() => "");
      fail({ at: clock.now(), kind, attempt, status: response.status, detail: shortDetail(text, config.token) }, attempts);
    }
    throw new WhatsAppSendError(attempts, false);
  }

  async function postMessage(config: Config, kind: SendLogEntry["kind"], payload: object): Promise<{ id: string }> {
    const body = JSON.stringify({ messaging_product: "whatsapp", to: config.to, ...payload });
    const result = (await request(config, kind, "/messages", () => ({ body, json: true }))) as {
      messages?: Array<{ id?: string }>;
    };
    return { id: result.messages?.[0]?.id ?? "" };
  }

  async function uploadMedia(
    config: Config,
    kind: SendLogEntry["kind"],
    bytes: Uint8Array,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const form = () => {
      const data = new FormData();
      data.append("messaging_product", "whatsapp");
      data.append("type", mimeType);
      data.append("file", new Blob([bytes], { type: mimeType }), filename);
      return { body: data, json: false };
    };
    const result = (await request(config, kind, "/media", form)) as { id?: string };
    if (!result.id) throw new Error("whatsapp media upload returned no id");
    return result.id;
  }

  async function send(message: OutgoingWhatsApp): Promise<{ id: string }> {
    const config = readConfig(env);
    if (message.kind === "audio" && !message.mimeType.startsWith("audio/ogg")) {
      throw new Error(`whatsapp audio got ${message.mimeType}; a nota de voz needs OGG/Opus (audio/ogg)`);
    }
    if (!windowOpen()) {
      return postMessage(config, "template", {
        type: "template",
        template: { name: config.templateName, language: { code: config.templateLanguage } },
      });
    }
    switch (message.kind) {
      case "text":
        return postMessage(config, "text", { type: "text", text: { body: message.text } });
      case "audio": {
        const id = await uploadMedia(config, "audio", message.audio, message.mimeType, "audio.ogg");
        return postMessage(config, "audio", { type: "audio", audio: { id } });
      }
      case "image": {
        const filename = `imagen.${extensionOf(message.mimeType)}`;
        const id = await uploadMedia(config, "image", message.image, message.mimeType, filename);
        const image = message.caption === undefined ? { id } : { id, caption: message.caption };
        return postMessage(config, "image", { type: "image", image });
      }
    }
  }

  return {
    send,
    recordInbound(at: Date) {
      lastInbound = new Date(at.getTime());
    },
    failures,
  };
}
