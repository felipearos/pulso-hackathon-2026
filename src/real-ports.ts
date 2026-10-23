import { databasePath } from "./config";
import { openDatabase } from "./db";
import { MissingEnvError } from "./missing-env";
import type { Clock, Ports } from "./ports";
import { anthropicLlm } from "./anthropic";
import { createElevenLabsVoice, type Fetch } from "./voice/elevenlabs";
import { voiceIdFor, VOZ_PRINCIPAL } from "./voice/voces";
import { createWhatsAppCloud } from "./whatsapp-cloud";

type Env = Record<string, string | undefined>;

export { MissingEnvError };

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
    // The whatsapp, llm and voice ports are the real clients wired so far.
    whatsapp: createWhatsAppCloud({ env, clock: systemClock }),
    llm: {
      complete: (request) => {
        const apiKey = env.ANTHROPIC_API_KEY;
        if (!apiKey) return Promise.reject(new MissingEnvError("llm", ["ANTHROPIC_API_KEY"]));
        return anthropicLlm({ apiKey }).complete(request);
      },
    },
    voice: {
      synthesize: async (text, voz) => {
        // Requiring the principal id is what makes the fallback in voiceIdFor always a string.
        const [apiKey] = requireEnv(env, "voice", ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
        const voiceId = voiceIdFor(voz ?? VOZ_PRINCIPAL, env)!;
        return createElevenLabsVoice({ apiKey: apiKey!, voiceId, fetch: options.fetch, log: options.log }).synthesize(text);
      },
    },
    db: openDatabase(databasePath(env)),
  };
}
