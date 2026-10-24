import { describe, expect, test } from "bun:test";
import { NIGHT_AUDIO_URL, type Snapshot } from "./demo/moments";
import type { NightAudioResult } from "./demo/night-audio";
import { OPERATOR_KEY_HEADER, createHandler } from "./server";
import type { Webhook } from "./whatsapp/webhook";

type Moved = { snapshot: Snapshot; whatsapp?: NightAudioResult };

const KEY = "operator-key";

async function json<T>(response: Promise<Response>): Promise<T> {
  return (await (await response).json()) as T;
}

function stubWebhook(): { webhook: Webhook; calls: string[] } {
  const calls: string[] = [];
  const webhook: Webhook = {
    verify(url) {
      calls.push(`verify ${url.pathname}`);
      return new Response("challenge", { status: 200 });
    },
    async receive(request) {
      calls.push(`receive ${request.method}`);
      return new Response("ok", { status: 200 });
    },
    inject(mensaje) {
      calls.push(`inject ${mensaje.whatsappId}`);
      return true;
    },
    async drain() {},
  };
  return { webhook, calls };
}

function app(
  result: NightAudioResult = { sent: true, messageId: "wamid.test" },
  operatorKey: string | null = KEY,
  webhook: Webhook = stubWebhook().webhook,
  entradaLink?: string,
) {
  let sends = 0;
  const handle = createHandler({
    demoPage: new Blob(["<h1>Luna · sala de control</h1>"]),
    landingPage: new Blob(["<h1>Mira tus cuentas sin angustia.</h1>"]),
    pitchDeck: new Blob(["<title>Luna · Mac mini winners</title>"]),
    soonPage: new Blob(["<h1>Esto está por llegar.</h1>"]),
    entradaLink,
    landingImages: { "taza-te.webp": new Blob(["webp"]) },
    nightAudio: new Blob(["ogg"]),
    sendNightAudio: async () => {
      sends++;
      return result;
    },
    operatorKey: operatorKey ?? undefined,
    webhook,
  });
  const get = (path: string) => handle(new Request(`http://localhost${path}`));
  const post = (path: string, key: string | null = KEY) =>
    handle(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: key === null ? {} : { [OPERATOR_KEY_HEADER]: key },
      }),
    );
  return { get, post, sends: () => sends };
}

describe("handle", () => {
  test("reports health", async () => {
    const response = await app().get("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("answers 404 for unknown paths", async () => {
    expect((await app().get("/nope")).status).toBe(404);
    expect((await app().post("/demo/moments/friday")).status).toBe(404);
  });

  test("serves the landing at the root", async () => {
    const page = await app().get("/");
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(await page.text()).toContain("Mira tus cuentas sin angustia.");
  });

  test("serves the pitch deck at /presentacion", async () => {
    const page = await app().get("/presentacion");
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(await page.text()).toContain("Luna · Mac mini winners");
  });

  test("sends «Empezar» to the WhatsApp chat with Luna", async () => {
    const link = "https://wa.me/56900000000?text=Hola%20Luna";
    const { get } = app(undefined, KEY, stubWebhook().webhook, link);
    const response = await get("/empezar");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(link);
  });

  test("serves the coming-soon page for «Empezar» without an entrada number", async () => {
    const page = await app().get("/empezar");
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(await page.text()).toContain("Esto está por llegar.");
  });

  test("has no sign-in: Luna has no accounts", async () => {
    expect((await app().get("/entrar")).status).toBe(404);
  });

  test("serves the landing's photos as webp and nothing else under /img", async () => {
    const { get } = app();
    const photo = await get("/img/taza-te.webp");
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/webp");
    expect(await photo.text()).toBe("webp");
    expect((await get("/img/otra.webp")).status).toBe(404);
    expect((await get("/img/CREDITOS.md")).status).toBe(404);
    expect((await get("/img/../server.ts")).status).toBe(404);
  });

  test("answers 404 when posting to the root", async () => {
    expect((await app().post("/", null)).status).toBe(404);
  });

  test("serves the control room page and the test audio", async () => {
    const { get } = app();
    const page = await get("/demo");
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(await page.text()).toContain("sala de control");
    expect((await get(NIGHT_AUDIO_URL)).headers.get("Content-Type")).toBe("audio/ogg");
  });

  test("starts on Monday morning, before the statement arrives", async () => {
    const state = await json<Snapshot>(app().get("/demo/state"));
    expect(state.moment).toBe("start");
    expect(state.messages).toEqual([]);
  });

  test("moves the clock and keeps the moment for every screen that polls", async () => {
    const { get, post } = app();
    const body = await json<Moved>(post("/demo/moments/thursday-night"));
    expect(body.snapshot.moment).toBe("thursday-night");
    expect((await json<Snapshot>(get("/demo/state"))).moment).toBe("thursday-night");
  });

  test("sends the voice note only on Monday night and reports the outcome", async () => {
    const { post, sends } = app({ sent: false, reason: "whatsapp port needs WHATSAPP_ACCESS_TOKEN" });
    await post("/demo/moments/monday-email");
    expect(sends()).toBe(0);

    const body = await json<Moved>(post("/demo/moments/monday-night"));
    expect(sends()).toBe(1);
    expect(body.whatsapp).toEqual({ sent: false, reason: "whatsapp port needs WHATSAPP_ACCESS_TOKEN" });
  });

  test("pressing Monday night again while there does not send a second audio", async () => {
    const { post, sends } = app();
    await post("/demo/moments/monday-night");
    const again = await json<Moved>(post("/demo/moments/monday-night"));
    expect(sends()).toBe(1);
    expect(again.whatsapp).toBeUndefined();

    await post("/demo/reset");
    await post("/demo/moments/monday-night");
    expect(sends()).toBe(2);
  });

  test("resets to the start", async () => {
    const { get, post } = app();
    await post("/demo/moments/week-5");
    await post("/demo/reset");
    expect((await json<Snapshot>(get("/demo/state"))).moment).toBe("start");
  });
});

describe("operator key", () => {
  test("a request without the key or with a wrong one moves nothing and sends nothing", async () => {
    const { get, post, sends } = app();
    expect((await post("/demo/moments/monday-night", null)).status).toBe(401);
    expect((await post("/demo/moments/monday-night", "wrong")).status).toBe(401);
    expect((await post("/demo/reset", "operator-kez")).status).toBe(401);
    expect(sends()).toBe(0);
    expect((await json<Snapshot>(get("/demo/state"))).moment).toBe("start");
  });

  test("without a configured key the room is view-only", async () => {
    const { get, post, sends } = app(undefined, null);
    const response = await post("/demo/moments/monday-night", "anything");
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain("DEMO_OPERATOR_KEY");
    expect(sends()).toBe(0);
    expect((await get("/demo")).status).toBe(200);
    expect((await get("/demo/state")).status).toBe(200);
  });
});

describe("Meta's webhook", () => {
  test("routes GET /webhook/whatsapp to the webhook's verify", async () => {
    const { webhook, calls } = stubWebhook();
    const response = await app(undefined, KEY, webhook).get("/webhook/whatsapp?hub.mode=subscribe");
    expect(await response.text()).toBe("challenge");
    expect(calls).toEqual(["verify /webhook/whatsapp"]);
  });

  test("routes POST /webhook/whatsapp to the webhook's receive, with no operator key", async () => {
    const { webhook, calls } = stubWebhook();
    const response = await app(undefined, KEY, webhook).post("/webhook/whatsapp", null);
    expect(response.status).toBe(200);
    expect(calls).toEqual(["receive POST"]);
  });
});
