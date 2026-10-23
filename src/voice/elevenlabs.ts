import type { SpokenAudio, Voice } from "../ports";

/** The slice of `fetch` the client uses, so tests can pass a fake. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type ElevenLabsOptions = {
  apiKey: string;
  voiceId: string;
  fetch?: Fetch;
  log?: (line: string) => void;
};

/** ElevenLabs did not return usable audio. `retryable` says whether calling again may work. */
export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

export type ElevenLabsTranscriberOptions = Omit<ElevenLabsOptions, "voiceId">;

const OPUS_SAMPLE_RATE = 48_000;
const BODY_PREVIEW_CHARS = 200;

/**
 * Seconds of audio in an Ogg Opus stream: the last page's granule position
 * minus the pre-skip from the `OpusHead` packet, at Opus's fixed 48 kHz.
 */
export function oggOpusDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let preSkip: number | undefined;
  let lastGranule: bigint | undefined;

  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || !startsWith(bytes, offset, "OggS")) {
      throw new Error(`not an Ogg Opus stream: no Ogg page at byte ${offset}`);
    }
    const segments = bytes[offset + 26]!;
    const tableEnd = offset + 27 + segments;
    if (tableEnd > bytes.length) throw new Error("not an Ogg Opus stream: truncated page header");
    let bodyLength = 0;
    for (let i = offset + 27; i < tableEnd; i++) bodyLength += bytes[i]!;
    if (tableEnd + bodyLength > bytes.length) throw new Error("not an Ogg Opus stream: truncated page");

    if (preSkip === undefined) {
      if (bodyLength < 19 || !startsWith(bytes, tableEnd, "OpusHead")) {
        throw new Error("not an Ogg Opus stream: first packet is not OpusHead");
      }
      preSkip = view.getUint16(tableEnd + 10, true);
    }
    lastGranule = view.getBigInt64(offset + 6, true);
    offset = tableEnd + bodyLength;
  }

  if (preSkip === undefined || lastGranule === undefined) {
    throw new Error("not an Ogg Opus stream: no pages");
  }
  const samples = Number(lastGranule) - preSkip;
  if (samples <= 0) throw new Error("not an Ogg Opus stream: no audio samples");
  return samples / OPUS_SAMPLE_RATE;
}

/** Logs one line and throws; the key is scrubbed in case a body or error echoes it. */
function failer(apiKey: string, log: (line: string) => void) {
  return (message: string, status: number | undefined, retryable: boolean): never => {
    const line = `voice port: ${apiKey ? message.replaceAll(apiKey, "[redacted]") : message}`;
    log(line);
    throw new VoiceError(line, status, retryable);
  };
}

function startsWith(bytes: Uint8Array, offset: number, ascii: string): boolean {
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The voice port on ElevenLabs text-to-speech, returning Ogg Opus that WhatsApp
 * plays as a voice note. It keeps no state, so calling `synthesize` again is the retry.
 */
export function createElevenLabsVoice({
  apiKey,
  voiceId,
  fetch: fetchAudio = fetch,
  log = console.error,
}: ElevenLabsOptions): Pick<Voice, "synthesize"> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=opus_48000_64`;
  const fail = failer(apiKey, log);

  return {
    async synthesize(text: string): Promise<SpokenAudio> {
      let response: Response;
      try {
        response = await fetchAudio(url, {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/ogg" },
          body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        });
      } catch (error) {
        return fail(`ElevenLabs request failed: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
      }

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, BODY_PREVIEW_CHARS);
        const retryable = response.status === 429 || response.status >= 500;
        return fail(`ElevenLabs answered ${response.status}: ${body}`, response.status, retryable);
      }

      let audio: Uint8Array;
      try {
        audio = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        return fail(`ElevenLabs audio download failed: ${error instanceof Error ? error.message : String(error)}`, response.status, true);
      }
      let durationSeconds: number;
      try {
        durationSeconds = oggOpusDurationSeconds(audio);
      } catch (error) {
        return fail(`ElevenLabs audio is unusable: ${(error as Error).message}`, response.status, false);
      }
      return { audio, mimeType: "audio/ogg", durationSeconds };
    },
  };
}

/**
 * The voice port's speech-to-text on ElevenLabs Scribe, for the notas de voz
 * Patricia sends. It needs no voice id, and keeps no state, so calling again is the retry.
 */
export function createElevenLabsTranscriber({
  apiKey,
  fetch: fetchText = fetch,
  log = console.error,
}: ElevenLabsTranscriberOptions): Required<Pick<Voice, "transcribe">> {
  const fail = failer(apiKey, log);

  return {
    async transcribe(audio: Uint8Array, mimeType: string): Promise<string> {
      const form = new FormData();
      form.append("model_id", "scribe_v1");
      form.append("language_code", "spa");
      form.append("file", new Blob([audio], { type: mimeType }), "nota-de-voz.ogg");
      let response: Response;
      try {
        response = await fetchText("https://api.elevenlabs.io/v1/speech-to-text", {
          method: "POST",
          headers: { "xi-api-key": apiKey },
          body: form,
        });
      } catch (error) {
        return fail(`ElevenLabs request failed: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
      }

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, BODY_PREVIEW_CHARS);
        const retryable = response.status === 429 || response.status >= 500;
        return fail(`ElevenLabs answered ${response.status}: ${body}`, response.status, retryable);
      }

      const result = (await response.json().catch(() => undefined)) as { text?: unknown } | undefined;
      if (typeof result?.text !== "string") return fail("ElevenLabs transcript has no text", response.status, false);
      return result.text.trim();
    },
  };
}
