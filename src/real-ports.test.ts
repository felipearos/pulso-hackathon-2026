import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type { Ports } from "./ports";
import { MissingEnvError, realPorts, systemClock } from "./real-ports";
import { VoiceError } from "./voice/elevenlabs";

const memory = { DATABASE_PATH: ":memory:" };

const calls: Array<[port: string, call: (ports: Ports) => Promise<unknown>, names: string[]]> = [
  ["mail", (ports) => ports.mail.fetchNew(), ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"]],
  [
    "whatsapp",
    (ports) => ports.whatsapp.send({ kind: "text", text: "Hola" }),
    ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
  ],
  ["llm", (ports) => ports.llm.complete({ prompt: "Hola" }), ["ANTHROPIC_API_KEY"]],
  ["voice", (ports) => ports.voice.synthesize("Hola"), ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]],
];

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("realPorts", () => {
  test("builds with no service variables set", () => {
    const ports = realPorts(memory);
    expect(ports.db.query("SELECT 1 AS one").get()).toEqual({ one: 1 });
  });

  test("the app on real ports answers health with no service variables set", async () => {
    const app = createApp(realPorts(memory));
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("the system clock returns a date", () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });

  for (const [port, call, names] of calls) {
    test(`${port} rejects naming every missing variable`, async () => {
      const error = await rejection(call(realPorts(memory)));
      expect(error).toBeInstanceOf(MissingEnvError);
      expect((error as MissingEnvError).missing).toEqual(names);
      expect((error as Error).message).toBe(
        `${port} port needs ${names.join(", ")}; add them to Doppler pulso-hackathon-2026`,
      );
    });

    if (port === "voice" || port === "llm") continue;

    test(`${port} with every variable set rejects as not wired yet`, async () => {
      const env = { ...memory, ...Object.fromEntries(names.map((name) => [name, "set"])) };
      const error = await rejection(call(realPorts(env)));
      expect(error).not.toBeInstanceOf(MissingEnvError);
      expect((error as Error).message).toContain("not wired yet");
    });
  }

  test("voice with every variable set calls ElevenLabs with them", async () => {
    const urls: string[] = [];
    const headers: unknown[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      urls.push(url);
      headers.push(init.headers);
      return new Response("not audio", { status: 401 });
    };
    const env = { ...memory, ELEVENLABS_API_KEY: "key", ELEVENLABS_VOICE_ID: "voice-id" };
    const error = await rejection(realPorts(env, { fetch, log: () => {} }).voice.synthesize("Hola"));
    expect(error).toBeInstanceOf(VoiceError);
    expect(urls).toEqual(["https://api.elevenlabs.io/v1/text-to-speech/voice-id?output_format=opus_48000_64"]);
    expect(headers[0]).toMatchObject({ "xi-api-key": "key" });
  });

  test("a partially set env names only the missing variable", async () => {
    const ports = realPorts({ ...memory, WHATSAPP_ACCESS_TOKEN: "set", ELEVENLABS_VOICE_ID: "" });
    const whatsapp = await rejection(ports.whatsapp.send({ kind: "text", text: "Hola" }));
    expect((whatsapp as MissingEnvError).missing).toEqual(["WHATSAPP_PHONE_NUMBER_ID"]);
    const voice = await rejection(ports.voice.synthesize("Hola"));
    expect((voice as MissingEnvError).missing).toEqual(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
  });
});
