import { describe, expect, test } from "bun:test";
import { createElevenLabsVoice, oggOpusDurationSeconds, VoiceError, type Fetch } from "./elevenlabs";

const API_KEY = "sk_fake_key_123";

/** One Ogg page holding a single packet; the CRC is left at zero since nothing checks it. */
function oggPage(granule: bigint, packet: Uint8Array): Uint8Array {
  if (packet.length >= 255) throw new Error("test pages hold packets under 255 bytes");
  const page = new Uint8Array(28 + packet.length);
  const view = new DataView(page.buffer);
  page.set(new TextEncoder().encode("OggS"), 0);
  view.setBigInt64(6, granule, true);
  page[26] = 1;
  page[27] = packet.length;
  page.set(packet, 28);
  return page;
}

function opusHead(preSkip: number): Uint8Array {
  const packet = new Uint8Array(19);
  packet.set(new TextEncoder().encode("OpusHead"), 0);
  packet[8] = 1;
  packet[9] = 1;
  new DataView(packet.buffer).setUint16(10, preSkip, true);
  new DataView(packet.buffer).setUint32(12, 48_000, true);
  return packet;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A minimal Ogg Opus stream: head, tags, two audio pages ending at `finalGranule`. */
function oggOpus(preSkip: number, finalGranule: bigint): Uint8Array {
  return concat(
    oggPage(0n, opusHead(preSkip)),
    oggPage(0n, new TextEncoder().encode("OpusTags")),
    oggPage(finalGranule / 2n, new Uint8Array([1, 2, 3])),
    oggPage(finalGranule, new Uint8Array([4, 5, 6])),
  );
}

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond();
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("oggOpusDurationSeconds", () => {
  test("is the last granule minus pre-skip at 48 kHz", () => {
    expect(oggOpusDurationSeconds(oggOpus(312, 48_000n * 5n + 312n))).toBe(5);
  });

  test("reads a stream that sits inside a larger buffer", () => {
    const stream = oggOpus(0, 24_000n);
    const padded = new Uint8Array(stream.length + 4);
    padded.set(stream, 4);
    expect(oggOpusDurationSeconds(padded.subarray(4))).toBe(0.5);
  });

  test("throws on bytes that are not Ogg", () => {
    expect(() => oggOpusDurationSeconds(new TextEncoder().encode("<html>nope</html>"))).toThrow(
      "not an Ogg Opus stream",
    );
  });

  test("throws on Ogg whose first packet is not OpusHead", () => {
    const vorbis = oggPage(1000n, new TextEncoder().encode("\x01vorbis-header-xx"));
    expect(() => oggOpusDurationSeconds(vorbis)).toThrow("first packet is not OpusHead");
  });

  test("throws on an empty buffer", () => {
    expect(() => oggOpusDurationSeconds(new Uint8Array())).toThrow("no pages");
  });

  test("throws on a truncated page", () => {
    const stream = oggOpus(312, 96_312n);
    expect(() => oggOpusDurationSeconds(stream.subarray(0, stream.length - 2))).toThrow("truncated page");
  });
});

describe("createElevenLabsVoice", () => {
  test("posts the text to ElevenLabs and returns Ogg audio with its duration", async () => {
    const audio = oggOpus(312, 48_000n * 3n + 312n);
    const { fetch, calls } = fakeFetch(() => new Response(audio, { status: 200 }));
    const voice = createElevenLabsVoice({ apiKey: API_KEY, voiceId: "voz/patricia ñ", fetch, log: () => {} });

    const spoken = await voice.synthesize("Hola, Patricia");

    expect(spoken).toEqual({ audio, mimeType: "audio/ogg", durationSeconds: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voz%2Fpatricia%20%C3%B1?output_format=opus_48000_64",
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/ogg",
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      text: "Hola, Patricia",
      model_id: "eleven_multilingual_v2",
    });
  });

  const failures: Array<[name: string, respond: () => Response, status: number | undefined, retryable: boolean]> = [
    ["a 500", () => new Response(`server exploded ${API_KEY}`, { status: 500 }), 500, true],
    ["a 429", () => new Response("too many requests", { status: 429 }), 429, true],
    ["a 401", () => new Response('{"detail":"invalid_api_key"}', { status: 401 }), 401, false],
    ["a garbage body", () => new Response("<html>not audio</html>", { status: 200 }), 200, false],
  ];

  for (const [name, respond, status, retryable] of failures) {
    test(`${name} logs one line and throws a VoiceError with retryable ${retryable}`, async () => {
      const lines: string[] = [];
      const { fetch } = fakeFetch(respond);
      const voice = createElevenLabsVoice({ apiKey: API_KEY, voiceId: "v1", fetch, log: (line) => lines.push(line) });

      const error = await rejection(voice.synthesize("Hola"));

      expect(error).toBeInstanceOf(VoiceError);
      expect((error as VoiceError).status).toBe(status);
      expect((error as VoiceError).retryable).toBe(retryable);
      expect(lines).toHaveLength(1);
      if (status !== undefined && status !== 200) expect(lines[0]).toContain(String(status));
      expect(lines[0]).not.toContain(API_KEY);
    });
  }

  test("a network failure logs one line and throws a retryable VoiceError", async () => {
    const lines: string[] = [];
    const voice = createElevenLabsVoice({
      apiKey: API_KEY,
      voiceId: "v1",
      fetch: async () => {
        throw new TypeError("fetch failed: ECONNRESET");
      },
      log: (line) => lines.push(line),
    });

    const error = await rejection(voice.synthesize("Hola"));

    expect(error).toBeInstanceOf(VoiceError);
    expect((error as VoiceError).status).toBeUndefined();
    expect((error as VoiceError).retryable).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ECONNRESET");
    expect(lines[0]).not.toContain(API_KEY);
  });

  test("the logged body is cut to 200 characters", async () => {
    const lines: string[] = [];
    const { fetch } = fakeFetch(() => new Response("x".repeat(1000), { status: 503 }));
    const voice = createElevenLabsVoice({ apiKey: API_KEY, voiceId: "v1", fetch, log: (line) => lines.push(line) });

    await rejection(voice.synthesize("Hola"));

    expect(lines[0]!.match(/x+/)![0]).toHaveLength(200);
  });
});
