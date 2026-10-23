import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import { createTestApp, type TestApp } from "../testing";
import { CRISIS_TEXT } from "./crisis";
import { madrugadaText, madrugadaTextOtraVez } from "./madrugada";

const WORRY = "No puedo dormir pensando en la tarjeta";
const WORRY_2 = "Me da miedo que me llamen del banco";
const WORRY_3 = "No sé cómo voy a pagar todo";
const WHY = "¿por qué me escribes?";
const DRAFT = "Hola, Patricia. Aquí estoy contigo, con calma, para mirar juntas cómo va todo.";

function setup(): TestApp {
  return createTestApp({
    now: parseSantiago("2026-10-19T09:00"),
    llm: [
      [WORRY, '{"intencion":"angustia","value":3}'],
      [WORRY_2, '{"intencion":"other"}'],
      [WORRY_3, '{"intencion":"other"}'],
      [WHY, '{"intencion":"askWhy"}'],
      ["Escribe el guion", DRAFT],
      ["", "OK"],
    ],
  });
}

function madrugadaDecisions(t: TestApp) {
  return t.app.store
    .decisions()
    .filter((d) => d.tipo === "mensaje" && (d.datos as { madrugada?: boolean }).madrugada === true)
    .map((d) => d.datos as { text: string; whatsappId: string; durationSeconds: number });
}

describe("Luna in the madrugada through the app", () => {
  test("a message at 02:30 gets one nota de voz with no figure, and nothing more", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-20T02:30"));

    await t.app.receiveMensaje({ text: WORRY, whatsappId: "in-1" });

    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);
    const [decision] = madrugadaDecisions(t);
    expect(decision?.text).toBe(madrugadaText(t.app.store.getPatricia().nombre));
    expect(decision?.text).not.toMatch(/\d/);
    expect(decision?.text).not.toContain("$");
    expect(decision?.whatsappId).toBe("wamid-1");
    expect(t.voice.calls).toEqual([decision!.text]);
  });

  test("three messages the same night get three notas de voz, the later two shorter", async () => {
    const t = setup();
    const { nombre } = t.app.store.getPatricia();

    t.clock.set(parseSantiago("2026-10-20T01:10"));
    await t.app.receiveMensaje({ text: WORRY, whatsappId: "in-1" });
    t.clock.set(parseSantiago("2026-10-20T02:30"));
    await t.app.receiveMensaje({ text: WORRY_2, whatsappId: "in-2" });
    t.clock.set(parseSantiago("2026-10-20T04:45"));
    await t.app.receiveMensaje({ text: WORRY_3, whatsappId: "in-3" });

    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio", "audio", "audio"]);
    expect(madrugadaDecisions(t).map((d) => d.text)).toEqual([
      madrugadaText(nombre),
      madrugadaTextOtraVez(nombre),
      madrugadaTextOtraVez(nombre),
    ]);
    const preocupaciones = t.app.store.pendientes().filter((p) => p.tipo === "preocupacion");
    expect(preocupaciones).toHaveLength(3);
  });

  test("the next madrugada starts again with the first answer", async () => {
    const t = setup();
    const { nombre } = t.app.store.getPatricia();

    t.clock.set(parseSantiago("2026-10-20T02:30"));
    await t.app.receiveMensaje({ text: WORRY, whatsappId: "in-1" });
    t.clock.set(parseSantiago("2026-10-21T02:30"));
    await t.app.receiveMensaje({ text: WORRY_2, whatsappId: "in-2" });

    expect(madrugadaDecisions(t).map((d) => d.text)).toEqual([madrugadaText(nombre), madrugadaText(nombre)]);
  });

  test("«¿por qué?» at night gets the nota de voz, not its daytime answer", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-20T03:00"));

    await t.app.receiveMensaje({ text: WHY, whatsappId: "in-1" });

    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);
    expect(t.whatsapp.outbox.some((m) => m.kind === "text")).toBe(false);
    expect(madrugadaDecisions(t)).toHaveLength(1);
  });

  test("the worry reaches the next cita", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-20T02:30"));
    await t.app.receiveMensaje({ text: WORRY, whatsappId: "in-1" });
    const preocupacion = t.app.store.pendientes().find((p) => p.tipo === "preocupacion");
    expect(preocupacion?.datos).toEqual({ text: WORRY, whatsappId: "in-1" });

    t.clock.set(parseSantiago("2026-10-22T22:30"));
    await t.app.tick();

    const programada = t.app.store.decisions().find((d) => d.tipo === "programar-cita");
    expect(programada?.datos).toMatchObject({ pendienteIds: expect.arrayContaining([preocupacion!.id]) });
  });

  test("a crisis at 02:30 still gets the crisis text and no nota de voz", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-20T02:30"));

    await t.app.receiveMensaje({ text: "no quiero vivir", whatsappId: "in-1" });

    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: CRISIS_TEXT }]);
    expect(madrugadaDecisions(t)).toHaveLength(0);
  });

  test("after a crisis, her next message at night brings her back and gets the nota de voz", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-20T02:30"));
    await t.app.receiveMensaje({ text: "no quiero vivir", whatsappId: "in-1" });

    t.clock.set(parseSantiago("2026-10-20T03:00"));
    await t.app.receiveMensaje({ text: WORRY_2, whatsappId: "in-2" });

    expect(t.app.store.getPatricia().enPausa).toBe(false);
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["text", "audio"]);
    expect(madrugadaDecisions(t)).toHaveLength(1);
  });

  test("the same message at 14:00 gets no nota de voz", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-20T14:00"));

    await t.app.receiveMensaje({ text: WORRY, whatsappId: "in-1" });

    expect(t.whatsapp.outbox).toHaveLength(0);
    expect(madrugadaDecisions(t)).toHaveLength(0);
    expect(t.app.store.pendientes().some((p) => p.tipo === "preocupacion")).toBe(false);
  });
});
