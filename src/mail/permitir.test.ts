import { describe, expect, spyOn, test } from "bun:test";
import { MissingEnvError } from "../missing-env";
import { createTestApp } from "../testing";

const START_URL = "http://localhost/gmail/permitir";
const CALLBACK_URL = "http://localhost/gmail/callback";
const STATE_TTL_MS = 15 * 60 * 1000;

async function start(app: ReturnType<typeof createTestApp>["app"]): Promise<{ response: Response; state: string }> {
  const response = await app.handle(new Request(START_URL));
  const location = response.headers.get("location");
  if (!location) throw new Error("Permitir did not return a location");
  return { response, state: new URL(location).searchParams.get("state") ?? "" };
}

function callback(state: string, values: Record<string, string>): Request {
  const url = new URL(CALLBACK_URL);
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return new Request(url.toString());
}

describe("Permitir routes", () => {
  test("starts consent and records the successful callback", async () => {
    const { app, mail } = createTestApp();
    app.store.updatePatricia({ gmailPermitido: false });
    expect(app.store.getPatricia().gmailPermitido).toBe(false);

    const { response, state } = await start(app);
    expect(response.status).toBe(302);
    expect(state).not.toBe("");
    expect(response.headers.get("location")).toBe(
      `https://accounts.example.test/consent?state=${encodeURIComponent(state)}`,
    );

    const connected = await app.handle(callback(state, { code: "abc" }));

    expect(connected.status).toBe(200);
    expect(mail.connected).toEqual(["abc"]);
    expect(app.store.getPatricia().gmailPermitido).toBe(true);
    expect(app.store.decisions().map((decision) => decision.tipo)).toContain("permitir-correo");
  });

  test("accepts a state only once and rejects unknown states", async () => {
    const { app, mail } = createTestApp();
    const { state } = await start(app);

    expect((await app.handle(callback(state, { code: "abc" }))).status).toBe(200);
    expect((await app.handle(callback(state, { code: "again" }))).status).toBe(400);
    expect((await app.handle(callback("unknown-state", { code: "stranger" }))).status).toBe(400);
    expect(mail.connected).toEqual(["abc"]);
  });

  test("rejects a callback after the state expires", async () => {
    const { app, clock, mail } = createTestApp();
    const { state } = await start(app);
    clock.advance(STATE_TTL_MS + 1);

    const response = await app.handle(callback(state, { code: "too-late" }));

    expect(response.status).toBe(400);
    expect(mail.connected).toEqual([]);
  });

  test("a declined consent leaves Gmail disconnected", async () => {
    const { app, mail } = createTestApp();
    app.store.updatePatricia({ gmailPermitido: false });
    const { state } = await start(app);

    const response = await app.handle(callback(state, { error: "access_denied" }));

    expect(response.status).toBe(200);
    expect(mail.connected).toEqual([]);
    expect(app.store.getPatricia().gmailPermitido).toBe(false);
    expect(app.store.decisions()).toEqual([]);
  });

  test("a failed connection returns 502 and leaves permission unchanged", async () => {
    const { app, mail } = createTestApp();
    app.store.updatePatricia({ gmailPermitido: false });
    mail.connect = async () => {
      throw new Error("temporary exchange failure");
    };
    const { state } = await start(app);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await app.handle(callback(state, { code: "abc" }));
      expect(response.status).toBe(502);
      expect(app.store.getPatricia().gmailPermitido).toBe(false);
      expect(app.store.decisions()).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a missing consent configuration returns 503", async () => {
    const { app, mail } = createTestApp();
    mail.consentUrl = () => {
      throw new MissingEnvError("mail", ["GMAIL_CLIENT_ID"]);
    };
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await app.handle(new Request(START_URL));
      expect(response.status).toBe(503);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("leaves non-GET Permitir requests and unrelated routes to the normal router", async () => {
    const { app } = createTestApp();

    expect((await app.handle(new Request(START_URL, { method: "POST" }))).status).toBe(404);
    expect((await app.handle(new Request(CALLBACK_URL, { method: "POST" }))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/other"))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/health"))).status).toBe(200);
  });
});
