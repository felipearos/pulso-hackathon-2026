import type { Database } from "bun:sqlite";
import { MissingEnvError } from "../missing-env";
import type { Clock } from "../ports";

/*
 * Patricia's one «Permitir»: Google's OAuth with the read-only Gmail scope. The
 * refresh token Google hands back lives in the base (`gmail_cuenta`), never in
 * the repo, and the short-lived access token is renewed from it on demand.
 * No token ever reaches an error message or a log line: errors carry the HTTP
 * status and Google's error code only.
 */

type Env = Record<string, string | undefined>;

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_VARS = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REDIRECT_URI"];
/** An access token this close to expiry is renewed before use. */
const EXPIRY_MARGIN_MS = 60_000;
/** On the first «Permitir», a mail that arrived this long before still counts. */
export const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Where the poll stands: the newest Gmail internalDate seen, and the ids seen at exactly that time. */
export type GmailCursor = { ms: number; ids: string[] };

/** The poll ran before Patricia's «Permitir» stored a token. */
export class GmailNotConnectedError extends Error {
  constructor() {
    super("gmail: no account connected yet; Patricia has to open the «Permitir» link");
    this.name = "GmailNotConnectedError";
  }
}

/** Google refused a token request. `googleError` is Google's code, e.g. `invalid_grant` for a revoked token. */
export class GmailAuthError extends Error {
  constructor(
    readonly step: "exchange" | "refresh",
    readonly status: number,
    readonly googleError: string,
  ) {
    super(`gmail: token ${step} failed (${status} ${googleError})`);
    this.name = "GmailAuthError";
  }
}

export type GmailAccount = {
  /** Google's consent page for `gmail.readonly`; asks for offline access so a refresh token comes back. */
  consentUrl(state: string): string;
  /** Trades the callback's code for tokens and stores them; the cursor survives a reconnect. */
  connect(code: string): Promise<void>;
  /** Whether her «Permitir» stored a token yet. */
  isConnected(): boolean;
  /** A valid access token, renewed through the refresh token when close to expiry. */
  accessToken(): Promise<string>;
  cursor(): GmailCursor;
  saveCursor(cursor: GmailCursor): void;
};

export type GmailAccountDeps = {
  db: Database;
  env: Env;
  /** Raw time source: token expiry and the first cursor are real Gmail time, not the demo clock. */
  clock: Clock;
  fetch?: typeof fetch;
};

type Row = {
  refresh_token: string;
  access_token: string | null;
  access_expires_at: number | null;
  cursor_ms: number;
  cursor_ids: string;
};

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; error?: string };

export function createGmailAccount(deps: GmailAccountDeps): GmailAccount {
  const { db, env, clock } = deps;
  const doFetch = deps.fetch ?? fetch;

  const vars = () => {
    const missing = OAUTH_VARS.filter((name) => !env[name]);
    if (missing.length > 0) throw new MissingEnvError("mail", missing);
    return { clientId: env.GMAIL_CLIENT_ID!, clientSecret: env.GMAIL_CLIENT_SECRET!, redirectUri: env.GMAIL_REDIRECT_URI! };
  };

  const row = (): Row | null =>
    db
      .query<Row, []>(
        "SELECT refresh_token, access_token, access_expires_at, cursor_ms, cursor_ids FROM gmail_cuenta WHERE id = 1",
      )
      .get();

  const tokenRequest = async (step: "exchange" | "refresh", params: Record<string, string>): Promise<TokenResponse> => {
    const response = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    let body: TokenResponse = {};
    try {
      body = (await response.json()) as TokenResponse;
    } catch {
      // A non-JSON answer still fails below on its status.
    }
    if (!response.ok || !body.access_token) {
      // Only Google's short error code goes into the message, never the body.
      const code = typeof body.error === "string" ? body.error.slice(0, 60) : "no_access_token";
      throw new GmailAuthError(step, response.status, code);
    }
    return body;
  };

  const expiresAt = (body: TokenResponse) => clock.now().getTime() + (body.expires_in ?? 3600) * 1000;

  return {
    consentUrl(state) {
      const { clientId, redirectUri } = vars();
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GMAIL_SCOPE,
        access_type: "offline",
        // Without `consent` Google skips the refresh token on a second «Permitir».
        prompt: "consent",
        state,
      });
      // Pre-selects Patricia's account so Google skips its account chooser.
      if (env.GMAIL_LOGIN_HINT) params.set("login_hint", env.GMAIL_LOGIN_HINT);
      return `${AUTH_URL}?${params}`;
    },

    async connect(code) {
      const { clientId, clientSecret, redirectUri } = vars();
      const body = await tokenRequest("exchange", {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      const existing = row();
      const refreshToken = body.refresh_token ?? existing?.refresh_token;
      if (!refreshToken) throw new GmailAuthError("exchange", 200, "no_refresh_token");
      const now = clock.now();
      db.run(
        `INSERT INTO gmail_cuenta (id, refresh_token, access_token, access_expires_at, cursor_ms, cursor_ids, conectada_at)
         VALUES (1, ?, ?, ?, ?, '[]', ?)
         ON CONFLICT (id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token,
           access_expires_at = excluded.access_expires_at, conectada_at = excluded.conectada_at`,
        [refreshToken, body.access_token!, expiresAt(body), now.getTime() - FIRST_LOOKBACK_MS, now.toISOString()],
      );
    },

    isConnected() {
      return row() !== null;
    },

    async accessToken() {
      const current = row();
      if (!current) throw new GmailNotConnectedError();
      if (current.access_token && (current.access_expires_at ?? 0) - EXPIRY_MARGIN_MS > clock.now().getTime()) {
        return current.access_token;
      }
      const { clientId, clientSecret } = vars();
      const body = await tokenRequest("refresh", {
        refresh_token: current.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      });
      // Google may rotate the refresh token; keep the newest one.
      db.run("UPDATE gmail_cuenta SET access_token = ?, access_expires_at = ?, refresh_token = ? WHERE id = 1", [
        body.access_token!,
        expiresAt(body),
        body.refresh_token ?? current.refresh_token,
      ]);
      return body.access_token!;
    },

    cursor() {
      const current = row();
      if (!current) throw new GmailNotConnectedError();
      return { ms: current.cursor_ms, ids: JSON.parse(current.cursor_ids) as string[] };
    },

    saveCursor(cursor) {
      if (!row()) throw new GmailNotConnectedError();
      db.run("UPDATE gmail_cuenta SET cursor_ms = ?, cursor_ids = ? WHERE id = 1", [cursor.ms, JSON.stringify(cursor.ids)]);
    },
  };
}
