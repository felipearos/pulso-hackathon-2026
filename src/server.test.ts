import { describe, expect, test } from "bun:test";
import { NIGHT_AUDIO_URL, type Snapshot } from "./demo/moments";
import type { NightAudioResult } from "./demo/night-audio";
import { createHandler } from "./server";

type Moved = { snapshot: Snapshot; whatsapp?: NightAudioResult };

async function json<T>(response: Promise<Response>): Promise<T> {
  return (await (await response).json()) as T;
}

function app(result: NightAudioResult = { sent: true, messageId: "wamid.test" }) {
  const sends: number[] = [];
  const handle = createHandler({
    demoPage: new Blob(["<h1>Luna · sala de control</h1>"]),
    nightAudio: new Blob(["ogg"]),
    sendNightAudio: async () => {
      sends.push(Date.now());
      return result;
    },
  });
  const get = (path: string) => handle(new Request(`http://localhost${path}`));
  const post = (path: string) => handle(new Request(`http://localhost${path}`, { method: "POST" }));
  return { get, post, sends };
}

describe("handle", () => {
  test("reports health", async () => {
    const response = await app().get("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("answers 404 for unknown paths", async () => {
    expect((await app().get("/nope")).status).toBe(404);
    expect((await app().post("/demo/moments/friday")).status).toBe(404);
  });

  test("serves the control room page and the test audio", async () => {
    const { get } = app();
    const page = await get("/demo");
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(await page.text()).toContain("sala de control");
    expect((await get(NIGHT_AUDIO_URL)).headers.get("Content-Type")).toBe("audio/ogg");
  });

  test("starts on Monday morning, before the statement arrives", async () => {
    const state = await json<Snapshot>(app().get("/demo/state"));
    expect(state.moment).toBe("start");
    expect(state.messages).toEqual([]);
  });

  test("moves the clock and keeps the moment for every screen that polls", async () => {
    const { get, post } = app();
    const body = await json<Moved>(post("/demo/moments/thursday-night"));
    expect(body.snapshot.moment).toBe("thursday-night");
    expect((await json<Snapshot>(get("/demo/state"))).moment).toBe("thursday-night");
  });

  test("sends the voice note only on Monday night and reports the outcome", async () => {
    const { post, sends } = app({ sent: false, reason: "whatsapp port needs WHATSAPP_ACCESS_TOKEN" });
    await post("/demo/moments/monday-email");
    expect(sends).toHaveLength(0);

    const body = await json<Moved>(post("/demo/moments/monday-night"));
    expect(sends).toHaveLength(1);
    expect(body.whatsapp).toEqual({ sent: false, reason: "whatsapp port needs WHATSAPP_ACCESS_TOKEN" });
  });

  test("resets to the start", async () => {
    const { get, post } = app();
    await post("/demo/moments/week-5");
    await post("/demo/reset");
    expect((await json<Snapshot>(get("/demo/state"))).moment).toBe("start");
  });
});
