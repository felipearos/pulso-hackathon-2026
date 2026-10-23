import { describe, expect, test } from "bun:test";
import { migrate, openDatabase } from "../db";
import { MissingEnvError } from "../missing-env";
import { FIRST_LOOKBACK_MS, GmailAuthError, GmailNotConnectedError, createGmailAccount } from "./gmail-oauth";

const NOW = new Date("2026-10-23T12:00:00.000Z");
const CLIENT_ID = "fictional-client-id";
const CLIENT_SECRET = "fictional-client-secret";
const REDIRECT_URI = "https://luna.example.test/gmail/callback";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type RecordedRequest = { url: URL; init: RequestInit | undefined };
type FetchHandler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

function makeAccount(handler: FetchHandler = () => Response.json({ access_token: "access" })) {
  const db = openDatabase(":memory:");
  migrate(db);
  let current = new Date(NOW);
  const requests: RecordedRequest[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    requests.push({ url, init });
    return handler(url, init);
  };
  const account = createGmailAccount({
    db,
    env: { GMAIL_CLIENT_ID: CLIENT_ID, GMAIL_CLIENT_SECRET: CLIENT_SECRET, GMAIL_REDIRECT_URI: REDIRECT_URI },
    clock: { now: () => new Date(current) },
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });
  return {
    db,
    account,
    requests,
    setNow(date: Date) {
      current = new Date(date);
    },
  };
}

function tokenForm(request: RecordedRequest): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(request.init?.body as URLSearchParams));
}

describe("createGmailAccount", () => {
  test("builds a read-only consent URL with offline access and the supplied state", () => {
    const { account } = makeAccount();

    const url = new URL(account.consentUrl("state-123"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
  });

  test("reports every missing OAuth environment variable", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const account = createGmailAccount({ db, env: {}, clock: { now: () => new Date(NOW) } });

    let caught: unknown;
    try {
      account.consentUrl("state");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MissingEnvError);
    expect((caught as MissingEnvError).missing).toEqual([
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "GMAIL_REDIRECT_URI",
    ]);
  });

  test("exchanges the code and starts the cursor at the first lookback", async () => {
    const { account, requests } = makeAccount(() =>
      Response.json({ access_token: "first-access", refresh_token: "first-refresh", expires_in: 3600 }),
    );

    await account.connect("authorization-code");

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.toString()).toBe(TOKEN_URL);
    expect(requests[0]!.init?.method).toBe("POST");
    expect(tokenForm(requests[0]!)).toMatchObject({
      code: "authorization-code",
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });
    expect(account.cursor()).toEqual({ ms: NOW.getTime() - FIRST_LOOKBACK_MS, ids: [] });
  });

  test("reconnect keeps the cursor and existing refresh token when Google omits one", async () => {
    let exchange = 0;
    const { account, db } = makeAccount(() => {
      exchange += 1;
      return exchange === 1
        ? Response.json({ access_token: "first-access", refresh_token: "original-refresh", expires_in: 3600 })
        : Response.json({ access_token: "second-access", expires_in: 3600 });
    });
    await account.connect("first-code");
    account.saveCursor({ ms: 987_654, ids: ["mail-a", "mail-b"] });

    await account.connect("second-code");

    const row = db.query<{ refresh_token: string }, []>("SELECT refresh_token FROM gmail_cuenta WHERE id = 1").get();
    expect(row?.refresh_token).toBe("original-refresh");
    expect(account.cursor()).toEqual({ ms: 987_654, ids: ["mail-a", "mail-b"] });
  });

  test("returns an access token while it remains outside the expiry margin", async () => {
    const { account, requests } = makeAccount(() =>
      Response.json({ access_token: "still-valid", refresh_token: "refresh", expires_in: 3600 }),
    );
    await account.connect("code");

    await expect(account.accessToken()).resolves.toBe("still-valid");
    expect(requests).toHaveLength(1);
  });

  test("refreshes an expiring access token and stores Google's rotated refresh token", async () => {
    let requestNumber = 0;
    const { account, db, requests, setNow } = makeAccount(() => {
      requestNumber += 1;
      return requestNumber === 1
        ? Response.json({ access_token: "old-access", refresh_token: "old-refresh", expires_in: 120 })
        : Response.json({ access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600 });
    });
    await account.connect("code");
    setNow(new Date(NOW.getTime() + 61_000));

    await expect(account.accessToken()).resolves.toBe("new-access");

    expect(requests).toHaveLength(2);
    expect(requests[1]!.url.toString()).toBe(TOKEN_URL);
    expect(requests[1]!.init?.method).toBe("POST");
    expect(tokenForm(requests[1]!)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(
      db.query<{ access_token: string; refresh_token: string }, []>(
        "SELECT access_token, refresh_token FROM gmail_cuenta WHERE id = 1",
      ).get(),
    ).toEqual({ access_token: "new-access", refresh_token: "rotated-refresh" });
  });

  test("requires a connected account for token and cursor operations", async () => {
    const { account } = makeAccount();

    await expect(account.accessToken()).rejects.toBeInstanceOf(GmailNotConnectedError);
    expect(() => account.cursor()).toThrow(GmailNotConnectedError);
    expect(() => account.saveCursor({ ms: 1, ids: [] })).toThrow(GmailNotConnectedError);
  });

  test("does not expose credentials or Google's description when refresh is refused", async () => {
    const { account, setNow } = makeAccount((_url, init) => {
      const grantType = new URLSearchParams(init?.body as URLSearchParams).get("grant_type");
      if (grantType === "authorization_code") {
        return Response.json({ access_token: "initial-access", refresh_token: "secret-refresh", expires_in: 1 });
      }
      return Response.json(
        { error: "invalid_grant", error_description: "secret-ish" },
        { status: 400 },
      );
    });
    await account.connect("code");
    setNow(new Date(NOW.getTime() + 2_000));

    let caught: unknown;
    try {
      await account.accessToken();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GmailAuthError);
    expect((caught as GmailAuthError).googleError).toBe("invalid_grant");
    expect((caught as Error).message).not.toContain("secret-refresh");
    expect((caught as Error).message).not.toContain(CLIENT_SECRET);
    expect((caught as Error).message).not.toContain("secret-ish");
  });
});
