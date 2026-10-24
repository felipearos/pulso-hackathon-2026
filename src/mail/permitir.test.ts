import { describe, expect, spyOn, test } from "bun:test";
import { MissingEnvError } from "../missing-env";
import { createTestApp } from "../testing";
import { checkText } from "../validator/validator";
import { avisoPermitir, permitirUrl } from "./permitir";

const START_URL = "http://localhost/permitir";
const CALLBACK_URL = "http://localhost/gmail/callback";
const RUT_URL = "http://localhost/gmail/rut";
const STATE_TTL_MS = 15 * 60 * 1000;
/** Fictional: 12.345.678 with its módulo-11 dígito verificador. */
const VALID_RUT = "12345678-5";
/** Fictional: 10.000.013, whose dígito verificador is K. */
const VALID_RUT_K = "10000013-K";
/** A contexto already answered, so the RUT tests end on the page's last message. */
const STORED_CONTEXTO = { deQueVive: "Ventas por catálogo", queLePreocupa: null, queLePesa: null };

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
    app.store.updatePatricia({ contexto: STORED_CONTEXTO });
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
    app.store.updatePatricia({ contexto: STORED_CONTEXTO });
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
    app.store.updatePatricia({ rut: VALID_RUT, contexto: STORED_CONTEXTO });

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

const CONTEXTO_URL = "http://localhost/gmail/contexto";
const LISTO_TEXT = "Desde ahora me entero sola";
const RUT_AHORA_NO_TEXT = "no guardé tu RUT";
const PREGUNTAS = [
  "¿De qué vives hoy?",
  "¿Qué tarjetas o deudas son las que más te preocupan?",
  "¿Qué es lo que más te pesa cuando piensas en tus cuentas?",
];

function submitContexto(fields: Record<string, string>): Request {
  return new Request(CONTEXTO_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function read(response: Response): Promise<{ status: number; html: string }> {
  return { status: response.status, html: await response.text() };
}

function tokenOf(html: string): string {
  return /name="token" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

type Path = { name: string; finalText: string; run(app: TestApp): Promise<{ status: number; html: string }> };

/** The three ways the «Permitir» page ends, each run from a fresh callback. */
const PATHS: Path[] = [
  {
    name: "a callback with the RUT already given",
    finalText: LISTO_TEXT,
    async run(app) {
      app.store.updatePatricia({ rut: VALID_RUT });
      const { response, html } = await connect(app);
      return { status: response.status, html };
    },
  },
  {
    name: "«Ahora no» in the RUT form",
    finalText: RUT_AHORA_NO_TEXT,
    async run(app) {
      const { token } = await connect(app);
      return read(await app.handle(submitRut({ token, respuesta: "ahora-no" })));
    },
  },
  {
    name: "a saved RUT",
    finalText: LISTO_TEXT,
    async run(app) {
      const { token } = await connect(app);
      return read(await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT })));
    },
  },
];

/** Runs a path with no contexto stored and returns the contexto form's token. */
async function reachContexto(app: TestApp, path: Path = PATHS[2]!): Promise<string> {
  const token = tokenOf((await path.run(app)).html);
  if (!token) throw new Error("the contexto form did not show");
  return token;
}

function contextoDecisions(app: TestApp) {
  return app.store.decisions().filter((entry) => entry.tipo === "contar-contexto");
}

describe("contexto form", () => {
  for (const path of PATHS) {
    test(`${path.name} shows the contexto form while she has not answered it`, async () => {
      const { app } = createTestApp();

      const { status, html } = await path.run(app);

      expect(status).toBe(200);
      expect(html).toContain("Esto me ayuda a entenderte. Puedes dejar cualquiera en blanco.");
      for (const pregunta of PREGUNTAS) expect(html).toContain(pregunta);
      expect(html).toContain('action="/gmail/contexto"');
      expect(html).toContain('value="guardar"');
      expect(html).toContain('value="ahora-no"');
      expect(html).toContain('maxlength="280"');
      expect(html).not.toContain(path.finalText);
      expect(tokenOf(html)).not.toBe("");
    });

    test(`${path.name} ends on its own page once the contexto is stored`, async () => {
      const { app } = createTestApp();
      app.store.updatePatricia({ contexto: STORED_CONTEXTO });

      const { status, html } = await path.run(app);

      expect(status).toBe(200);
      expect(html).toContain(path.finalText);
      expect(html).not.toContain("Esto me ayuda a entenderte");
    });
  }

  test("Guardar trims, nulls the blanks, stores and ends on the path's page", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);

    const response = await app.handle(
      submitContexto({ token, respuesta: "guardar", deQueVive: "  Ventas por catálogo  ", queLePreocupa: "   ", queLePesa: "La tarjeta de la tienda" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(LISTO_TEXT);
    expect(app.store.getPatricia().contexto).toEqual({
      deQueVive: "Ventas por catálogo",
      queLePreocupa: null,
      queLePesa: "La tarjeta de la tienda",
    });
    const decisions = contextoDecisions(app);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.motivo).toBe("Patricia contó su contexto: 2 de 3 preguntas");
    expect(decisions[0]?.datos).toEqual({});
  });

  test("after «Ahora no» in the RUT form, Guardar ends on that «Ahora no» page", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app, PATHS[1]);

    const response = await app.handle(submitContexto({ token, respuesta: "guardar" }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(RUT_AHORA_NO_TEXT);
    expect(html).not.toContain(LISTO_TEXT);
    expect(app.store.getPatricia().contexto).toEqual({ deQueVive: null, queLePreocupa: null, queLePesa: null });
    expect(contextoDecisions(app)[0]?.motivo).toBe("Patricia contó su contexto: 0 de 3 preguntas");
  });

  test("an answer over 280 characters stores nothing and keeps the token", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);

    const response = await app.handle(
      submitContexto({ token, respuesta: "guardar", deQueVive: "Una pensión", queLePesa: "x".repeat(281) }),
    );
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Una pensión");
    expect(tokenOf(html)).toBe(token);
    expect(app.store.getPatricia().contexto ?? null).toBeNull();
    expect(contextoDecisions(app)).toEqual([]);

    const retry = await app.handle(submitContexto({ token, respuesta: "guardar", queLePesa: "x".repeat(280) }));
    expect(retry.status).toBe(200);
    expect(app.store.getPatricia().contexto?.queLePesa).toBe("x".repeat(280));
  });

  test("the refilled form escapes her answers", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);

    const response = await app.handle(
      submitContexto({ token, respuesta: "guardar", deQueVive: "<script>alert(1)</script>", queLePesa: "x".repeat(281) }),
    );
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&#60;script&#62;");
  });

  test("«Ahora no» stores three nulls so she is not asked again", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);

    const response = await app.handle(submitContexto({ token, respuesta: "ahora-no", deQueVive: "Una pensión" }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(LISTO_TEXT);
    expect(app.store.getPatricia().contexto).toEqual({ deQueVive: null, queLePreocupa: null, queLePesa: null });
    expect(contextoDecisions(app).map((entry) => entry.motivo)).toEqual(["Patricia prefirió no contar su contexto"]);

    const again = await connect(app);
    expect(again.html).toContain(LISTO_TEXT);
    expect(again.token).toBe("");
  });

  test("a token works once, and a forged token writes nothing", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);

    const forged = await app.handle(submitContexto({ token: "forged", respuesta: "guardar", deQueVive: "Otra cosa" }));
    expect(forged.status).toBe(400);
    expect(await forged.text()).toContain("Este link ya no sirve");
    expect(app.store.getPatricia().contexto ?? null).toBeNull();

    expect((await app.handle(submitContexto({ token, respuesta: "guardar", deQueVive: "Una pensión" }))).status).toBe(200);
    const reused = await app.handle(submitContexto({ token, respuesta: "guardar", deQueVive: "Otra cosa" }));
    expect(reused.status).toBe(400);
    expect(app.store.getPatricia().contexto?.deQueVive).toBe("Una pensión");
    expect(contextoDecisions(app)).toHaveLength(1);
  });

  test("a token expires with the same TTL as the state", async () => {
    const { app, clock } = createTestApp();
    const token = await reachContexto(app);
    clock.advance(STATE_TTL_MS + 1);

    const response = await app.handle(submitContexto({ token, respuesta: "guardar", deQueVive: "Una pensión" }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Este link ya no sirve");
    expect(app.store.getPatricia().contexto ?? null).toBeNull();
    expect(contextoDecisions(app)).toEqual([]);
  });

  test("an unknown respuesta writes nothing and keeps the token", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);

    expect((await app.handle(submitContexto({ token, deQueVive: "Una pensión" }))).status).toBe(400);
    expect(app.store.getPatricia().contexto ?? null).toBeNull();
    expect((await app.handle(submitContexto({ token, respuesta: "guardar" }))).status).toBe(200);
  });

  test("an oversized body is refused before anything is stored", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);

    const response = await app.handle(
      submitContexto({ token, respuesta: "guardar", deQueVive: "Una pensión", relleno: "x".repeat(9000) }),
    );

    expect(response.status).toBe(413);
    expect(app.store.getPatricia().contexto ?? null).toBeNull();
    expect(contextoDecisions(app)).toEqual([]);
  });

  test("her answers never reach the console nor the decision", async () => {
    const { app } = createTestApp();
    const token = await reachContexto(app);
    const answers = { deQueVive: "Vendo empanadas", queLePreocupa: "La tarjeta Ripley", queLePesa: "Pagar solo el mínimo" };
    const logged: unknown[] = [];
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      }),
    );

    try {
      const response = await app.handle(submitContexto({ token, respuesta: "guardar", ...answers }));
      expect(response.status).toBe(200);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = logged.map((entry) => String(entry)).join("\n");
    const recorded = JSON.stringify(contextoDecisions(app).map((entry) => [entry.motivo, entry.datos]));
    for (const text of Object.values(answers)) {
      expect(output).not.toContain(text);
      expect(recorded).not.toContain(text);
    }
    expect(app.store.getPatricia().contexto).toEqual(answers);
  });
});

describe("closing the «Permitir» in the chat", () => {
  /** Fictional, like every number in the fixtures. */
  const ENTRADA_PHONE = "+56 9 0000 0000";
  const ENTRADA_LINK = "https://wa.me/56900000000?text=Hola%20Luna";

  const texts = (outbox: { kind: string; text?: string }[]) =>
    outbox.filter((m) => m.kind === "text").map((m) => m.text ?? "");

  /** With the contexto already told, the RUT step is the last one. */
  const closingApp = (options: { entradaPhone?: string } = { entradaPhone: ENTRADA_PHONE }) => {
    const testApp = createTestApp(options);
    testApp.app.store.updatePatricia({ contexto: STORED_CONTEXTO });
    return testApp;
  };

  test("after the RUT, Luna writes in the chat and the page sends her back to it", async () => {
    const { app, whatsapp } = closingApp();
    const nombre = app.store.getPatricia().nombre;
    const { token } = await connect(app);
    expect(texts(whatsapp.outbox)).toEqual([]);

    const response = await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(texts(whatsapp.outbox)).toEqual([avisoPermitir(nombre)]);
    expect(app.store.mensajesSalientes().at(-1)?.text).toBe(avisoPermitir(nombre));
    expect(html).toContain("Te escribí en WhatsApp.");
    expect(html).toContain(`href="${ENTRADA_LINK}"`);
    expect(html).not.toContain("Puedes cerrar esta página");
  });

  test("«Ahora no» and a later callback with the RUT already given close the same way", async () => {
    const declined = closingApp();
    const { token } = await connect(declined.app);
    const ahoraNo = await (await declined.app.handle(submitRut({ token, respuesta: "ahora-no" }))).text();
    expect(ahoraNo).toContain("Volver a WhatsApp");
    expect(texts(declined.whatsapp.outbox)).toHaveLength(1);

    const again = closingApp();
    again.app.store.updatePatricia({ rut: VALID_RUT });
    const { html } = await connect(again.app);
    expect(html).toContain("Volver a WhatsApp");
    expect(texts(again.whatsapp.outbox)).toHaveLength(1);
  });

  test("the RUT form, a declined consent and an invalid RUT send nothing yet", async () => {
    const { app, whatsapp } = closingApp();
    const { token } = await connect(app);
    await app.handle(submitRut({ token, respuesta: "permitir", rut: "1-1" }));
    const { state } = await start(app);
    await app.handle(callback(state, { error: "access_denied" }));

    expect(texts(whatsapp.outbox)).toEqual([]);
  });

  for (const respuesta of ["guardar", "ahora-no"]) {
    test(`while the contexto is untold, Luna writes only once its form ends with «${respuesta}»`, async () => {
      const { app, whatsapp } = createTestApp({ entradaPhone: ENTRADA_PHONE });
      const { token } = await connect(app);
      const form = await (await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }))).text();
      expect(form).toContain('action="/gmail/contexto"');
      expect(texts(whatsapp.outbox)).toEqual([]);

      const html = await (await app.handle(submitContexto({ token: tokenOf(form), respuesta }))).text();

      expect(html).toContain(LISTO_TEXT);
      expect(html).toContain("Te escribí en WhatsApp.");
      expect(html).toContain(`href="${ENTRADA_LINK}"`);
      expect(texts(whatsapp.outbox)).toEqual([avisoPermitir(app.store.getPatricia().nombre)]);
    });
  }

  test("a failed send still closes the page, without claiming Luna wrote", async () => {
    const { app, whatsapp } = closingApp();
    const { token } = await connect(app);
    whatsapp.failNextTexts = 1;

    const response = await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Volver a WhatsApp");
    expect(html).not.toContain("Te escribí en WhatsApp.");
    expect(app.store.decisions().at(-1)?.motivo).toContain("no salió el aviso");
  });

  test("the aviso has no figure and passes the validador's code checks", () => {
    expect(checkText(avisoPermitir("Patricia"), [])).toEqual([]);
  });

  test("without an entrada number the page just says it can be closed", async () => {
    const { app, whatsapp } = closingApp({ entradaPhone: undefined });
    const { token } = await connect(app);

    const html = await (await app.handle(submitRut({ token, respuesta: "permitir", rut: VALID_RUT }))).text();

    expect(html).toContain("Puedes cerrar esta página.");
    expect(html).not.toContain("Volver a WhatsApp");
    expect(texts(whatsapp.outbox)).toHaveLength(1);
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
