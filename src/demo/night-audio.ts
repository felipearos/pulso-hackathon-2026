import { sendVoiceNote, whatsappConfig } from "../whatsapp";

export type NightAudioResult = { sent: true; messageId: string } | { sent: false; reason: string };

/**
 * Sends the test night audio to the phone the demo treats as Patricia's.
 * A missing variable is reported, not thrown, so the control room still moves
 * its clock on a laptop without secrets.
 */
export function nightAudioSender(
  env: Record<string, string | undefined>,
  audio: Blob,
  fetchFn?: typeof fetch,
): () => Promise<NightAudioResult> {
  return async () => {
    const setup = whatsappConfig(env);
    const to = env.DEMO_PATRICIA_PHONE;
    if (!setup.ok || !to) {
      const missing = [...(setup.ok ? [] : setup.missing), ...(to ? [] : ["DEMO_PATRICIA_PHONE"])];
      return { sent: false, reason: `falta ${missing.join(", ")} en Doppler` };
    }
    try {
      return { sent: true, messageId: await sendVoiceNote(setup.config, to, audio, fetchFn) };
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };
}
