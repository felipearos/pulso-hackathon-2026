import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import { createTestApp, type TestApp } from "../testing";
import type { OutgoingWhatsApp, WhatsApp } from "../ports";
import { CRISIS_TEXT, sendCrisisText } from "./crisis";

const MINUTE_MS = 60 * 1000;
const STEP_MS = 15 * MINUTE_MS;
// A CRISIS_PHRASES match: the classifier answers crisis without the LLM.
const CRISIS = "ya no doy más";

const LLM: Array<[string, string]> = [
  ["Escribe el guion", "Hola, Patricia. Qué bueno escucharte de nuevo. Estás al día. ¿Cómo estás hoy?"],
  ["pausa", '{"intencion":"pause"}'],
  ["hola", '{"intencion":"hello"}'],
];

function setup(): TestApp {
  return createTestApp({ llm: LLM });
}

function ofTipo(t: TestApp, tipo: string) {
  return t.app.store.decisions().filter((d) => d.tipo === tipo);
}

async function tickUntil({ app, clock }: TestApp, until: string): Promise<void> {
  const end = parseSantiago(until).getTime();
  while (clock.now().getTime() <= end) {
    await app.tick();
    clock.advance(STEP_MS);
  }
}

describe("crisis protocol", () => {
  test("CRISIS_TEXT gives both phone lines and says nothing about money", () => {
    expect(CRISIS_TEXT).toContain("600 360 7777");
    expect(CRISIS_TEXT).toContain("*4141");
    for (const word of ["$", "peso", "deuda", "mínimo", "pago", "cuenta"]) {
      expect(CRISIS_TEXT.toLowerCase()).not.toContain(word);
    }
  });

  test("a crisis at 02:00 sends the fixed text at once, pauses her and keeps her etapa", async () => {
    const t = setup();
    for (const etapa of [2, 3] as const) t.app.store.setEtapa(etapa, "subió: prueba");
    t.clock.set(parseSantiago("2026-10-21T02:00"));

    const move = await t.app.receiveMensaje({ text: CRISIS, whatsappId: null });

    expect(move).toEqual({ kind: "freeze", from: 3, to: 3, reason: "congelada: crisis" });
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: CRISIS_TEXT }]);
    expect(t.app.store.getPatricia().enPausa).toBe(true);
    expect(t.app.store.getPatricia().etapa).toBe(3);
    const [crisis] = ofTipo(t, "crisis");
    expect(crisis?.datos).toEqual({ desde: t.clock.now().toISOString(), text: CRISIS });
    const mensaje = ofTipo(t, "mensaje").at(-1);
    expect(mensaje?.datos).toEqual({ crisis: true, text: CRISIS_TEXT, whatsappId: "wamid-1" });
    expect(t.app.store.mensajesSalientes()).toEqual([]);
    expect(ofTipo(t, "quedarse")).toEqual([]);
    // The phrase short-circuits the classifier, and the text never goes to the LLM.
    expect(t.llm.calls).toEqual([]);
  });

  test("while in a crisis pausa the scheduler sends nothing", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: CRISIS, whatsappId: null });
    const sent = t.whatsapp.outbox.length;

    await tickUntil(t, "2026-10-26T23:00");

    expect(t.whatsapp.outbox).toHaveLength(sent);
    expect(t.app.store.getPatricia().enPausa).toBe(true);
  });

  test("a second crisis during the crisis pausa sends the text again and keeps the pausa", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: CRISIS, whatsappId: null });
    t.clock.advance(MINUTE_MS);

    const move = await t.app.receiveMensaje({ text: CRISIS, whatsappId: null });

    expect(move.kind).toBe("freeze");
    expect(t.whatsapp.outbox).toEqual([
      { kind: "text", text: CRISIS_TEXT },
      { kind: "text", text: CRISIS_TEXT },
    ]);
    expect(t.app.store.getPatricia().enPausa).toBe(true);
    expect(ofTipo(t, "crisis")).toHaveLength(2);
    expect(ofTipo(t, "vuelta")).toEqual([]);
  });

  test("a crisis during a normal pausa keeps the pausa and sends the text", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: "pausa", whatsappId: null });
    t.clock.advance(MINUTE_MS);

    await t.app.receiveMensaje({ text: CRISIS, whatsappId: null });

    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: CRISIS_TEXT }]);
    expect(t.app.store.getPatricia().enPausa).toBe(true);
    expect(ofTipo(t, "vuelta")).toEqual([]);
  });

  test("«pausa» during a crisis pausa stays and logs nothing", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: CRISIS, whatsappId: null });
    const decisions = t.app.store.decisions().length;

    const move = await t.app.receiveMensaje({ text: "pausa", whatsappId: null });

    expect(move.reason).toBe("en pausa: ya estaba en pausa");
    expect(t.app.store.getPatricia().enPausa).toBe(true);
    expect(t.app.store.decisions()).toHaveLength(decisions);
  });

  test("from etapa 3, a crisis then «hola» brings her back in etapa 1 with a bienvenida de vuelta", async () => {
    const t = setup();
    for (const etapa of [2, 3] as const) t.app.store.setEtapa(etapa, "subió: prueba");
    await t.app.receiveMensaje({ text: CRISIS, whatsappId: null });
    const desde = t.clock.now().toISOString();
    t.clock.advance(60 * MINUTE_MS);

    const move = await t.app.receiveMensaje({ text: "hola", whatsappId: null });

    const reason = "vuelve en la etapa 1: después de una crisis";
    expect(move).toEqual({ kind: "down", from: 3, to: 1, reason });
    expect(t.app.store.getPatricia()).toMatchObject({ etapa: 1, enPausa: false });
    const [vuelta] = ofTipo(t, "vuelta");
    expect(vuelta?.motivo).toBe(reason);
    expect(vuelta?.datos).toMatchObject({ desde, from: 3, to: 1 });
    const pendientes = t.app.store.pendientes().filter((p) => p.tipo === "bienvenida-de-vuelta");
    expect(pendientes).toHaveLength(1);
  });

  test("a failed send is tried again, one send per attempt", async () => {
    const t = setup();
    const sent: OutgoingWhatsApp[] = [];
    let failures = 2;
    const whatsapp: WhatsApp = {
      async send(message) {
        sent.push(message);
        if (failures-- > 0) throw new Error("meta down");
        return { id: "wamid-ok" };
      },
      recordInbound() {},
    };

    await sendCrisisText({ store: t.app.store, whatsapp });

    expect(sent).toHaveLength(3);
    expect(ofTipo(t, "mensaje").at(-1)?.datos).toEqual({ crisis: true, text: CRISIS_TEXT, whatsappId: "wamid-ok" });
  });

  test("when every attempt fails the log says the crisis text did not go out", async () => {
    const t = setup();
    const whatsapp: WhatsApp = {
      async send() {
        throw new Error("meta down");
      },
      recordInbound() {},
    };

    await sendCrisisText({ store: t.app.store, whatsapp });

    const mensaje = ofTipo(t, "mensaje").at(-1);
    expect(mensaje?.motivo).toBe("no se pudo enviar el texto del protocolo de crisis");
    expect(mensaje?.datos).toEqual({ crisis: true, text: CRISIS_TEXT, whatsappId: null, attempts: 3 });
  });
});
