import { databasePath } from "./config";
import { openDatabase } from "./db";
import { MissingEnvError } from "./missing-env";
import type { Clock, Ports } from "./ports";
import { claudeCliLlm } from "./claude-cli";
import { createElevenLabsTranscriber, createElevenLabsVoice, type Fetch } from "./voice/elevenlabs";
import { voiceIdFor, VOZ_PRINCIPAL } from "./voice/voces";
import { createHttpWeb } from "./web/http";
import { createWhatsAppCloud } from "./whatsapp-cloud";
import { createGmailAccount } from "./mail/gmail-oauth";
import { createGmailMail } from "./mail/gmail";
import { withSampleDocuments } from "./mail/samples";

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

/**
 * The ports `main` runs with: the system clock, the SQLite file and the outside
 * services. `fetch` and `log` let tests keep the HTTP clients off the network and the console.
 */
export function realPorts(env: Env = process.env, options: { fetch?: Fetch; log?: (line: string) => void } = {}): Ports {
  const db = openDatabase(databasePath(env));
  const account = createGmailAccount({ db, env, clock: systemClock, fetch: options.fetch as typeof fetch | undefined });
  const mail = createGmailMail({ account, fetch: options.fetch as typeof fetch | undefined });
  return {
    clock: systemClock,
    mail,
    // The whatsapp, llm and voice ports are also real clients.
    whatsapp: createWhatsAppCloud({ env, clock: systemClock }),
    // Claude runs through the Claude Code CLI logged in on this machine, never an API key.
    llm: claudeCliLlm({ command: env.CLAUDE_BIN }),
    voice: {
      synthesize: async (text, voz) => {
        // Requiring the principal id is what makes the fallback in voiceIdFor always a string.
        const [apiKey] = requireEnv(env, "voice", ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
        const voiceId = voiceIdFor(voz ?? VOZ_PRINCIPAL, env)!;
        return createElevenLabsVoice({ apiKey: apiKey!, voiceId, fetch: options.fetch, log: options.log }).synthesize(text);
      },
      transcribe: async (audio, mimeType) => {
        const [apiKey] = requireEnv(env, "voice", ["ELEVENLABS_API_KEY"]);
        return createElevenLabsTranscriber({ apiKey: apiKey!, fetch: options.fetch, log: options.log }).transcribe(audio, mimeType);
      },
    },
    // The /sala tienda sample links to a `.example` domain, so its PDF is served from the fixture.
    web: withSampleDocuments(createHttpWeb({ fetch: options.fetch })),
    db,
  };
}
