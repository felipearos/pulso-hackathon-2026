import { describe, expect, test } from "bun:test";
import { FakeWhatsApp } from "../fakes";
import type { WhatsApp } from "../ports";
import { nightAudioSender } from "./night-audio";

const nightAudio = Bun.file(new URL("../../assets/night-audio-test.ogg", import.meta.url));

describe("nightAudioSender", () => {
  test("sends the test audio through the port as an Ogg nota de voz", async () => {
    const whatsapp = new FakeWhatsApp();
    expect(await nightAudioSender(whatsapp, nightAudio)()).toEqual({ sent: true, messageId: "wamid-1" });

    const [message] = whatsapp.outbox;
    if (message?.kind !== "audio") throw new Error("expected an audio message");
    expect(message.mimeType).toBe("audio/ogg");
    expect(message.audio.byteLength).toBe(nightAudio.size);
    expect(Math.round(message.durationSeconds)).toBe(24);
  });

  test("reports a failing port instead of throwing", async () => {
    const reason = "whatsapp port needs WHATSAPP_ACCESS_TOKEN; add them to Doppler pulso-hackathon-2026";
    const failing: Pick<WhatsApp, "send"> = {
      send: async () => {
        throw new Error(reason);
      },
    };
    expect(await nightAudioSender(failing, nightAudio)()).toEqual({ sent: false, reason });
  });

  test("reports audio that is not Ogg Opus before calling the port", async () => {
    const whatsapp = new FakeWhatsApp();
    const result = await nightAudioSender(whatsapp, new Blob(["not ogg"]))();
    expect(result.sent).toBe(false);
    expect(whatsapp.outbox).toEqual([]);
  });
});
