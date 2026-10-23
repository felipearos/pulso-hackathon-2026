import { databasePath } from "./config";
import { openDatabase } from "./db";
import type { Clock, Ports } from "./ports";

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
 * The system clock. This adapter is the one place allowed to read system time
 * (ADR 0002); ticket #22 replaces it with the SQLite demo clock.
 */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Stands in for a client a later ticket wires. Checking the variables on each
 * call, not at construction, keeps the server up and `/health` answering.
 */
async function notWiredYet(env: Env, port: string, names: string[]): Promise<never> {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new MissingEnvError(port, missing);
  throw new Error(`${port} port: the real client is not wired yet`);
}

/** The ports `main` runs with: the system clock, the SQLite file and the outside services. */
export function realPorts(env: Env = process.env): Ports {
  return {
    clock: systemClock,
    mail: { fetchNew: () => notWiredYet(env, "mail", ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"]) },
    whatsapp: { send: () => notWiredYet(env, "whatsapp", ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) },
    llm: { complete: () => notWiredYet(env, "llm", ["ANTHROPIC_API_KEY"]) },
    voice: { synthesize: () => notWiredYet(env, "voice", ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]) },
    db: openDatabase(databasePath(env)),
  };
}
