import { describe, expect, test } from "bun:test";
import type { App } from "../app";
import { createTestApp, type TestApp } from "../testing";
import { MAX_AUDIOS_JURADO } from "./qr";

// #64: the projector's QR pages and the jurado's own audio de la noche,
// driven through the app factory. Every fixture is fictional.

const TOKEN = "operador-secreto-de-prueba";
const PHONE = "+56 9 0000 0000";
const BASE = "https://luna.example.test";

function setup(options: { demoToken?: string | null; entradaPhone?: string; voice?: { failures?: number } } = {}): TestApp {
  return createTestApp({
    demoToken: options.demoToken === null ? undefined : (options.demoToken ?? TOKEN),
    entradaPhone: "entradaPhone" in options ? options.entradaPhone : PHONE,
    publicBaseUrl: `${BASE}/`,
    voice: options.voice,
  });
}

const get = (app: App, path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

const postNombre = (app: App, pase: string, nombre: unknown) =>
  app.handle(
    new Request(`http://localhost/jurado/audio?pase=${encodeURIComponent(pase)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre }),
    }),
  );

/** The pase, read off the jurado projector page the way a phone reads the QR. */
async function paseFromProjector(app: App): Promise<string> {
  const response = await get(app, `/sala/qr/jurado?token=${TOKEN}`);
  expect(response.status).toBe(200);
  const match = /\/jurado\?pase=([A-Za-z0-9_-]+)/.exec(await response.text());
  expect(match).not.toBeNull();
  return match![1]!;
}

type Audio = { id: string; text: string; durationSeconds: number; mediaUrl: string };

describe("QR pages and the jurado's audio", () => {
  test("without the token, with a wrong one or with none configured, every page answers 404", async () => {
    const { app } = setup();
    for (const path of ["/sala/qr/entrada", "/sala/qr/jurado"]) {
      expect((await get(app, path)).status).toBe(404);
      expect((await get(app, `${path}?token=otro`)).status).toBe(404);
      expect((await get(app, path, { "x-demo-token": "otro" })).status).toBe(404);
    }
    expect((await get(app, "/jurado")).status).toBe(404);
    expect((await get(app, "/jurado?pase=inventado")).status).toBe(404);
    expect((await postNombre(app, "inventado", "Rosa")).status).toBe(404);
    expect((await get(app, "/jurado/media/sim-out-x?pase=inventado")).status).toBe(404);

    const { app: off } = setup({ demoToken: null });
    expect((await get(off, `/sala/qr/entrada?token=${TOKEN}`)).status).toBe(404);
    expect((await get(off, `/sala/qr/jurado?token=${TOKEN}`)).status).toBe(404);
    expect((await get(off, "/jurado?pase=")).status).toBe(404);
    expect((await postNombre(off, "", "Rosa")).status).toBe(404);
  });

  test("the entrada page shows a QR for the wa.me link with the number's digits", async () => {
    const { app } = setup();
    const response = await get(app, "/sala/qr/entrada", { "x-demo-token": TOKEN });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const page = await response.text();
    expect(page).toContain("<svg");
    expect(page).toContain("https://wa.me/56900000000?text=Hola%20Luna");
    expect(page).toContain("Escanéalo y Luna te saluda");
  });

  test("the landing's «Empezar» opens the same chat as the entrada QR, with no token", async () => {
    const { app } = setup();
    const response = await get(app, "/empezar");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://wa.me/56900000000?text=Hola%20Luna");
    const { app: sinNumero } = setup({ entradaPhone: undefined });
    expect((await get(sinNumero, "/empezar")).status).toBe(200);
  });

  test("the entrada page answers 503 with no number configured", async () => {
    for (const entradaPhone of [undefined, "", "sin número"]) {
      const { app } = setup({ entradaPhone });
      const response = await get(app, `/sala/qr/entrada?token=${TOKEN}`);
      expect(response.status).toBe(503);
      const page = await response.text();
      expect(page).toContain("WHATSAPP_ENTRADA_PHONE");
      expect(page).not.toContain("<svg");
    }
  });

  test("the jurado projector page carries a QR for /jurado on the public base, and its pase opens the page", async () => {
    const { app } = setup();
    const response = await get(app, `/sala/qr/jurado?token=${TOKEN}`);
    const page = await response.text();
    expect(page).toContain("<svg");
    expect(page).toContain(`${BASE}/jurado?pase=`);
    expect(page).not.toContain(TOKEN);

    const pase = await paseFromProjector(app);
    const phone = await get(app, `/jurado?pase=${pase}`);
    expect(phone.status).toBe(200);
    expect(await phone.text()).toContain("¿Cómo te llamas?");
  });

  test("the jurado's audio says their nombre and goes through their own simulador only", async () => {
    const { app, voice, whatsapp } = setup();
    const pase = await paseFromProjector(app);
    const response = await postNombre(app, pase, "  María José ");
    expect(response.status).toBe(201);
    const audio = (await response.json()) as Audio;

    expect(voice.calls).toHaveLength(1);
    expect(voice.calls[0]!.startsWith("Hola, María José. Soy Luna.")).toBe(true);
    expect(voice.calls[0]).not.toContain("Patricia");
    expect(audio.text).toBe(voice.calls[0]!);
    expect(audio.durationSeconds).toBe(3);
    expect(whatsapp.outbox).toHaveLength(0);

    const conversacion = await get(app, "/sala/conversacion", { "x-demo-token": TOKEN });
    expect(((await conversacion.json()) as { mensajes: unknown[] }).mensajes).toEqual([]);

    expect(audio.mediaUrl).toBe(`/jurado/media/${encodeURIComponent(audio.id)}?pase=${pase}`);
    const media = await get(app, audio.mediaUrl);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("audio/ogg");
    expect([...new Uint8Array(await media.arrayBuffer())]).toEqual([0x4f, 0x67, 0x67, 0x53]);

    expect((await get(app, `/jurado/media/sim-out-desconocido?pase=${pase}`)).status).toBe(404);
    expect((await get(app, `/jurado/media/${encodeURIComponent(audio.id)}`)).status).toBe(404);
  });

  test("a nombre that is missing, too long or not letters answers 400", async () => {
    const { app, voice } = setup();
    const pase = await paseFromProjector(app);
    for (const nombre of [undefined, "", "   ", 42, "a".repeat(41), "Rosa<script>", "R0sa", "Rosa!"]) {
      const response = await postNombre(app, pase, nombre);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBeTruthy();
    }
    expect((await postNombre(app, pase, "D'Angelo Pérez-Soto")).status).toBe(201);
    expect(voice.calls).toHaveLength(1);
  });

  test("a voice failure answers 502", async () => {
    const { app, whatsapp } = setup({ voice: { failures: 1 } });
    const pase = await paseFromProjector(app);
    const response = await postNombre(app, pase, "Rosa");
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBeTruthy();
    expect(whatsapp.outbox).toHaveLength(0);
  });

  test("past the cap of audios a run answers 429", async () => {
    const { app, voice } = setup({ voice: { failures: 1 } });
    const pase = await paseFromProjector(app);
    // A failed audio does not count toward the cap.
    expect((await postNombre(app, pase, "Rosa")).status).toBe(502);
    for (let i = 0; i < MAX_AUDIOS_JURADO; i++) expect((await postNombre(app, pase, "Rosa")).status).toBe(201);
    const response = await postNombre(app, pase, "Rosa");
    expect(response.status).toBe(429);
    expect(((await response.json()) as { error: string }).error).toBeTruthy();
    expect(voice.calls).toHaveLength(MAX_AUDIOS_JURADO + 1);
  });

  test("a body far bigger than a nombre answers 413 without reaching the voice", async () => {
    const { app, voice } = setup();
    const pase = await paseFromProjector(app);
    const body = JSON.stringify({ nombre: "Rosa", relleno: "x".repeat(10_000) });
    const response = await app.handle(
      new Request(`http://localhost/jurado/audio?pase=${encodeURIComponent(pase)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(body.length) },
        body,
      }),
    );
    expect(response.status).toBe(413);
    expect(voice.calls).toHaveLength(0);
  });
});
