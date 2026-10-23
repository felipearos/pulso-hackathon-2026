import { describe, expect, test } from "bun:test";
import { FakeWhatsApp } from "../fakes";
import type { WhatsApp } from "../ports";
import { createCanal, createSimulador } from "./simulador";

const AUDIO = new Uint8Array([1, 2, 3]);
const IMAGE = new Uint8Array([4, 5, 6]);
const NOTA = new Uint8Array([7, 8, 9]);

describe("simulador", () => {
  test("keeps every message in order, each with a fresh id", async () => {
    const simulador = createSimulador();
    const text = await simulador.send({ kind: "text", text: "Hola, Patricia" });
    const audio = await simulador.send({ kind: "audio", audio: AUDIO, mimeType: "audio/mpeg", durationSeconds: 42 });
    const image = await simulador.send({ kind: "image", image: IMAGE, mimeType: "image/png", caption: "Tu semana" });
    for (const { id } of [text, audio, image]) expect(id).toStartWith("sim-out-");
    expect(new Set([text.id, audio.id, image.id]).size).toBe(3);
    expect(simulador.sent()).toEqual([
      { id: text.id, message: { kind: "text", text: "Hola, Patricia" } },
      { id: audio.id, message: { kind: "audio", audio: AUDIO, mimeType: "audio/mpeg", durationSeconds: 42 } },
      { id: image.id, message: { kind: "image", image: IMAGE, mimeType: "image/png", caption: "Tu semana" } },
    ]);
  });

  test("a new simulador, as after a restart, never reuses an id", async () => {
    const before = await createSimulador().send({ kind: "audio", audio: AUDIO, mimeType: "audio/mpeg", durationSeconds: 1 });
    const after = createSimulador();
    const next = await after.send({ kind: "text", text: "Hola, Patricia" });
    expect(next.id).not.toBe(before.id);
    expect(after.media(before.id)).toBeNull();
  });

  test("a caller cannot rewrite the conversation through sent()", async () => {
    const simulador = createSimulador();
    await simulador.send({ kind: "text", text: "Hola, Patricia" });
    const list = simulador.sent() as unknown[];
    list.pop();
    expect(simulador.sent()).toHaveLength(1);
  });

  test("serves the bytes of sent audio and image, not text", async () => {
    const simulador = createSimulador();
    const text = await simulador.send({ kind: "text", text: "Hola, Patricia" });
    const audio = await simulador.send({ kind: "audio", audio: AUDIO, mimeType: "audio/mpeg", durationSeconds: 42 });
    const image = await simulador.send({ kind: "image", image: IMAGE, mimeType: "image/png" });
    expect(simulador.media(text.id)).toBeNull();
    expect(simulador.media(audio.id)).toEqual({ bytes: AUDIO, mimeType: "audio/mpeg" });
    expect(simulador.media(image.id)).toEqual({ bytes: IMAGE, mimeType: "image/png" });
    expect(simulador.media("sim-out-9")).toBeNull();
  });

  test("media she added downloads by its id, an unknown id rejects", async () => {
    const simulador = createSimulador();
    const first = simulador.addMedia({ bytes: NOTA, mimeType: "audio/webm" });
    const second = simulador.addMedia({ bytes: IMAGE, mimeType: "image/jpeg" });
    expect(first).toStartWith("sim-media-");
    expect(second).toStartWith("sim-media-");
    expect(second).not.toBe(first);
    expect(await simulador.downloadMedia(first)).toEqual({ bytes: NOTA, mimeType: "audio/webm" });
    expect(simulador.media(second)).toEqual({ bytes: IMAGE, mimeType: "image/jpeg" });
    await expect(simulador.downloadMedia("sim-media-9")).rejects.toThrow();
  });

  test("recordInbound does nothing", () => {
    const simulador = createSimulador();
    simulador.recordInbound(new Date("2026-10-23T22:00:00Z"));
    expect(simulador.sent()).toEqual([]);
  });
});

describe("canal", () => {
  test("sends to the simulador while it is active and to the real port otherwise", async () => {
    const real = new FakeWhatsApp();
    const simulador = createSimulador();
    const canal = createCanal(real, simulador, true);
    expect(canal.isSimulador()).toBe(true);
    expect((await canal.send({ kind: "text", text: "uno" })).id).toStartWith("sim-out-");

    canal.setSimulador(false);
    expect(canal.isSimulador()).toBe(false);
    expect(await canal.send({ kind: "text", text: "dos" })).toEqual({ id: "wamid-1" });

    expect(simulador.sent().map((entry) => entry.message)).toEqual([{ kind: "text", text: "uno" }]);
    expect(real.outbox).toEqual([{ kind: "text", text: "dos" }]);
  });

  test("recordInbound always reaches the real port", () => {
    const real = new FakeWhatsApp();
    const canal = createCanal(real, createSimulador(), true);
    const at = new Date("2026-10-23T22:00:00Z");
    canal.recordInbound(at);
    expect(real.inbound).toEqual([at]);
  });

  test("media downloads from where its id says, whichever side is active", async () => {
    const real = new FakeWhatsApp();
    real.media.set("media-audio-1", { bytes: AUDIO, mimeType: "audio/ogg" });
    const simulador = createSimulador();
    const id = simulador.addMedia({ bytes: NOTA, mimeType: "audio/webm" });
    const canal = createCanal(real, simulador, false);
    expect(await canal.downloadMedia(id)).toEqual({ bytes: NOTA, mimeType: "audio/webm" });
    canal.setSimulador(true);
    expect(await canal.downloadMedia("media-audio-1")).toEqual({ bytes: AUDIO, mimeType: "audio/ogg" });
    expect(real.downloads).toEqual(["media-audio-1"]);
  });

  test("a real port without downloadMedia rejects real ids clearly", async () => {
    const real: WhatsApp = { send: async () => ({ id: "wamid-1" }), recordInbound: () => {} };
    const canal = createCanal(real, createSimulador(), false);
    await expect(canal.downloadMedia("media-audio-1")).rejects.toThrow("cannot download media");
  });
});
