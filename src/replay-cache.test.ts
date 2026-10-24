import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Llm, LlmRequest, Voice } from "./ports";
import { createReplayCache } from "./replay-cache";

const quiet = () => {};
const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "replay-cache-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function countingLlm(answers: string[]): Llm & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const answer = answers.shift();
      if (answer === undefined) throw new Error("llm down");
      return answer;
    },
  };
}

function countingVoice(): Voice & { texts: string[] } {
  const texts: string[] = [];
  return {
    texts,
    async synthesize(text) {
      texts.push(text);
      return { audio: new Uint8Array([texts.length]), mimeType: "audio/ogg", durationSeconds: 3 };
    },
  };
}

describe("the replay cache", () => {
  test("answers the same llm request from disk, a different one live", async () => {
    const dir = tempDir();
    const llm = countingLlm(["primera", "segunda"]);
    const cached = createReplayCache(dir, quiet).llm(llm);
    expect(await cached.complete({ system: "s", prompt: "hola" })).toBe("primera");
    expect(await createReplayCache(dir, quiet).llm(llm).complete({ system: "s", prompt: "hola" })).toBe("primera");
    expect(await cached.complete({ system: "s", prompt: "otra" })).toBe("segunda");
    expect(llm.calls.map(({ prompt }) => prompt)).toEqual(["hola", "otra"]);
  });

  test("keys images by their bytes", async () => {
    const llm = countingLlm(["uno", "dos"]);
    const cached = createReplayCache(tempDir(), quiet).llm(llm);
    const image = (byte: number) => ({ bytes: new Uint8Array([byte]), mimeType: "image/png" });
    expect(await cached.complete({ prompt: "foto", images: [image(1)] })).toBe("uno");
    expect(await cached.complete({ prompt: "foto", images: [image(2)] })).toBe("dos");
    expect(await cached.complete({ prompt: "foto", images: [image(1)] })).toBe("uno");
  });

  test("never stores a failed call", async () => {
    const dir = tempDir();
    const cached = createReplayCache(dir, quiet).llm(countingLlm([]));
    await expect(cached.complete({ prompt: "hola" })).rejects.toThrow("llm down");
    expect(readdirSync(dir)).toEqual([]);
  });

  test("replays an audio by its text and voz", async () => {
    const dir = tempDir();
    const voice = countingVoice();
    const cached = createReplayCache(dir, quiet).voice(voice);
    const first = await cached.synthesize("Hola Patricia");
    expect(await cached.synthesize("Hola Patricia")).toEqual(first);
    await cached.synthesize("Hola Patricia", "otra");
    expect(voice.texts).toEqual(["Hola Patricia", "Hola Patricia"]);
  });

  test("logs each hit and miss, so a rehearsal shows what the pitch will replay", async () => {
    const lines: string[] = [];
    const cached = createReplayCache(tempDir(), (line) => lines.push(line)).llm(countingLlm(["uno"]));
    await cached.complete({ prompt: "Mensaje de Patricia: hola" });
    await cached.complete({ prompt: "Mensaje de Patricia: hola" });
    expect(lines).toEqual([
      "replay-cache: miss llm «Mensaje de Patricia: hola»",
      "replay-cache: hit llm «Mensaje de Patricia: hola»",
    ]);
  });

  test("reads a broken entry as a miss", async () => {
    const dir = tempDir();
    const voice = countingVoice();
    const cached = createReplayCache(dir, quiet).voice(voice);
    await cached.synthesize("Hola");
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) writeFileSync(join(dir, name), "{");
    await cached.synthesize("Hola");
    expect(voice.texts).toEqual(["Hola", "Hola"]);
  });
});
