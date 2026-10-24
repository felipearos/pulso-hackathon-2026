import { describe, expect, test } from "bun:test";
import { PATRICIA_RUT_FICTICIO } from "../patricia/fixtures";
import { createTestApp } from "../testing";
import type { PrimerPaso } from "./primeros-pasos";

const TOKEN = "operador-secreto-de-prueba";
const HEADERS = { "x-demo-token": TOKEN };
const EXPECTED_IDS: PrimerPaso["id"][] = ["saludo", "bienvenida", "respuesta", "permitir", "rut", "contexto"];
const ANSWER = "Dime Andrea, sí me acomoda la hora y quiero otra voz";

type State = { primerosPasos: PrimerPaso[] };

async function post(app: ReturnType<typeof createTestApp>["app"], path: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, { method: "POST", headers: HEADERS }));
}

async function postJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  body: unknown,
): Promise<Response> {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function readState(app: ReturnType<typeof createTestApp>["app"]): Promise<{ state: State; text: string }> {
  const response = await app.handle(new Request("http://localhost/sala/state", { headers: HEADERS }));
  expect(response.status).toBe(200);
  const text = await response.text();
  return { state: JSON.parse(text) as State, text };
}

async function expectHechos(
  app: ReturnType<typeof createTestApp>["app"],
  expected: PrimerPaso["id"][],
): Promise<{ state: State; text: string }> {
  const result = await readState(app);
  expect(result.state.primerosPasos.map(({ id }) => id)).toEqual(EXPECTED_IDS);
  expect(result.state.primerosPasos.filter(({ hecho }) => hecho).map(({ id }) => id)).toEqual(expected);
  for (const paso of result.state.primerosPasos) {
    expect(paso.hecho).toBe(expected.includes(paso.id));
    expect(paso.at !== null).toBe(paso.hecho);
  }
  return result;
}

function tokenOf(html: string): string {
  return /name="token" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

function formPost(path: string, fields: Record<string, string>): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("the primeros pasos app flow", () => {
  test("marks each first step in order through the app", async () => {
    const { app, llm, mail } = createTestApp({
      demoToken: TOKEN,
      simulador: true,
      llm: [
        ["Mensaje de Patricia", '{"intencion":"hello"}'],
        ["Respuesta de Patricia a la bienvenida", '{"nombre":"Andrea","hora":null,"acomoda":true}'],
      ],
    });

    expect((await post(app, "/sala/reset")).status).toBe(200);
    await expectHechos(app, []);

    const incoming = await postJson(app, "/sala/simulador/mensaje", { text: "Hola, Luna" });
    expect(incoming.status).toBe(202);
    await app.drain();
    await expectHechos(app, ["saludo"]);

    expect((await post(app, "/sala/momentos/lun-2230")).status).toBe(200);
    await expectHechos(app, ["saludo", "bienvenida"]);

    const welcomeAnswer = await postJson(app, "/sala/simulador/mensaje", { text: ANSWER });
    expect(welcomeAnswer.status).toBe(202);
    await app.drain();
    expect(llm.calls.some(({ prompt }) => prompt.includes("Respuesta de Patricia a la bienvenida"))).toBe(true);
    await expectHechos(app, ["saludo", "bienvenida", "respuesta"]);

    const start = await app.handle(new Request("http://localhost/permitir"));
    expect(start.status).toBe(302);
    const location = start.headers.get("location");
    if (!location) throw new Error("Permitir did not redirect to Google");
    const consentState = new URL(location).searchParams.get("state");
    if (!consentState) throw new Error("Permitir did not include a state token");

    const callbackUrl = new URL("http://localhost/gmail/callback");
    callbackUrl.searchParams.set("state", consentState);
    callbackUrl.searchParams.set("code", "fictional-code");
    const callback = await app.handle(new Request(callbackUrl.toString()));
    expect(callback.status).toBe(200);
    expect(mail.connected).toEqual(["fictional-code"]);
    const rutToken = tokenOf(await callback.text());
    expect(rutToken).not.toBe("");
    await expectHechos(app, ["saludo", "bienvenida", "respuesta", "permitir"]);

    const rutResponse = await app.handle(
      formPost("/gmail/rut", { token: rutToken, respuesta: "permitir", rut: PATRICIA_RUT_FICTICIO }),
    );
    expect(rutResponse.status).toBe(200);
    const contextoToken = tokenOf(await rutResponse.text());
    expect(contextoToken).not.toBe("");
    const afterRut = await expectHechos(app, ["saludo", "bienvenida", "respuesta", "permitir", "rut"]);
    for (const privateValue of [
      PATRICIA_RUT_FICTICIO,
      PATRICIA_RUT_FICTICIO.replace("-", ""),
      "33457982",
      "33.457.982",
    ]) {
      expect(afterRut.text).not.toContain(privateValue);
    }

    const contextoResponse = await app.handle(
      formPost("/gmail/contexto", {
        token: contextoToken,
        respuesta: "guardar",
        deQueVive: "vendo por catálogo",
        queLePreocupa: "quedar en DICOM",
      }),
    );
    expect(contextoResponse.status).toBe(200);
    const afterContexto = await expectHechos(app, [
      "saludo",
      "bienvenida",
      "respuesta",
      "permitir",
      "rut",
      "contexto",
    ]);
    const contexto = afterContexto.state.primerosPasos.find(({ id }) => id === "contexto");
    expect(contexto?.detalle).toStartWith("2 de 3 preguntas");
  });

  test("shows the permitir account choice without an email address", async () => {
    for (const [gmailLoginHint, detail] of [
      [false, "Google mostrará el selector de cuentas"],
      [true, "va directo a la cuenta de Patricia"],
    ] as const) {
      const { app } = createTestApp({ demoToken: TOKEN, gmailLoginHint });
      const { state, text } = await readState(app);
      const permitir = state.primerosPasos.find(({ id }) => id === "permitir");

      expect(permitir?.detalle).toContain(detail);
      expect(text).not.toContain("@");
    }
  });
});
