import { describe, expect, test } from "bun:test";
import { nightAudioSender } from "./demo/night-audio";
import { sendVoiceNote, whatsappConfig } from "./whatsapp";

const config = { token: "test-token", phoneNumberId: "1000" };

function fakeMeta(responses: unknown[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = responses.shift() ?? {};
    return Response.json(body, { status: "error" in (body as object) ? 400 : 200 });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

describe("whatsappConfig", () => {
  test("names what is missing", () => {
    expect(whatsappConfig({})).toEqual({ ok: false, missing: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] });
  });

  test("reads the token and the phone number id", () => {
    expect(whatsappConfig({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" })).toEqual({
      ok: true,
      config: { token: "t", phoneNumberId: "1" },
    });
  });
});

describe("sendVoiceNote", () => {
  test("uploads Opus audio and sends it as a voice note", async () => {
    const { calls, fetchFn } = fakeMeta([{ id: "media-1" }, { messages: [{ id: "wamid.1" }] }]);
    const id = await sendVoiceNote(config, "56900000000", new Blob(["ogg"]), fetchFn);

    expect(id).toBe("wamid.1");
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v25.0/1000/media");
    const form = calls[0]?.init?.body as FormData;
    expect(form.get("type")).toBe("audio/ogg; codecs=opus");
    expect((form.get("file") as Blob).type).toBe("audio/ogg; codecs=opus");

    expect(calls[1]?.url).toBe("https://graph.facebook.com/v25.0/1000/messages");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      messaging_product: "whatsapp",
      to: "56900000000",
      type: "audio",
      audio: { id: "media-1", voice: true },
    });
  });

  test("surfaces Meta's error message", async () => {
    const { fetchFn } = fakeMeta([{ error: { message: "Invalid OAuth access token", code: 190 } }]);
    await expect(sendVoiceNote(config, "56900000000", new Blob(["ogg"]), fetchFn)).rejects.toThrow(
      "Invalid OAuth access token",
    );
  });
});

describe("nightAudioSender", () => {
  test("reports missing variables instead of throwing", async () => {
    const send = nightAudioSender({ WHATSAPP_TOKEN: "t" }, new Blob(["ogg"]));
    expect(await send()).toEqual({
      sent: false,
      reason: "falta WHATSAPP_PHONE_NUMBER_ID, DEMO_PATRICIA_PHONE en Doppler",
    });
  });

  test("sends to the phone the demo treats as Patricia's", async () => {
    const { calls, fetchFn } = fakeMeta([{ id: "media-1" }, { messages: [{ id: "wamid.2" }] }]);
    const env = { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1000", DEMO_PATRICIA_PHONE: "56900000000" };
    expect(await nightAudioSender(env, new Blob(["ogg"]), fetchFn)()).toEqual({ sent: true, messageId: "wamid.2" });
    expect(JSON.parse(String(calls[1]?.init?.body)).to).toBe("56900000000");
  });
});
