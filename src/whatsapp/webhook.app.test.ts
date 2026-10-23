import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createTestApp, TEST_WEBHOOK_CONFIG } from "../testing";

// #48's acceptance criteria, driven the way Meta drives them: one signed POST
// to the assembled app, with a fictional payload. Nothing here knows about the
// webhook's internals.

const FROM = "56900000000";
const WEBHOOK_URL = "http://localhost/webhook/whatsapp";

/** One Meta delivery carrying one message from Patricia. */
function delivery(message: object): string {
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
              messages: [message],
            },
          },
        ],
      },
    ],
  });
}

function textMessage(id: string, text: string): object {
  return { from: FROM, id, timestamp: "1792792800", type: "text", text: { body: text } };
}

function signedPost(body: string, secret = TEST_WEBHOOK_CONFIG.appSecret): Request {
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    body,
  });
}

describe("the whatsapp webhook through the app factory", () => {
  test("Meta's GET challenge is answered with the challenge itself", async () => {
    const { app } = createTestApp();
    const url = `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${TEST_WEBHOOK_CONFIG.verifyToken}&hub.challenge=1158201444`;

    const response = await app.handle(new Request(url));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1158201444");
  });

  test("a delivery with an invalid signature is 401 and changes nothing", async () => {
    const { app, whatsapp } = createTestApp();
    const body = delivery(textMessage("wamid.TEST1", "👍"));

    const response = await app.handle(signedPost(body, "otro-secreto"));
    await app.drain();

    expect(response.status).toBe(401);
    expect(app.store.mensajesEntrantes()).toEqual([]);
    expect(app.store.decisions()).toEqual([]);
    expect(whatsapp.inbound).toEqual([]);
  });

  test("a 👍 from Patricia is left as intención and as a decisión", async () => {
    const { app, whatsapp } = createTestApp();

    const response = await app.handle(signedPost(delivery(textMessage("wamid.TEST1", "👍"))));
    expect(response.status).toBe(200);
    await app.drain();

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe("👍");
    expect(entrantes[0]?.intencion).toEqual({ kind: "accepted" });
    expect(entrantes[0]?.whatsappId).toBe("wamid.TEST1");

    // The flujo normal left the política's own decisión: she had no cita to
    // answer, so it is «quedarse», and the 👍 it read is in it.
    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.tipo).toBe("quedarse");
    expect(decisions[0]?.datos).toMatchObject({ text: "👍" });

    // She wrote, so Meta's 24 h window is open and the cita can go out free-form.
    expect(whatsapp.inbound).toHaveLength(1);
  });

  test("the same message id twice is processed once, even after a restart", async () => {
    const { app, db } = createTestApp();
    const body = delivery(textMessage("wamid.TEST1", "👍"));

    await app.handle(signedPost(body));
    await app.drain();
    const retry = await app.handle(signedPost(body));
    await app.drain();

    expect(retry.status).toBe(200);
    expect(app.store.mensajesEntrantes()).toHaveLength(1);
    expect(app.store.decisions()).toHaveLength(1);

    // Meta keeps retrying across a deploy, and the claim is in the database.
    const { app: restarted } = createTestApp({ db });
    await restarted.handle(signedPost(body));
    await restarted.drain();
    expect(restarted.store.mensajesEntrantes()).toHaveLength(1);
  });

  test("the 200 is sent before the message is processed", async () => {
    // A 👍 is the fastest message there is: the classifier reads it with no LLM
    // call at all. If even this one is still unprocessed when the caller sees
    // the 200, the order holds for everything slower.
    const { app } = createTestApp();

    const response = await app.handle(signedPost(delivery(textMessage("wamid.TEST1", "👍"))));

    expect(response.status).toBe(200);
    expect(app.store.mensajesEntrantes()).toEqual([]);
    expect(app.store.decisions()).toEqual([]);

    await app.drain();
    expect(app.store.mensajesEntrantes()).toHaveLength(1);
  });

  test("a 👍 reaction to Luna's audio arrives as acceptance too", async () => {
    const { app } = createTestApp();
    const reaction = {
      from: FROM,
      id: "wamid.TEST2",
      timestamp: "1792792800",
      type: "reaction",
      reaction: { message_id: "wamid.LUNA1", emoji: "👍" },
    };

    const response = await app.handle(signedPost(delivery(reaction)));
    expect(response.status).toBe(200);
    await app.drain();

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.intencion).toEqual({ kind: "accepted" });
    expect(app.store.decisions()).toHaveLength(1);
  });
});
