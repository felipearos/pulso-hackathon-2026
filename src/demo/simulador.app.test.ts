import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { App } from "../app";
import { parseSantiago } from "../clock/santiago";
import { createTestApp, TEST_WEBHOOK_CONFIG, type TestApp } from "../testing";
import type { MensajeDeLaConversacion } from "./routes";

// #61: the simulador as the channel, driven through the app factory the way
// the /sala page drives it. Every fixture is fictional.

const TOKEN = "operador-secreto-de-prueba";
const HEADERS = { "x-demo-token": TOKEN };
const DRAFT = "Hola, aquí estoy contigo, con calma.";
const FOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

type Conversacion = { simulador: boolean; mensajes: MensajeDeLaConversacion[] };

function setup(options: { simulador?: boolean; llm?: Array<[string | RegExp, string]> } = {}): TestApp {
  return createTestApp({
    now: parseSantiago("2026-11-01T00:00"),
    demoToken: TOKEN,
    simulador: options.simulador,
    llm: options.llm ?? [["Escribe el guion", DRAFT], ["", "OK"]],
  });
}

const get = (app: App, path: string, headers: Record<string, string> = HEADERS) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

const postJson = (app: App, path: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

async function conversacion(app: App): Promise<Conversacion> {
  const response = await get(app, "/sala/conversacion");
  expect(response.status).toBe(200);
  return (await response.json()) as Conversacion;
}

/** Makes tonight's graduada cita go out, the way the night scheduler does. */
async function citaGoesOut(t: TestApp): Promise<void> {
  t.app.store.setEtapa("graduada", "se graduó: abrió el estado de cuenta ella");
  t.clock.set(parseSantiago("2026-11-02T22:30"));
  await t.app.tick();
  expect(t.app.store.citaOn("2026-11-02")).toBeTruthy();
}

function delivery(id: string, text: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "56900000001", phone_number_id: "1" },
              contacts: [{ profile: { name: "Patricia" }, wa_id: "56900000000" }],
              messages: [{ from: "56900000000", id, timestamp: "1792792800", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

function signedPost(body: string): Request {
  return new Request("http://localhost/webhook/whatsapp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", TEST_WEBHOOK_CONFIG.appSecret).update(body).digest("hex")}`,
    },
    body,
  });
}

describe("the simulador endpoints without the operator token", () => {
  test("every endpoint answers 404, the media one included", async () => {
    const t = setup({ simulador: true });
    await citaGoesOut(t);
    const paths: [string, string][] = [
      ["GET", "/sala/conversacion"],
      ["GET", "/sala/simulador/media/sim-out-1"],
      ["POST", "/sala/simulador"],
      ["POST", "/sala/simulador/mensaje"],
    ];
    for (const [method, path] of paths) {
      for (const query of ["", "?token=otro"]) {
        const response = await t.app.handle(new Request(`http://localhost${path}${query}`, { method }));
        expect([method, path, query, response.status]).toEqual([method, path, query, 404]);
      }
    }
  });
});

describe("the simulador as the channel", () => {
  test("with the simulador active the cita goes to the page, not to Meta, and its audio plays with ?token=", async () => {
    const t = setup({ simulador: true });
    await citaGoesOut(t);

    expect(t.whatsapp.outbox).toEqual([]);
    const { simulador, mensajes } = await conversacion(t.app);
    expect(simulador).toBe(true);
    const audio = mensajes.find((mensaje) => mensaje.kind === "audio");
    expect(audio).toMatchObject({ de: "luna", text: expect.stringContaining(DRAFT) });
    expect(audio?.durationSeconds).toBeGreaterThan(0);
    expect(audio?.mediaUrl).toStartWith("/sala/simulador/media/");

    // The page's <audio src> cannot send a header, so the token rides in the URL.
    const media = await get(t.app, `${audio!.mediaUrl}?token=${TOKEN}`, {});
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("audio/ogg");
    expect((await media.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("an unknown media id is 404", async () => {
    const t = setup({ simulador: true });
    expect((await get(t.app, "/sala/simulador/media/sim-out-99")).status).toBe(404);
  });

  test("with the simulador off the cita reaches Meta; /sala switches it both ways", async () => {
    const t = setup({ simulador: true });
    const off = await postJson(t.app, "/sala/simulador", { activo: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { simulador: boolean }).simulador).toBe(false);

    await citaGoesOut(t);
    expect(t.whatsapp.outbox.some((message) => message.kind === "audio")).toBe(true);
    const { simulador, mensajes } = await conversacion(t.app);
    expect(simulador).toBe(false);
    expect(mensajes.find((mensaje) => mensaje.kind === "audio")?.mediaUrl).toBeNull();

    const on = await postJson(t.app, "/sala/simulador", { activo: true });
    expect(((await on.json()) as { simulador: boolean }).simulador).toBe(true);
    const outbox = t.whatsapp.outbox.length;
    await postJson(t.app, "/sala/simulador/mensaje", { text: "👍" });
    await t.app.drain();
    expect(t.whatsapp.outbox).toHaveLength(outbox);
  });

  test("a bad switch body is 400", async () => {
    const t = setup();
    expect((await postJson(t.app, "/sala/simulador", "no es json")).status).toBe(400);
    expect((await postJson(t.app, "/sala/simulador", { activo: "sí" })).status).toBe(400);
  });
});

describe("Patricia answering from the page", () => {
  test("a text takes the same flow as one Meta delivers, without opening Meta's window", async () => {
    const t = setup({ simulador: true });

    const response = await postJson(t.app, "/sala/simulador/mensaje", { text: "👍" });
    expect(response.status).toBe(202);
    const { whatsappId } = (await response.json()) as { whatsappId: string };
    expect(whatsappId).toStartWith("sim-in-");
    await t.app.drain();

    const entrantes = t.app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]).toMatchObject({ text: "👍", intencion: { kind: "accepted" }, whatsappId });
    expect(t.whatsapp.inbound).toEqual([]);

    // The same 👍 through a signed Meta delivery leaves the same decisión.
    const meta = setup();
    await meta.app.handle(signedPost(delivery("wamid.TEST1", "👍")));
    await meta.app.drain();
    const strip = (app: App) => app.store.decisions().map(({ tipo, motivo }) => ({ tipo, motivo }));
    expect(strip(t.app)).toEqual(strip(meta.app));
    expect(t.app.store.decisions()[0]?.datos).toMatchObject({
      text: "👍",
      whatsappId,
      arrival: { from: "simulador", kind: "text" },
    });

    const { mensajes } = await conversacion(t.app);
    expect(mensajes.at(-1)).toMatchObject({ de: "patricia", kind: "text", text: "👍", mediaUrl: null });
  });

  test("an emoji answers Luna's latest message as a reaction", async () => {
    const t = setup({ simulador: true });
    await citaGoesOut(t);
    const latest = t.app.store.mensajesSalientes().at(-1)!;

    expect((await postJson(t.app, "/sala/simulador/mensaje", { emoji: "👍" })).status).toBe(202);
    await t.app.drain();

    const decision = t.app.store.decisions().at(-1);
    expect(decision?.datos).toMatchObject({
      text: "👍",
      arrival: { from: "simulador", kind: "reaction", toWhatsappId: latest.whatsappId },
    });
  });

  test("a foto reaches the foto flow and shows on the page with its bytes", async () => {
    const t = setup({
      simulador: true,
      llm: [
        ["Foto de un estado de cuenta:", JSON.stringify({ pagoMinimo: null })],
        ["", "OK"],
      ],
    });
    const form = new FormData();
    form.append("foto", new Blob([FOTO], { type: "image/jpeg" }), "estado.jpg");

    const response = await t.app.handle(
      new Request("http://localhost/sala/simulador/mensaje", { method: "POST", headers: HEADERS, body: form }),
    );
    expect(response.status).toBe(202);
    const { whatsappId } = (await response.json()) as { whatsappId: string };
    await t.app.drain();

    expect(t.llm.calls.some((call) => call.prompt.includes("Foto de un estado de cuenta:"))).toBe(true);
    const entrante = t.app.store.mensajesEntrantes().find((mensaje) => mensaje.whatsappId === whatsappId);
    expect(entrante?.text).toStartWith("[foto");

    const { mensajes } = await conversacion(t.app);
    const foto = mensajes.find((mensaje) => mensaje.de === "patricia");
    expect(foto?.kind).toBe("image");
    expect(foto?.mediaUrl).toStartWith("/sala/simulador/media/");
    const media = await get(t.app, `${foto!.mediaUrl}?token=${TOKEN}`, {});
    expect(media.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(FOTO);
    expect(t.whatsapp.outbox).toEqual([]);
  });

  test("409 while the simulador is off, 400 on an empty text or a body that is not JSON", async () => {
    const off = setup();
    const refused = await postJson(off.app, "/sala/simulador/mensaje", { text: "hola" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "el simulador no está activo" });

    const t = setup({ simulador: true });
    expect((await postJson(t.app, "/sala/simulador/mensaje", { text: "   " })).status).toBe(400);
    expect((await postJson(t.app, "/sala/simulador/mensaje", "{no")).status).toBe(400);
    const form = new FormData();
    form.append("foto", new Blob(["texto"], { type: "text/plain" }), "nota.txt");
    const notAnImage = await t.app.handle(
      new Request("http://localhost/sala/simulador/mensaje", { method: "POST", headers: HEADERS, body: form }),
    );
    expect(notAnImage.status).toBe(400);
    await t.app.drain();
    expect(t.app.store.mensajesEntrantes()).toEqual([]);
  });
});
