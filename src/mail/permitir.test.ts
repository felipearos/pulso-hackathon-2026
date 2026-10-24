import { describe, expect, spyOn, test } from "bun:test";
import { MissingEnvError } from "../missing-env";
import { createTestApp } from "../testing";
import { permitirUrl } from "./permitir";

const START_URL = "http://localhost/permitir";
const CALLBACK_URL = "http://localhost/gmail/callback";
const RUT_URL = "http://localhost/gmail/rut";
const STATE_TTL_MS = 15 * 60 * 1000;
/** Fictional: 12.345.678 with its módulo-11 dígito verificador. */
const VALID_RUT = "12345678-5";
/** Fictional: 10.000.013, whose dígito verificador is K. */
const VALID_RUT_K = "10000013-K";

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

type TestApp = ReturnType<typeof createTestApp>["app"];

/** Runs a full «Permitir» and returns the RUT form's page and its hidden token. */
async function connect(app: TestApp): Promise<{ response: Response; html: string; token: string }> {
  const { state } = await start(app);
  const response = await app.handle(callback(state, { code: "abc" }));
  const html = await response.text();
  const token = /name="token" value="([^"]+)"/.exec(html)?.[1] ?? "";
  return { response, html, token };
}

function submitRut(fields: Record<string, string>): Request {
  return new Request(RUT_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
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
    expect((await app.handle(new Request(RUT_URL))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/other"))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/health"))).status).toBe(200);
  });
});

describe("RUT form", () => {
  test("a successful callback shows the RUT form with both buttons and a hidden token", async () => {
    const { app } = createTestApp();

    const { response, html, token } = await connect(app);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("Permitir abrir mis estados de cuenta");
    expect(html).toContain("Ahora no");
    expect(html).toContain("por WhatsApp");
    expect(html).toContain('action="/gmail/rut"');
    expect(token).not.toBe("");
  });

  test("a valid RUT with dots and a lowercase k is stored normalized and recorded without it", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);

    const response = await app.handle(submitRut({ token, respuesta: "permitir", rut: "10.000.013-k" }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Listo");
    expect(app.store.getPatricia().rut).toBe(VALID_RUT_K);
    const decision = app.store.decisions().find((entry) => entry.tipo === "permitir-rut");
    expect(decision?.datos).toEqual({});
    const recorded = JSON.stringify(app.store.decisions());
    expect(recorded).not.toContain("10000013");
    expect(recorded).not.toContain("10.000.013");
  });

  test("an invalid RUT shows the form again, stores nothing and keeps the token", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);

    const response = await app.handle(submitRut({ token, respuesta: "permitir", rut: "12.345.678-4" }));
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain("Ese RUT no me calza");
    expect(html).toContain(`value="${token}"`);
    expect(html).not.toContain("12.345.678-4");
    expect(app.store.getPatricia().rut ?? null).toBeNull();
    expect(app.store.decisions().map((entry) => entry.tipo)).not.toContain("permitir-rut");

    const retry = await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }));
    expect(retry.status).toBe(200);
    expect(app.store.getPatricia().rut).toBe(VALID_RUT);
  });

  test("a token works once, and a forged or missing token writes nothing", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);

    expect((await app.handle(submitRut({ token: "forged", respuesta: "permitir", rut: VALID_RUT }))).status).toBe(400);
    expect((await app.handle(submitRut({ respuesta: "permitir", rut: VALID_RUT }))).status).toBe(400);
    expect(app.store.getPatricia().rut ?? null).toBeNull();

    expect((await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }))).status).toBe(200);
    expect((await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT_K }))).status).toBe(400);
    expect(app.store.getPatricia().rut).toBe(VALID_RUT);
  });

  test("a token expires with the same TTL as the state", async () => {
    const { app, clock } = createTestApp();
    const { token } = await connect(app);
    clock.advance(STATE_TTL_MS + 1);

    const response = await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }));

    expect(response.status).toBe(400);
    expect(app.store.getPatricia().rut ?? null).toBeNull();
  });

  test("«Ahora no» leaves the RUT empty and the correo connected", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);

    const response = await app.handle(submitRut({ token, respuesta: "ahora-no", rut: VALID_RUT }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Está bien");
    expect(app.store.getPatricia().rut ?? null).toBeNull();
    expect(app.store.getPatricia().gmailPermitido).toBe(true);
    expect((await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }))).status).toBe(400);
  });

  test("«Ahora no» clears a RUT given before", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);
    app.store.updatePatricia({ rut: VALID_RUT });

    await app.handle(submitRut({ token, respuesta: "ahora-no" }));

    expect(app.store.getPatricia().rut).toBeNull();
  });

  test("an unknown respuesta writes nothing and keeps the token", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);

    expect((await app.handle(submitRut({ token, rut: VALID_RUT }))).status).toBe(400);
    expect(app.store.getPatricia().rut ?? null).toBeNull();
    expect((await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }))).status).toBe(200);
  });

  test("once she gave her RUT, a later callback does not ask again", async () => {
    const { app } = createTestApp();
    app.store.updatePatricia({ rut: VALID_RUT });

    const { response, html, token } = await connect(app);

    expect(response.status).toBe(200);
    expect(html).toContain("Listo");
    expect(html).not.toContain("Permitir abrir mis estados de cuenta");
    expect(token).toBe("");
    expect(app.store.getPatricia().rut).toBe(VALID_RUT);
  });

  test("an oversized body is refused before anything is stored", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);

    const response = await app.handle(
      submitRut({ token, respuesta: "permitir", rut: VALID_RUT, relleno: "x".repeat(5000) }),
    );

    expect(response.status).toBe(413);
    expect(app.store.getPatricia().rut ?? null).toBeNull();
  });

  test("a valid submit logs nothing that contains the RUT", async () => {
    const { app } = createTestApp();
    const { token } = await connect(app);
    const logged: unknown[] = [];
    const spies = (["log", "error", "warn", "info"] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      }),
    );

    try {
      const response = await app.handle(submitRut({ token, respuesta: "permitir", rut: "12.345.678-5" }));
      expect(response.status).toBe(200);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = logged.map((entry) => String(entry)).join("\n");
    expect(output).not.toContain("12345678");
    expect(output).not.toContain("12.345.678");
  });
});

describe("permitirUrl", () => {
  test("defaults to the Funnel URL", () => {
    expect(permitirUrl({})).toBe("https://desktop.taild8ed7e.ts.net/permitir");
  });

  test("uses PUBLIC_BASE_URL without its trailing slashes", () => {
    expect(permitirUrl({ PUBLIC_BASE_URL: "https://example.test//" })).toBe("https://example.test/permitir");
  });
});
