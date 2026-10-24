import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Llm, LlmRequest, SpokenAudio, Voice } from "./ports";
import type { Voz } from "./voice/voces";

/**
 * A disk cache in front of Claude and ElevenLabs, keyed by the exact request.
 * A rehearsal of the pitch's happy path fills it; the pitch then gets the same
 * answers and audios at once, and anything off the script still goes live.
 * A failed call is never stored, and a broken entry reads as a miss.
 */
export type ReplayCache = { llm(llm: Llm): Llm; voice(voice: Voice): Voice };

function keyOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createReplayCache(dir: string, log: (line: string) => void = console.log): ReplayCache {
  const read = (path: string): Buffer | null => {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  };
  // Written aside and renamed, so a crash mid-write never leaves half an entry.
  const write = (path: string, data: string | Uint8Array) => {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${path}.tmp`, data);
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      log(`replay-cache: could not store ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    llm: (llm) => ({
      async complete(request: LlmRequest) {
        const images = request.images?.map((image) => ({ mimeType: image.mimeType, bytes: digest(image.bytes) }));
        const path = join(dir, `llm-${keyOf({ ...request, images })}.txt`);
        const hit = read(path);
        if (hit !== null) return hit.toString("utf8");
        const answer = await llm.complete(request);
        write(path, answer);
        return answer;
      },
    }),
    voice: (voice) => ({
      ...voice,
      async synthesize(text: string, voz?: Voz): Promise<SpokenAudio> {
        const key = keyOf({ text, voz: voz ?? null });
        const audioPath = join(dir, `voz-${key}.audio`);
        const metaPath = join(dir, `voz-${key}.json`);
        const audio = read(audioPath);
        const meta = read(metaPath);
        if (audio !== null && meta !== null) {
          try {
            const { mimeType, durationSeconds } = JSON.parse(meta.toString("utf8")) as Omit<SpokenAudio, "audio">;
            return { audio: new Uint8Array(audio), mimeType, durationSeconds };
          } catch {
            // A broken entry is a miss: synthesized again below.
          }
        }
        const spoken = await voice.synthesize(text, voz);
        write(audioPath, spoken.audio);
        write(metaPath, JSON.stringify({ mimeType: spoken.mimeType, durationSeconds: spoken.durationSeconds }));
        return spoken;
      },
    }),
  };
}
