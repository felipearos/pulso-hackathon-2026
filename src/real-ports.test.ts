import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "./app";
import { migrate } from "./db";
import type { Ports } from "./ports";
import { MissingEnvError, realPorts, systemClock } from "./real-ports";
import { VoiceError } from "./voice/elevenlabs";

const memory = { DATABASE_PATH: ":memory:" };

type Call = [port: string, call: (ports: Ports) => Promise<unknown>, names: string[]];

const wired: Call[] = [
  [
    "whatsapp",
    (ports) => ports.whatsapp.send({ kind: "text", text: "Hola" }),
    ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_RECIPIENT_PHONE"],
  ],
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

  for (const [port, call, names] of wired) {
    test(`${port} rejects naming every missing variable`, async () => {
      const error = await rejection(call(realPorts(memory)));
      expect(error).toBeInstanceOf(MissingEnvError);
      expect((error as MissingEnvError).missing).toEqual(names);
      expect((error as Error).message).toBe(
        `${port} port needs ${names.join(", ")}; add them to Doppler pulso-hackathon-2026`,
      );
    });
  }

  test("mail finds nothing new until Patricia connects a Gmail account", async () => {
    const urls: string[] = [];
    const ports = realPorts(memory, { fetch: async (input) => (urls.push(String(input)), new Response("{}")) });
    migrate(ports.db);
    expect(await ports.mail.fetchNew(["bancoandino.example"])).toEqual([]);
    expect(urls).toEqual([]);
  });

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

  test("voice with voz otra calls ElevenLabs with ELEVENLABS_VOICE_ID_OTRA", async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      return new Response("not audio", { status: 401 });
    };
    const env = { ...memory, ELEVENLABS_API_KEY: "key", ELEVENLABS_VOICE_ID: "voice-id", ELEVENLABS_VOICE_ID_OTRA: "otra-id" };
    await rejection(realPorts(env, { fetch, log: () => {} }).voice.synthesize("Hola", "otra"));
    expect(urls).toEqual(["https://api.elevenlabs.io/v1/text-to-speech/otra-id?output_format=opus_48000_64"]);
  });

  test("llm with no API key asks the claude binary", async () => {
    const bin = join(mkdtempSync(join(tmpdir(), "claude-cli-")), "claude");
    // Answers with the model it was given, so the test sees the arguments arrived.
    writeFileSync(
      bin,
      `#!/bin/sh\ncat > /dev/null\nfor last; do :; done\necho '{"type":"result","is_error":false,"result":"'"$last"'"}'\n`,
    );
    chmodSync(bin, 0o755);
    const ports = realPorts({ ...memory, CLAUDE_BIN: bin });
    await expect(ports.llm.complete({ model: "claude-test-model", prompt: "Hola" })).resolves.toBe("claude-test-model");
    rmSync(dirname(bin), { recursive: true });
  });

  test("llm with an API key calls Anthropic, not the CLI", async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => (urls.push(url), new Response("no", { status: 401 }));
    const env = { ...memory, ANTHROPIC_API_KEY: "key", CLAUDE_BIN: "/nonexistent/claude" };
    const error = await rejection(realPorts(env, { fetch }).llm.complete({ prompt: "Hola" }));
    expect((error as Error).message).toContain("Anthropic API request failed with status 401");
  });

  test("whatsapp with every variable set is the real client", async () => {
    const env = {
      ...memory,
      WHATSAPP_ACCESS_TOKEN: "set",
      WHATSAPP_PHONE_NUMBER_ID: "set",
      WHATSAPP_RECIPIENT_PHONE: "set",
    };
    // A non-OGG audio is refused by the real client before any request is made.
    const error = await rejection(
      realPorts(env).whatsapp.send({ kind: "audio", audio: new Uint8Array(), mimeType: "audio/mpeg", durationSeconds: 1 }),
    );
    expect(error).not.toBeInstanceOf(MissingEnvError);
    expect((error as Error).message).not.toContain("not wired yet");
    expect((error as Error).message).toContain("OGG/Opus");
  });

  test("a partially set env names only the missing variable", async () => {
    const ports = realPorts({ ...memory, WHATSAPP_ACCESS_TOKEN: "set", ELEVENLABS_VOICE_ID: "" });
    const whatsapp = await rejection(ports.whatsapp.send({ kind: "text", text: "Hola" }));
    expect((whatsapp as MissingEnvError).missing).toEqual(["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_RECIPIENT_PHONE"]);
    const voice = await rejection(ports.voice.synthesize("Hola"));
    expect((voice as MissingEnvError).missing).toEqual(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
  });
});
