import { expect, test } from "bun:test";
import { createElevenLabsTranscriber, createElevenLabsVoice } from "./elevenlabs";

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
// Opt-in: the loops get the dev key, and the gate must not pay for or wait on ElevenLabs.
const enabled = process.env.ELEVENLABS_SMOKE === "1";

test.skipIf(!enabled || !apiKey || !voiceId)(
  "ElevenLabs speaks a short Spanish sentence as an Ogg voice note",
  async () => {
    const voice = createElevenLabsVoice({ apiKey: apiKey!, voiceId: voiceId! });

    const spoken = await voice.synthesize("Hola Patricia, hoy tu tarjeta tiene una buena noticia.");

    expect(new TextDecoder().decode(spoken.audio.subarray(0, 4))).toBe("OggS");
    expect(spoken.mimeType).toBe("audio/ogg");
    expect(spoken.durationSeconds).toBeGreaterThan(0);
    expect(spoken.durationSeconds).toBeLessThan(30);
  },
  30_000,
);

test.skipIf(!enabled || !apiKey || !voiceId)(
  "ElevenLabs transcribes back a Spanish sentence it spoke",
  async () => {
    const voice = createElevenLabsVoice({ apiKey: apiKey!, voiceId: voiceId! });
    const transcriber = createElevenLabsTranscriber({ apiKey: apiKey! });

    const spoken = await voice.synthesize("Patricia pagó su tarjeta completa este mes.");
    const text = await transcriber.transcribe(spoken.audio, spoken.mimeType);

    expect(text.toLowerCase()).toContain("tarjeta");
  },
  30_000,
);
