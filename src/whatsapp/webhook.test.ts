import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createWebhook, type InboundMensaje, type WebhookDeps } from "./webhook";

const SECRET = "secreto-de-prueba";
const VERIFY_TOKEN = "token-de-prueba";
const FROM = "56900000000";
const NOW = new Date("2026-10-23T22:00:00Z");
const URL_BASE = "https://example.test/webhook/whatsapp";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function post(body: string, signature: string | null = sign(body)): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["X-Hub-Signature-256"] = signature;
  return new Request(URL_BASE, { method: "POST", headers, body });
}

function delivery(...messages: object[]): string {
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
              contacts: [{ profile: { name: "Patricia" }, wa_id: FROM }],
              messages,
            },
          },
        ],
      },
    ],
  });
}

function text(id: string, body: string, timestamp = "1792792800"): object {
  return { from: FROM, id, timestamp, type: "text", text: { body } };
}

function setup(overrides: Partial<WebhookDeps> = {}) {
  const claimed = new Set<string>();
  const received: InboundMensaje[] = [];
  const inbound: Date[] = [];
  const logs: string[] = [];
  const deps: WebhookDeps = {
    config: { appSecret: SECRET, verifyToken: VERIFY_TOKEN },
    claim(id) {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    async onMensaje(mensaje) {
      received.push(mensaje);
    },
    recordInbound(at) {
      inbound.push(at);
    },
    now: () => NOW,
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { webhook: createWebhook(deps), received, inbound, logs };
}

function challengeUrl(params: Record<string, string>): URL {
  const url = new URL(URL_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

describe("whatsapp webhook: GET challenge", () => {
  test("echoes hub.challenge with exactly that body", async () => {
    const { webhook } = setup();
    const response = webhook.verify(
      challengeUrl({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444" }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1158201444");
  });

  test("a wrong verify token is forbidden", () => {
    const { webhook } = setup();
    const response = webhook.verify(
      challengeUrl({ "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "1" }),
    );
    expect(response.status).toBe(403);
  });

  test("an unset verify token never lets a token through", () => {
    const { webhook } = setup({ config: { appSecret: SECRET } });
    const response = webhook.verify(
      challengeUrl({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" }),
    );
    expect(response.status).toBe(403);
  });
});

describe("whatsapp webhook: POST", () => {
  test("a valid signature over the raw body is accepted", async () => {
    const { webhook, received } = setup();
    const response = await webhook.receive(post(delivery(text("wamid.TEST1", "hola"))));
    await webhook.drain();
    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
  });

  test("a wrong signature is rejected and nothing is processed", async () => {
    const { webhook, received } = setup();
    const body = delivery(text("wamid.TEST1", "hola"));
    const response = await webhook.receive(post(body, sign(body, "otro-secreto")));
    await webhook.drain();
    expect(response.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  test("a missing signature header is rejected", async () => {
    const { webhook, received } = setup();
    const response = await webhook.receive(post(delivery(text("wamid.TEST1", "hola")), null));
    expect(response.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  test("an unset app secret rejects every delivery", async () => {
    const { webhook, received } = setup({ config: { verifyToken: VERIFY_TOKEN } });
    const response = await webhook.receive(post(delivery(text("wamid.TEST1", "hola"))));
    expect(response.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  test("the 200 arrives before processing finishes", async () => {
    let release = () => {};
    let entered = false;
    let finished = false;
    const { webhook } = setup({
      onMensaje: async () => {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        finished = true;
      },
    });
    const response = await webhook.receive(post(delivery(text("wamid.TEST1", "hola"))));
    expect(response.status).toBe(200);
    await Promise.resolve();
    await Promise.resolve();
    expect(entered).toBe(true);
    expect(finished).toBe(false);
    release();
    await webhook.drain();
    expect(finished).toBe(true);
  });

  test("the same wamid twice is processed once", async () => {
    const { webhook, received, inbound } = setup();
    const body = delivery(text("wamid.TEST1", "hola"));
    await webhook.receive(post(body));
    const retry = await webhook.receive(post(body));
    await webhook.drain();
    expect(retry.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(inbound).toHaveLength(1);
  });

  test("a thumbs-up text reaches the handler as text, with id, sender and time", async () => {
    const { webhook, received, inbound } = setup();
    await webhook.receive(post(delivery(text("wamid.TEST1", "👍", "1792792800"))));
    await webhook.drain();
    const when = new Date(1792792800 * 1000);
    expect(received).toEqual([{ whatsappId: "wamid.TEST1", from: FROM, when, body: { kind: "text", text: "👍" } }]);
    expect(inbound).toEqual([when]);
  });

  test("an unreadable timestamp falls back to the injected clock", async () => {
    const { webhook, received } = setup();
    await webhook.receive(post(delivery(text("wamid.TEST1", "hola", "ayer"))));
    await webhook.drain();
    expect(received[0]?.when).toEqual(NOW);
  });

  test("a status-only delivery is accepted with no handler call", async () => {
    const { webhook, received } = setup();
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                statuses: [{ id: "wamid.TEST9", status: "delivered", timestamp: "1792792800", recipient_id: FROM }],
              },
            },
          ],
        },
      ],
    });
    const response = await webhook.receive(post(body));
    await webhook.drain();
    expect(response.status).toBe(200);
    expect(received).toHaveLength(0);
  });

  test("a body that is not JSON is a bad request", async () => {
    const { webhook } = setup();
    const response = await webhook.receive(post("esto no es json"));
    expect(response.status).toBe(400);
  });

  test("a rejecting handler does not stop the other message in the delivery", async () => {
    const seen: string[] = [];
    const { webhook } = setup({
      onMensaje: async (mensaje) => {
        seen.push(mensaje.whatsappId);
        if (mensaje.whatsappId === "wamid.TEST1") throw new Error("falló");
      },
    });
    const response = await webhook.receive(post(delivery(text("wamid.TEST1", "uno"), text("wamid.TEST2", "dos"))));
    expect(response.status).toBe(200);
    await expect(webhook.drain()).resolves.toBeUndefined();
    expect(seen).toEqual(["wamid.TEST1", "wamid.TEST2"]);
  });

  test("audio and image messages map to media id and mime type", async () => {
    const { webhook, received } = setup();
    await webhook.receive(
      post(
        delivery(
          { from: FROM, id: "wamid.TEST1", timestamp: "1792792800", type: "audio", audio: { id: "media-audio-1", mime_type: "audio/ogg; codecs=opus" } },
          { from: FROM, id: "wamid.TEST2", timestamp: "1792792801", type: "image", image: { id: "media-image-1", mime_type: "image/jpeg" } },
          { from: FROM, id: "wamid.TEST3", timestamp: "1792792802", type: "reaction", reaction: { emoji: "👍" } },
        ),
      ),
    );
    await webhook.drain();
    expect(received.map((mensaje) => mensaje.body)).toEqual([
      { kind: "audio", mediaId: "media-audio-1", mimeType: "audio/ogg; codecs=opus" },
      { kind: "image", mediaId: "media-image-1", mimeType: "image/jpeg" },
      { kind: "other", type: "reaction" },
    ]);
  });
});
