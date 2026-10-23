import { describe, expect, test } from "bun:test";
import { createTestApp } from "../testing";

const MINUTE = 60_000;

function sendCita(app: ReturnType<typeof createTestApp>["app"], text: string) {
  app.store.addMensajeSaliente({ kind: "audio", text, durationSeconds: 40, whatsappId: "wamid-cita" });
}

describe("receiveMensaje", () => {
  test("a 👍 to the etapa-1 cita moves her up and logs the decision", async () => {
    const { app, clock } = createTestApp();
    app.store.addMensajeEntrante({
      text: "me siento más o menos",
      intencion: { kind: "angustia", value: 2 },
      whatsappId: null,
    });
    clock.advance(MINUTE);
    sendCita(app, "¿Me mandas un 👍 si escuchaste?");
    clock.advance(MINUTE);

    const move = await app.receiveMensaje({ text: "👍", whatsappId: "wamid-in-1" });

    const reason = "subió: respondió la cita de la etapa 1, angustia 2";
    expect(move).toEqual({ kind: "up", from: 1, to: 2, reason });
    expect(app.store.getPatricia().etapa).toBe(2);
    expect(app.store.etapaHistory()).toEqual([{ at: clock.now(), from: 1, to: 2, motivo: reason }]);
    const decision = app.store.decisions().at(-1);
    expect(decision?.tipo).toBe("subir-etapa");
    expect(decision?.motivo).toBe(reason);
    expect(decision?.datos).toEqual({
      text: "👍",
      input: {
        etapa: 1,
        senales: [{ intencion: { kind: "accepted" }, citaEtapa: 1 }],
        lastAngustia: 2,
        estadoDeCuentaTienda: false,
        estadoDeCuentaBancoNuevo: false,
      },
      move,
    });
  });

  test("a second 👍 to the same cita does not move her again", async () => {
    const { app, clock } = createTestApp();
    sendCita(app, "¿Me mandas un 👍 si escuchaste?");
    clock.advance(MINUTE);
    await app.receiveMensaje({ text: "👍", whatsappId: null });
    clock.advance(MINUTE);

    const move = await app.receiveMensaje({ text: "👍", whatsappId: null });

    expect(move.kind).toBe("stay");
    expect(app.store.getPatricia().etapa).toBe(2);
    expect(app.store.etapaHistory()).toHaveLength(1);
    expect(app.store.decisions().at(-1)?.tipo).toBe("quedarse");
  });

  test("a cita that moved her up does not move her up again after she moved down", async () => {
    const { app, clock } = createTestApp({
      llm: [["no quiero ver", '{"intencion":"doesNotWantToSee"}']],
    });
    sendCita(app, "¿Me mandas un 👍 si escuchaste?");
    clock.advance(MINUTE);
    await app.receiveMensaje({ text: "👍", whatsappId: null });
    clock.advance(MINUTE);
    await app.receiveMensaje({ text: "no quiero ver eso", whatsappId: null });
    clock.advance(MINUTE);

    const move = await app.receiveMensaje({ text: "👍", whatsappId: null });

    expect(app.store.getPatricia().etapa).toBe(1);
    expect(move).toEqual({ kind: "stay", from: 1, to: 1, reason: "se queda: respondió sin una cita" });
  });

  test("a 👍 before Luna sent any cita keeps her in her etapa", async () => {
    const { app } = createTestApp();

    const move = await app.receiveMensaje({ text: "👍", whatsappId: null });

    expect(move).toEqual({ kind: "stay", from: 1, to: 1, reason: "se queda: respondió sin una cita" });
    expect(app.store.getPatricia().etapa).toBe(1);
  });

  test("angustia 5 in etapa 3 moves her down at once", async () => {
    const { app, clock, llm } = createTestApp({
      llm: [["estoy súper mal", '{"intencion":"angustia","valor":5}']],
    });
    app.store.setEtapa(2, "subió: prueba");
    app.store.setEtapa(3, "subió: prueba");
    clock.advance(MINUTE);
    sendCita(app, "Hoy miramos una cifra de la tienda.");
    clock.advance(MINUTE);

    const move = await app.receiveMensaje({ text: "estoy súper mal con esto", whatsappId: null });

    expect(move).toEqual({ kind: "down", from: 3, to: 2, reason: "bajó: angustia 5" });
    expect(app.store.getPatricia().etapa).toBe(2);
    const decision = app.store.decisions().at(-1);
    expect(decision?.tipo).toBe("bajar-etapa");
    expect(decision?.motivo).toBe("bajó: angustia 5");
    expect(llm.calls).toHaveLength(1);
  });

  test("a 👌 keeps her in her etapa and Luna sends nothing", async () => {
    const { app, clock, whatsapp } = createTestApp();
    sendCita(app, "¿Me mandas un 👍 si escuchaste?");
    clock.advance(MINUTE);

    const move = await app.receiveMensaje({ text: "👌", whatsappId: null });

    expect(move).toEqual({ kind: "stay", from: 1, to: 1, reason: "se queda: solo escuchó" });
    expect(app.store.getPatricia().etapa).toBe(1);
    expect(app.store.etapaHistory()).toEqual([]);
    const decision = app.store.decisions().at(-1);
    expect(decision?.tipo).toBe("quedarse");
    expect(decision?.motivo).toBe("se queda: solo escuchó");
    expect(whatsapp.outbox).toEqual([]);
  });

  test("the message is stored with its intención", async () => {
    const { app } = createTestApp();

    await app.receiveMensaje({ text: "👍", whatsappId: "wamid-in-7" });

    expect(app.store.mensajesEntrantes()).toMatchObject([
      { text: "👍", intencion: { kind: "accepted" }, whatsappId: "wamid-in-7" },
    ]);
  });

  test("👍 and 👌 never call the LLM", async () => {
    const { app, llm } = createTestApp();

    await app.receiveMensaje({ text: "👍", whatsappId: null });
    await app.receiveMensaje({ text: "👌", whatsappId: null });

    expect(llm.calls).toEqual([]);
  });
});
