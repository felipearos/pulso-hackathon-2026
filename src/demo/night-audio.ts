import type { WhatsApp } from "../ports";
import { oggOpusDurationSeconds } from "../voice/elevenlabs";

export type NightAudioResult = { sent: true; messageId: string } | { sent: false; reason: string };

/**
 * Sends the test night audio through the WhatsApp port, as a nota de voz to
 * Patricia's phone. A failure, a missing variable included, is reported, not
 * thrown, so the control room still moves its clock on a laptop without secrets.
 */
export function nightAudioSender(whatsapp: Pick<WhatsApp, "send">, audio: Blob): () => Promise<NightAudioResult> {
  return async () => {
    try {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      const durationSeconds = oggOpusDurationSeconds(bytes);
      const { id } = await whatsapp.send({ kind: "audio", audio: bytes, mimeType: "audio/ogg", durationSeconds });
      return { sent: true, messageId: id };
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };
}
