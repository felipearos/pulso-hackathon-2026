import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createTestApp, TEST_START } from "../testing";
import { FOTO_SIN_LEER, MENSAJE_NO_ENTENDIDO, NOTA_DE_VOZ_SIN_TRANSCRIBIR, receiveMensaje } from "./inbound";
import type { InboundMensaje } from "./webhook";

const FROM = "56900000000";

function mensaje(body: InboundMensaje["body"], whatsappId = "wamid.TEST1"): InboundMensaje {
  return { whatsappId, from: FROM, when: TEST_START, body };
}

/** The real transaction, so a test sees what production sees. */
function inTransaction(db: Database) {
  return <T,>(write: () => T): T => db.transaction(write)();
}

describe("receiveMensaje", () => {
  test("a bare 👍 is read as accepted without calling the LLM", async () => {
    const { app, llm, db } = createTestApp();

    await receiveMensaje({ store: app.store, llm, inTransaction: inTransaction(db) }, mensaje({ kind: "text", text: "👍" }));

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe("👍");
    expect(entrantes[0]?.intencion).toEqual({ kind: "accepted" });
    expect(entrantes[0]?.whatsappId).toBe("wamid.TEST1");
    expect(llm.calls).toHaveLength(0);

    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.tipo).toBe("mensaje");
    expect(decisions[0]?.motivo).toBe("entrante: escribió «👍», se leyó como acepta");
    expect(decisions[0]?.datos).toEqual({
      whatsappId: "wamid.TEST1",
      from: FROM,
      text: "👍",
      intencion: { kind: "accepted" },
    });
  });

  test("free text is classified through the LLM", async () => {
    const { app, llm, db } = createTestApp({ llm: [["pagué el mínimo", '{"intencion":"minimum"}']] });

    await receiveMensaje({ store: app.store, llm, inTransaction: inTransaction(db) }, mensaje({ kind: "text", text: "pagué el mínimo no más" }));

    expect(llm.calls).toHaveLength(1);
    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.intencion).toEqual({ kind: "minimum" });
    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.datos).toMatchObject({ whatsappId: "wamid.TEST1", intencion: { kind: "minimum" } });
  });

  test("a 👍 reaction to Luna's audio counts as acceptance, like typing it", async () => {
    const { app, llm, db } = createTestApp();

    await receiveMensaje(
      { store: app.store, llm, inTransaction: inTransaction(db) },
      mensaje({ kind: "reaction", emoji: "👍", toWhatsappId: "wamid.LUNA1" }),
    );

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe("👍");
    expect(entrantes[0]?.intencion).toEqual({ kind: "accepted" });
    expect(llm.calls).toHaveLength(0);

    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.motivo).toBe("entrante: reaccionó con «👍», se leyó como acepta");
    expect(decisions[0]?.datos).toEqual({
      whatsappId: "wamid.TEST1",
      from: FROM,
      emoji: "👍",
      toWhatsappId: "wamid.LUNA1",
      intencion: { kind: "accepted" },
    });
  });

  test("a nota de voz is kept unread with its media id", async () => {
    const { app, llm, db } = createTestApp();

    await receiveMensaje(
      { store: app.store, llm, inTransaction: inTransaction(db) },
      mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType: "audio/ogg" }),
    );

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
    const { app, llm, db } = createTestApp();

    await receiveMensaje({ store: app.store, llm, inTransaction: inTransaction(db) }, mensaje({ kind: "image", mediaId: "media-image-1", mimeType: null }));

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
    const { app, llm, db } = createTestApp();

    await receiveMensaje({ store: app.store, llm, inTransaction: inTransaction(db) }, mensaje({ kind: "other", type: "sticker" }));

    const entrantes = app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]?.text).toBe(MENSAJE_NO_ENTENDIDO);
    expect(entrantes[0]?.intencion).toBeNull();

    const decisions = app.store.decisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.datos).toEqual({ whatsappId: "wamid.TEST1", from: FROM, kind: "other", type: "sticker" });
  });

  test("the registro de decisiones only grows, one entry per message", async () => {
    const { app, llm, db } = createTestApp();
    const deps = { store: app.store, llm, inTransaction: inTransaction(db) };

    await receiveMensaje(deps, mensaje({ kind: "text", text: "👍" }, "wamid.TEST1"));
    await receiveMensaje(deps, mensaje({ kind: "audio", mediaId: "media-audio-1", mimeType: null }, "wamid.TEST2"));
    await receiveMensaje(deps, mensaje({ kind: "other", type: "sticker" }, "wamid.TEST3"));

    expect(app.store.mensajesEntrantes().map((entrante) => entrante.whatsappId)).toEqual([
      "wamid.TEST1",
      "wamid.TEST2",
      "wamid.TEST3",
    ]);
    const decisions = app.store.decisions();
    expect(decisions.map((decision) => decision.tipo)).toEqual(["mensaje", "mensaje", "mensaje"]);
    expect(decisions.map((decision) => (decision.datos as { whatsappId: string }).whatsappId)).toEqual([
      "wamid.TEST1",
      "wamid.TEST2",
      "wamid.TEST3",
    ]);
  });
});
