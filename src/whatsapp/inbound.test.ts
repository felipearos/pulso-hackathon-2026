import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createTestApp, TEST_START } from "../testing";
import type { App } from "../app";
import { FOTO_SIN_LEER, MENSAJE_NO_ENTENDIDO, NOTA_DE_VOZ_SIN_TRANSCRIBIR, receiveInbound } from "./inbound";
import type { InboundMensaje } from "./webhook";

const FROM = "56900000000";

function mensaje(body: InboundMensaje["body"], whatsappId = "wamid.TEST1"): InboundMensaje {
  return { whatsappId, from: FROM, when: TEST_START, body };
}

/** The app's own flujo normal and the real transaction, so a test sees what production sees. */
function deps(app: App, db: Database) {
  return {
    store: app.store,
    mensaje: app.receiveMensaje,
    inTransaction: <T,>(write: () => T): T => db.transaction(write)(),
  };
}

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

  test("a nota de voz is kept unread with its media id", async () => {
    const { app, llm, db } = createTestApp();

    await receiveInbound(deps(app, db), mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType: "audio/ogg" }));

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe(NOTA_DE_VOZ_SIN_TRANSCRIBIR);
    expect(entrantes[0]?.intencion).toBeNull();
    expect(llm.calls).toHaveLength(0);

    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.tipo).toBe("mensaje");
    expect(decisions[0]?.motivo).toContain(NOTA_DE_VOZ_SIN_TRANSCRIBIR);
    expect(decisions[0]?.datos).toEqual({
      whatsappId: "wamid.TEST1",
      from: FROM,
      kind: "audio",
      mediaId: "media-audio-1",
      mimeType: "audio/ogg",
    });
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
    await receiveInbound(d, mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType: null }, "wamid.TEST2"));
    await receiveInbound(d, mensaje({ kind: "other", type: "sticker" }, "wamid.TEST3"));

    expect(app.store.mensajesEntrantes().map((entrante) => entrante.whatsappId)).toEqual([
      "wamid.TEST1",
      "wamid.TEST2",
      "wamid.TEST3",
    ]);
    expect(app.store.decisions()).toHaveLength(3);
  });
});
