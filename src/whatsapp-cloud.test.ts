import { describe, expect, test } from "bun:test";
import { FakeClock } from "./fakes";
import { MissingEnvError } from "./missing-env";
import { createWhatsAppCloud, isMadrugada, type SendLogEntry, WhatsAppSendError } from "./whatsapp-cloud";

const TOKEN = "secret-token-123";
const ENV = {
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: "555000111",
  WHATSAPP_RECIPIENT_PHONE: "56900000000",
};
const BASE = "https://graph.facebook.com/v21.0/555000111";
const HOUR = 60 * 60 * 1000;
// Santiago runs on UTC-3 in October 2026.
const NOON_SANTIAGO = new Date("2026-10-23T15:00:00Z");

type Recorded = {
  url: string;
  method: string;
  headers: Record<string, string>;
  json?: Record<string, unknown>;
  form?: FormData;
};

type SetupOptions = {
  now?: Date;
  responses?: Array<Response | Error>;
  env?: Record<string, string>;
  /** How far the fake clock jumps on each backoff wait; 0 keeps the clock still. */
  sleepAdvancesMs?: number;
};

function setup(options: SetupOptions = {}) {
  const clock = new FakeClock(options.now ?? NOON_SANTIAGO);
  const requests: Recorded[] = [];
  const responses = [...(options.responses ?? [])];
  const delays: number[] = [];
  const sleepAdvancesMs = options.sleepAdvancesMs ?? 0;
  const logged: SendLogEntry[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = { ...(init?.headers as Record<string, string>) };
    const body = init?.body;
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      json: typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : undefined,
      form: body instanceof FormData ? body : undefined,
    });
    const next = responses.shift() ?? Response.json({ messages: [{ id: "wamid-default" }] });
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const whatsapp = createWhatsAppCloud({
    env: options.env ?? ENV,
    clock,
    fetch: fakeFetch,
    sleep: async (ms) => {
      delays.push(ms);
      clock.advance(sleepAdvancesMs);
    },
    log: (entry) => logged.push(entry),
  });
  return { clock, whatsapp, requests, delays, logged };
}

function fileName(request: Recorded | undefined): string | undefined {
  const file = request?.form?.get("file");
  return file instanceof File ? file.name : undefined;
}

function ok(id: string): Response {
  return Response.json({ messages: [{ id }] });
}

function serverError(): Response {
  return Response.json({ error: { message: "boom", token: TOKEN } }, { status: 500 });
}

const OGG = { kind: "audio" as const, audio: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg; codecs=opus", durationSeconds: 3 };

describe("createWhatsAppCloud", () => {
  test("missing variables throw MissingEnvError naming every one", async () => {
    const { whatsapp, requests } = setup({ env: {} });
    const error = await whatsapp.send({ kind: "text", text: "hola" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingEnvError);
    expect((error as MissingEnvError).port).toBe("whatsapp");
    expect((error as MissingEnvError).missing).toEqual([
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_RECIPIENT_PHONE",
    ]);
    expect(requests).toHaveLength(0);
  });

  test("a text inside the window posts one message and returns Meta's id", async () => {
    const { whatsapp, requests, clock } = setup({ responses: [ok("wamid-1")] });
    whatsapp.recordInbound(new Date(clock.now().getTime() - HOUR));
    const result = await whatsapp.send({ kind: "text", text: "hola Patricia" });
    expect(result).toEqual({ id: "wamid-1" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${BASE}/messages`);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(requests[0]?.headers["Content-Type"]).toBe("application/json");
    expect(requests[0]?.json).toEqual({
      messaging_product: "whatsapp",
      to: "56900000000",
      type: "text",
      text: { body: "hola Patricia" },
    });
  });

  test("an audio inside the window uploads the media first, then sends it as a voice note", async () => {
    const { whatsapp, requests, clock } = setup({ responses: [Response.json({ id: "media-1" }), ok("wamid-2")] });
    whatsapp.recordInbound(clock.now());
    const result = await whatsapp.send(OGG);
    expect(result).toEqual({ id: "wamid-2" });
    expect(requests).toHaveLength(2);
    const upload = requests[0];
    expect(upload?.url).toBe(`${BASE}/media`);
    expect(upload?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(upload?.headers["Content-Type"]).toBeUndefined();
    expect(upload?.form?.get("messaging_product")).toBe("whatsapp");
    expect(upload?.form?.get("type")).toBe("audio/ogg; codecs=opus");
    const file = upload?.form?.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("audio.ogg");
    expect(requests[1]?.url).toBe(`${BASE}/messages`);
    expect(requests[1]?.json).toEqual({
      messaging_product: "whatsapp",
      to: "56900000000",
      type: "audio",
      audio: { id: "media-1", voice: true },
    });
  });

  test("a non-OGG audio throws and fetches nothing", async () => {
    const { whatsapp, requests, clock } = setup();
    whatsapp.recordInbound(clock.now());
    const error = await whatsapp.send({ ...OGG, mimeType: "audio/mpeg" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("audio/mpeg");
    expect((error as Error).message).toContain("OGG/Opus");
    expect(requests).toHaveLength(0);
  });

  test("an image with a caption sends the caption", async () => {
    const { whatsapp, requests, clock } = setup({ responses: [Response.json({ id: "media-2" }), ok("wamid-3")] });
    whatsapp.recordInbound(clock.now());
    await whatsapp.send({ kind: "image", image: new Uint8Array([9]), mimeType: "image/png", caption: "tu mes" });
    expect(fileName(requests[0])).toBe("imagen.png");
    expect(requests[1]?.json).toEqual({
      messaging_product: "whatsapp",
      to: "56900000000",
      type: "image",
      image: { id: "media-2", caption: "tu mes" },
    });
  });

  test("an image without a caption omits it", async () => {
    const { whatsapp, requests, clock } = setup({ responses: [Response.json({ id: "media-3" }), ok("wamid-4")] });
    whatsapp.recordInbound(clock.now());
    await whatsapp.send({ kind: "image", image: new Uint8Array([9]), mimeType: "image/jpeg" });
    expect(fileName(requests[0])).toBe("imagen.jpg");
    expect(requests[1]?.json?.image).toEqual({ id: "media-3" });
  });

  test("a closed window sends the template instead of the message", async () => {
    const { whatsapp, requests } = setup({ responses: [ok("wamid-5")] });
    const result = await whatsapp.send(OGG);
    expect(result).toEqual({ id: "wamid-5" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${BASE}/messages`);
    expect(requests[0]?.json).toEqual({
      messaging_product: "whatsapp",
      to: "56900000000",
      type: "template",
      template: { name: "audio_noche", language: { code: "es" } },
    });
  });

  test("the template name and language come from the env", async () => {
    const { whatsapp, requests } = setup({
      env: { ...ENV, WHATSAPP_TEMPLATE_NAME: "otra", WHATSAPP_TEMPLATE_LANGUAGE: "es_CL" },
    });
    await whatsapp.send({ kind: "text", text: "hola" });
    expect(requests[0]?.json?.template).toEqual({ name: "otra", language: { code: "es_CL" } });
  });

  test("an inbound 25 hours old still sends the template", async () => {
    const { whatsapp, requests, clock } = setup();
    whatsapp.recordInbound(new Date(clock.now().getTime() - 25 * HOUR));
    await whatsapp.send({ kind: "text", text: "hola" });
    expect(requests[0]?.json?.type).toBe("template");
  });

  test("an inbound 23 hours old sends the free-form message", async () => {
    const { whatsapp, requests, clock } = setup();
    whatsapp.recordInbound(new Date(clock.now().getTime() - 23 * HOUR));
    await whatsapp.send({ kind: "text", text: "hola" });
    expect(requests[0]?.json?.type).toBe("text");
  });

  test("a 500 then a 200 retries once and resolves", async () => {
    const { whatsapp, requests, delays, logged, clock } = setup({ responses: [serverError(), ok("wamid-6")] });
    whatsapp.recordInbound(clock.now());
    const result = await whatsapp.send({ kind: "text", text: "hola" });
    expect(result).toEqual({ id: "wamid-6" });
    expect(requests).toHaveLength(2);
    expect(delays).toEqual([1000]);
    expect(whatsapp.failures).toHaveLength(1);
    expect(whatsapp.failures[0]).toMatchObject({ kind: "text", attempt: 1, status: 500 });
    expect(whatsapp.failures[0]?.at).toEqual(NOON_SANTIAGO);
    expect(logged).toEqual(whatsapp.failures);
  });

  test("three 500s throw WhatsAppSendError after backing off", async () => {
    const { whatsapp, requests, delays, clock } = setup({ responses: [serverError(), serverError(), serverError()] });
    whatsapp.recordInbound(clock.now());
    const error = await whatsapp.send({ kind: "text", text: "hola" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect((error as WhatsAppSendError).attempts).toHaveLength(3);
    expect((error as WhatsAppSendError).message).toContain("3 attempts");
    expect(requests).toHaveLength(3);
    expect(whatsapp.failures.map((entry) => entry.attempt)).toEqual([1, 2, 3]);
    expect(delays).toEqual([1000, 2000]);
  });

  test("a rejected fetch is logged with a null status", async () => {
    const { whatsapp } = setup({ responses: [new Error("network down"), ok("wamid-7")] });
    await whatsapp.send({ kind: "text", text: "hola" });
    expect(whatsapp.failures[0]).toMatchObject({ kind: "template", attempt: 1, status: null, detail: "network down" });
  });

  test("a failure in the madrugada is not retried", async () => {
    const { whatsapp, requests, delays } = setup({
      now: new Date("2026-10-23T05:00:00Z"),
      responses: [serverError(), ok("never")],
    });
    const error = await whatsapp.send({ kind: "text", text: "hola" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect((error as WhatsAppSendError).message).toContain("1 attempt");
    expect((error as WhatsAppSendError).message).toContain("madrugada");
    expect(requests).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  test("a retry that would wake up inside the madrugada is dropped after the wait", async () => {
    const { whatsapp, requests, delays, clock } = setup({
      now: new Date("2026-10-24T02:59:59Z"), // 23:59:59 in Santiago
      responses: [serverError(), ok("never")],
      sleepAdvancesMs: 2000,
    });
    whatsapp.recordInbound(clock.now());
    const error = await whatsapp.send({ kind: "text", text: "hola" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect((error as WhatsAppSendError).message).toContain("madrugada");
    expect(delays).toEqual([1000]);
    expect(requests).toHaveLength(1);
  });

  test("a media upload answering without an id is logged, not thrown bare", async () => {
    const { whatsapp, logged, clock } = setup({ responses: [Response.json({})] });
    whatsapp.recordInbound(clock.now());
    const error = await whatsapp
      .send({ kind: "audio", audio: new Uint8Array([1]), mimeType: "audio/ogg; codecs=opus", durationSeconds: 3 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect(whatsapp.failures).toHaveLength(1);
    expect(whatsapp.failures[0]).toMatchObject({ kind: "audio", status: 200, detail: "media upload returned no id" });
    expect(logged).toEqual(whatsapp.failures);
  });

  test("no failure entry or log line contains the access token", async () => {
    const { whatsapp, logged, clock } = setup({
      responses: [serverError(), new Error(`bad ${TOKEN}`), serverError()],
    });
    whatsapp.recordInbound(clock.now());
    await whatsapp.send({ kind: "text", text: "hola" }).catch(() => undefined);
    expect(whatsapp.failures).toHaveLength(3);
    for (const entry of [...whatsapp.failures, ...logged]) {
      expect(JSON.stringify(entry)).not.toContain(TOKEN);
    }
  });
});

describe("isMadrugada", () => {
  test("covers 00:00 to 05:30 in Santiago", () => {
    expect(isMadrugada(new Date("2026-10-24T02:59:00Z"))).toBe(false); // 23:59
    expect(isMadrugada(new Date("2026-10-24T03:00:00Z"))).toBe(true); // 00:00
    expect(isMadrugada(new Date("2026-10-24T08:29:00Z"))).toBe(true); // 05:29
    expect(isMadrugada(new Date("2026-10-24T08:30:00Z"))).toBe(false); // 05:30
    expect(isMadrugada(new Date("2026-10-24T15:00:00Z"))).toBe(false); // 12:00
  });
});
