import { databasePath } from "./config";
import { openDatabase } from "./db";
import type { Clock, Ports } from "./ports";
import { createElevenLabsVoice, type Fetch } from "./voice/elevenlabs";

type Env = Record<string, string | undefined>;

/** A real port was called without the variables it needs. */
export class MissingEnvError extends Error {
  constructor(
    readonly port: string,
    readonly missing: string[],
  ) {
    super(`${port} port needs ${missing.join(", ")}; add them to Doppler pulso-hackathon-2026`);
    this.name = "MissingEnvError";
  }
}

/**
 * The system clock: the time source the demo clock runs on, and the one
 * place allowed to read system time (ADR 0002).
 */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * The values of a port's variables. Real ports call this on each call, not at
 * construction, so the server stays up and `/health` answers without them.
 */
function requireEnv(env: Env, port: string, names: string[]): string[] {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new MissingEnvError(port, missing);
  return names.map((name) => env[name]!);
}

/** Stands in for a client a later ticket wires. */
async function notWiredYet(env: Env, port: string, names: string[]): Promise<never> {
  requireEnv(env, port, names);
  throw new Error(`${port} port: the real client is not wired yet`);
}

/**
 * The ports `main` runs with: the system clock, the SQLite file and the outside
 * services. `fetch` and `log` let tests keep the HTTP clients off the network and the console.
 */
export function realPorts(env: Env = process.env, options: { fetch?: Fetch; log?: (line: string) => void } = {}): Ports {
  return {
    clock: systemClock,
    mail: { fetchNew: () => notWiredYet(env, "mail", ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"]) },
    whatsapp: { send: () => notWiredYet(env, "whatsapp", ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) },
    llm: { complete: () => notWiredYet(env, "llm", ["ANTHROPIC_API_KEY"]) },
    voice: {
      synthesize: async (text) => {
        const [apiKey, voiceId] = requireEnv(env, "voice", ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
        return createElevenLabsVoice({ apiKey: apiKey!, voiceId: voiceId!, fetch: options.fetch, log: options.log }).synthesize(text);
      },
    },
    db: openDatabase(databasePath(env)),
  };
}
