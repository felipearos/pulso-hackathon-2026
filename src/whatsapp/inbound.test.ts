import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { App } from "../app";
import { FakeLlm, FakeVoice, FakeWhatsApp } from "../fakes";
import { createTestApp, TEST_START, type TestApp } from "../testing";
import {
  FOTO_SIN_LEER,
  MENSAJE_NO_ENTENDIDO,
  NOTA_DE_VOZ_NO_ESCUCHADA,
  NOTA_DE_VOZ_SIN_TRANSCRIBIR,
  receiveInbound,
} from "./inbound";
import type { InboundMensaje } from "./webhook";

const FROM = "56900000000";

function mensaje(body: InboundMensaje["body"], whatsappId = "wamid.TEST1"): InboundMensaje {
  return { whatsappId, from: FROM, when: TEST_START, body };
}

/** The app's own flujo normal and the real transaction, so a test sees what production sees. */
function deps(app: App, db: Database, ports?: Pick<TestApp, "whatsapp" | "voice" | "llm">) {
  return {
    store: app.store,
    mensaje: app.receiveMensaje,
    inTransaction: <T,>(write: () => T): T => db.transaction(write)(),
    whatsapp: ports?.whatsapp ?? new FakeWhatsApp(),
    voice: ports?.voice ?? new FakeVoice(),
    llm: ports?.llm ?? new FakeLlm([]),
  };
}

/** A fictional nota de voz, as Meta hands it over. */
const VOICE_NOTE = { bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53]), mimeType: "audio/ogg" };

/** The validador's tone review passes the calm answer. */
const TONE_OK: [string, string] = [NOTA_DE_VOZ_NO_ESCUCHADA, "OK"];

describe("receiveInbound", () => {
  test("a bare 👍 goes through the flujo normal, without calling the LLM", async () => {
    const { app, llm, db } = createTestApp();

    await receiveInbound(deps(app, db), mensaje({ kind: "text", text: "👍" }));

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe("👍");
    expect(entrantes[0]?.intencion).toEqual({ kind: "accepted" });
    expect(entrantes[0]?.whatsappId).toBe("wamid.TEST1");
    expect(llm.calls).toHaveLength(0);

    // The política decided, and said so in the registro: with no cita to
    // answer it is «quedarse», and the 👍 it read is in it.
    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.tipo).toBe("quedarse");
    expect(decisions[0]?.datos).toMatchObject({ text: "👍" });
  });

  test("free text is classified through the LLM and decided on", async () => {
    const { app, llm, db } = createTestApp({ llm: [["pagué el mínimo", '{"intencion":"minimum"}']] });

    await receiveInbound(deps(app, db), mensaje({ kind: "text", text: "pagué el mínimo no más" }));

    expect(llm.calls).toHaveLength(1);
    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.intencion).toEqual({ kind: "minimum" });
    expect(entrantes[0]?.whatsappId).toBe("wamid.TEST1");
    expect(app.store.decisions()).toHaveLength(1);
  });

  test("a 👍 reaction to Luna's audio moves her up, exactly as typing it does", async () => {
    /** Answers the cita Luna already sent, which is what the política reads. */
    const answering = async (body: InboundMensaje["body"]) => {
      const { app, llm, db } = createTestApp();
      app.store.addMensajeSaliente({
        kind: "audio",
        text: "la cita de la noche",
        durationSeconds: 40,
        whatsappId: "wamid.LUNA1",
      });
      await receiveInbound(deps(app, db), mensaje(body));
      return { app, llm };
    };

    const typed = await answering({ kind: "text", text: "👍" });
    const reacted = await answering({ kind: "reaction", emoji: "👍", toWhatsappId: "wamid.LUNA1" });

    const entrantes = reacted.app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe("👍");
    expect(entrantes[0]?.intencion).toEqual({ kind: "accepted" });
    expect(reacted.llm.calls).toHaveLength(0);

    // The 👍 answered the cita, so she moved up — and it reads the same either way.
    expect(reacted.app.store.decisions().map((decision) => decision.tipo)).toEqual(["subir-etapa"]);
    expect(reacted.app.store.getPatricia().etapa).toBe(2);
    expect(reacted.app.store.getPatricia().etapa).toBe(typed.app.store.getPatricia().etapa);

    // What the registro keeps apart is how it arrived, and which audio it answered.
    expect(reacted.app.store.decisions()[0]?.datos).toMatchObject({
      whatsappId: "wamid.TEST1",
      arrival: { from: FROM, kind: "reaction", toWhatsappId: "wamid.LUNA1" },
    });
    expect(typed.app.store.decisions()[0]?.datos).toMatchObject({
      arrival: { from: FROM, kind: "text" },
    });
  });

  test("an entrante whose decisión fails leaves nothing behind", async () => {
    const { app, db } = createTestApp();
    const d = deps(app, db);
    // The registro de decisiones refuses a write; the entrante must go with it.
    const broken = { ...d, store: { ...app.store, recordDecision: () => { throw new Error("registro caído"); } } };

    await expect(receiveInbound(broken, mensaje({ kind: "audio", mediaId: "media-1", mimeType: null }))).rejects.toThrow(
      "registro caído",
    );

    expect(app.store.mensajesEntrantes()).toEqual([]);
    expect(app.store.decisions()).toEqual([]);
  });

  test("a nota de voz is transcribed and goes through the flujo normal", async () => {
    const t = createTestApp({
      llm: [["pagué el mínimo", '{"intencion":"minimum"}']],
      voice: { transcripts: ["pagué el mínimo no más"] },
    });
    t.whatsapp.media.set("media-audio-1", VOICE_NOTE);

    await receiveInbound(deps(t.app, t.db, t), mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType: "audio/ogg" }));

    expect(t.whatsapp.downloads).toEqual(["media-audio-1"]);
    expect(t.voice.transcribed).toEqual([{ bytes: VOICE_NOTE.bytes.length, mimeType: "audio/ogg" }]);

    const entrantes = t.app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe("pagué el mínimo no más");
    expect(entrantes[0]?.intencion).toEqual({ kind: "minimum" });
    expect(entrantes[0]?.whatsappId).toBe("wamid.TEST1");

    // The registro says it came as a nota de voz.
    const decisions = t.app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.datos).toMatchObject({
      text: "pagué el mínimo no más",
      whatsappId: "wamid.TEST1",
      arrival: { from: FROM, kind: "audio" },
    });
    expect(t.whatsapp.outbox).toEqual([]);
  });

  /** A nota de voz Luna could not hear: kept unread, and she asks calmly for an emoji. */
  async function expectNotHeard(t: TestApp, mimeType: string | null) {
    const before = t.app.store.mensajesSalientes();

    await receiveInbound(deps(t.app, t.db, t), mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType }));

    const entrantes = t.app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe(NOTA_DE_VOZ_SIN_TRANSCRIBIR);
    expect(entrantes[0]?.intencion).toBeNull();

    const [unread, answer] = t.app.store.decisions();
    expect(unread?.tipo).toBe("mensaje");
    expect(unread?.motivo).toContain(NOTA_DE_VOZ_SIN_TRANSCRIBIR);
    expect(unread?.motivo).toContain("no se pudo transcribir");
    expect(unread?.datos).toMatchObject({
      whatsappId: "wamid.TEST1",
      from: FROM,
      kind: "audio",
      mediaId: "media-audio-1",
      mimeType,
      error: expect.any(String),
    });

    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: NOTA_DE_VOZ_NO_ESCUCHADA }]);
    expect(NOTA_DE_VOZ_NO_ESCUCHADA).toContain("emoji");
    expect(NOTA_DE_VOZ_NO_ESCUCHADA).toContain("👍");
    expect(NOTA_DE_VOZ_NO_ESCUCHADA).not.toMatch(/deberías|tienes que|culpa|otra vez|de nuevo/i);
    expect(answer?.datos).toMatchObject({ text: NOTA_DE_VOZ_NO_ESCUCHADA, source: "draft" });

    // Not a cita: the list a 👍 answers stays as it was.
    expect(t.app.store.mensajesSalientes()).toEqual(before);
  }

  test("a nota de voz that fails to transcribe is kept unread and Luna asks for an emoji", async () => {
    const t = createTestApp({ llm: [TONE_OK], voice: { transcribeFailures: 1 } });
    t.whatsapp.media.set("media-audio-1", VOICE_NOTE);

    await expectNotHeard(t, "audio/ogg");
    expect(t.voice.transcribed).toHaveLength(1);
  });

  test("a nota de voz that fails to download is kept unread and Luna asks for an emoji", async () => {
    const t = createTestApp({ llm: [TONE_OK] });

    await expectNotHeard(t, null);
    expect(t.whatsapp.downloads).toEqual(["media-audio-1"]);
    expect(t.voice.transcribed).toEqual([]);
  });

  test("a nota de voz with an empty transcript is kept unread and Luna asks for an emoji", async () => {
    const t = createTestApp({ llm: [TONE_OK], voice: { transcripts: ["  "] } });
    t.whatsapp.media.set("media-audio-1", VOICE_NOTE);

    await expectNotHeard(t, "audio/ogg");
  });

  test("during a pausa, a nota de voz Luna cannot hear gets no answer", async () => {
    const t = createTestApp({ llm: [TONE_OK], voice: { transcribeFailures: 1 } });
    t.whatsapp.media.set("media-audio-1", VOICE_NOTE);
    t.app.store.updatePatricia({ enPausa: true });

    await receiveInbound(deps(t.app, t.db, t), mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType: "audio/ogg" }));

    expect(t.app.store.mensajesEntrantes()[0]?.text).toBe(NOTA_DE_VOZ_SIN_TRANSCRIBIR);
    expect(t.whatsapp.outbox).toEqual([]);
    expect(t.app.store.getPatricia().enPausa).toBe(true);
  });

  test("ports that cannot transcribe keep the nota de voz unread instead of throwing", async () => {
    const t = createTestApp({ llm: [TONE_OK] });
    const { synthesize } = t.voice;
    const voice = { synthesize: synthesize.bind(t.voice) };

    await receiveInbound(
      { ...deps(t.app, t.db, t), voice },
      mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType: "audio/ogg" }),
    );

    expect(t.app.store.mensajesEntrantes()[0]?.text).toBe(NOTA_DE_VOZ_SIN_TRANSCRIBIR);
    expect(t.whatsapp.downloads).toEqual([]);
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: NOTA_DE_VOZ_NO_ESCUCHADA }]);
  });

  test("a foto is kept unread with its media id", async () => {
    const { app, db } = createTestApp();

    await receiveInbound(deps(app, db), mensaje({ kind: "image", mediaId: "media-image-1", mimeType: null }));

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe(FOTO_SIN_LEER);
    expect(entrantes[0]?.intencion).toBeNull();

    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.motivo).toContain(FOTO_SIN_LEER);
    expect(decisions[0]?.datos).toEqual({
      whatsappId: "wamid.TEST1",
      from: FROM,
      kind: "image",
      mediaId: "media-image-1",
      mimeType: null,
    });
  });

  test("an unknown kind is kept with its raw type", async () => {
    const { app, db } = createTestApp();

    await receiveInbound(deps(app, db), mensaje({ kind: "other", type: "sticker" }));

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe(MENSAJE_NO_ENTENDIDO);
    expect(entrantes[0]?.intencion).toBeNull();

    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.datos).toEqual({ whatsappId: "wamid.TEST1", from: FROM, kind: "other", type: "sticker" });
  });

  test("the registro de decisiones only grows, one entry per message", async () => {
    const { app, db } = createTestApp();
    const d = deps(app, db);

    await receiveInbound(d, mensaje({ kind: "text", text: "👍" }, "wamid.TEST1"));
    await receiveInbound(d, mensaje({ kind: "image", mediaId: "media-image-1", mimeType: null }, "wamid.TEST2"));
    await receiveInbound(d, mensaje({ kind: "other", type: "sticker" }, "wamid.TEST3"));

    expect(app.store.mensajesEntrantes().map((entrante) => entrante.whatsappId)).toEqual([
      "wamid.TEST1",
      "wamid.TEST2",
      "wamid.TEST3",
    ]);
    expect(app.store.decisions()).toHaveLength(3);
  });
});
