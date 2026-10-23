import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import type { OutgoingWhatsApp } from "../ports";
import { createTestApp, type TestApp } from "../testing";
import { findFigures } from "../validator/validator";
import { montoEnPantalla } from "../voz/montos";
import { PREGUNTA_GRADUADA } from "./redactor";

const DRAFT = "Hola, aquí estoy contigo, con calma.";
const CIFRAS = {
  totalBilled: 650_000,
  monthlyRate: 0.031,
  minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
  overdue: 0,
};

function setup(llm: Array<[string, string]> = [["Escribe el guion", DRAFT], ["", "OK"]]): TestApp {
  return createTestApp({
    now: parseSantiago("2026-11-01T00:00"),
    llm,
  });
}

async function tickAt(t: TestApp, at: string): Promise<void> {
  t.clock.set(parseSantiago(at));
  await t.app.tick();
}

async function graduadaCita(t: TestApp): Promise<number> {
  t.app.store.setEtapa("graduada", "se graduó: abrió el estado de cuenta ella");
  await tickAt(t, "2026-11-02T22:30");
  const cita = t.app.store.citaOn("2026-11-02");
  expect(cita).toMatchObject({ tipo: "graduada", estado: "programada" });
  return cita!.id;
}

function texts(t: TestApp): Extract<OutgoingWhatsApp, { kind: "text" }>[] {
  return t.whatsapp.outbox.filter((message): message is Extract<OutgoingWhatsApp, { kind: "text" }> => message.kind === "text");
}

function contarDecisions(t: TestApp) {
  return t.app.store.decisions().filter((decision) => decision.tipo === "contar-estado-de-cuenta");
}

describe("the graduada cita reply through the app", () => {
  test("sends one monthly cita with the graduada question", async () => {
    const t = setup();
    await graduadaCita(t);
    const audio = t.app.store.mensajesSalientes().find((message) => message.kind !== "image");
    expect(audio?.text).toEndWith(PREGUNTA_GRADUADA);

    await tickAt(t, "2026-11-05T22:30");
    await tickAt(t, "2026-11-08T21:30");
    expect(t.app.store.citas().map(({ fecha, tipo }) => ({ fecha, tipo }))).toEqual([
      { fecha: "2026-11-02", tipo: "graduada" },
    ]);
  });

  test("👌 gets the pago mínimo read from the estado de cuenta by text and keeps her graduada", async () => {
    const t = setup();
    t.app.store.updatePatricia({ nombre: "Rosa" });
    const citaId = await graduadaCita(t);
    t.app.store.addEstadoDeCuenta({
      origen: "banco",
      ciclo: 8,
      fechaCierre: "2026-10-15",
      fechaVencimiento: "2026-11-05",
      cifras: null,
      pagoMinimo: 18_500,
    });
    const monto = 18_500;

    t.clock.set(parseSantiago("2026-11-02T22:40"));
    await t.app.receiveMensaje({ text: "👌", whatsappId: "in-1" });

    expect(texts(t)).toEqual([
      {
        kind: "text",
        text: `Te lo cuento, Rosa: en tu último estado de cuenta, el pago mínimo es ${montoEnPantalla(monto)}. Lo que pongas sobre el mínimo lo decides tú, con calma.`,
      },
    ]);
    expect(findFigures(texts(t)[0]!.text)).toEqual([monto]);
    expect(contarDecisions(t)).toHaveLength(1);
    expect(contarDecisions(t)[0]!.motivo).toBe("le contó el estado de cuenta del mes: graduada");
    expect(contarDecisions(t)[0]!.datos).toMatchObject({ citaId, whatsappId: "wamid-2", source: "draft", mensajeId: 1 });
    expect(t.app.store.getPatricia().etapa).toBe("graduada");
  });

  test("«Cuéntamelo tú» bypasses doesNotWantToSee and Luna tells her", async () => {
    const t = setup([
      ["Escribe el guion", DRAFT],
      ["Cuéntamelo tú", '{"intencion":"doesNotWantToSee"}'],
      ["", "OK"],
    ]);
    t.app.store.addEstadoDeCuenta({
      origen: "banco",
      ciclo: 8,
      fechaCierre: "2026-10-15",
      fechaVencimiento: "2026-11-05",
      cifras: CIFRAS,
      pagoMinimo: 41_900,
    });
    await graduadaCita(t);

    t.clock.set(parseSantiago("2026-11-02T22:40"));
    await t.app.receiveMensaje({ text: "Cuéntamelo tú", whatsappId: "in-1" });

    expect(t.app.store.mensajesEntrantes().at(-1)?.intencion).toEqual({ kind: "listened" });
    expect(t.llm.calls.some((call) => call.prompt.includes("Cuéntamelo tú"))).toBe(false);
    expect(texts(t)).toHaveLength(1);
    expect(texts(t)[0]!.text).toContain("el pago mínimo es");
    expect(t.app.store.getPatricia().etapa).toBe("graduada");
  });

  test("👍 keeps her graduada and sends no text", async () => {
    const t = setup();
    await graduadaCita(t);

    t.clock.set(parseSantiago("2026-11-02T22:40"));
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-1" });

    expect(texts(t)).toEqual([]);
    expect(t.app.store.getPatricia().etapa).toBe("graduada");
  });

  test("a second 👌 does not send another text", async () => {
    const t = setup();
    await graduadaCita(t);

    t.clock.set(parseSantiago("2026-11-02T22:40"));
    await t.app.receiveMensaje({ text: "👌", whatsappId: "in-1" });
    t.clock.set(parseSantiago("2026-11-02T22:41"));
    await t.app.receiveMensaje({ text: "👌", whatsappId: "in-2" });

    expect(texts(t)).toHaveLength(1);
    expect(contarDecisions(t)).toHaveLength(1);
    expect(t.app.store.getPatricia().etapa).toBe("graduada");
  });

  test("a computed minimum never stands in for a pago mínimo the mail did not say", async () => {
    const t = setup();
    await graduadaCita(t);
    t.app.store.addEstadoDeCuenta({
      origen: "banco",
      ciclo: 8,
      fechaCierre: "2026-10-15",
      fechaVencimiento: "2026-11-05",
      cifras: CIFRAS,
      pagoMinimo: null,
    });

    t.clock.set(parseSantiago("2026-11-02T22:40"));
    await t.app.receiveMensaje({ text: "👌", whatsappId: "in-1" });

    expect(texts(t)[0]?.text).toBe(
      "Te lo cuento, Patricia: todavía no me llega tu estado de cuenta. Cuando llegue, te lo cuento.",
    );
  });

  test("without a bank estado de cuenta with a pago mínimo, Luna waits gently", async () => {
    const t = setup();
    const citaId = await graduadaCita(t);

    t.clock.set(parseSantiago("2026-11-02T22:40"));
    await t.app.receiveMensaje({ text: "👌", whatsappId: "in-1" });

    expect(texts(t)[0]?.text).toBe(
      "Te lo cuento, Patricia: todavía no me llega tu estado de cuenta. Cuando llegue, te lo cuento.",
    );
    expect(findFigures(texts(t)[0]!.text)).toEqual([]);
    expect(contarDecisions(t)[0]!.datos).toMatchObject({ citaId, source: "draft" });
    expect(t.app.store.getPatricia().etapa).toBe("graduada");
  });

  test("👌 after an etapa 3 lunes cita does not get the graduada text", async () => {
    const t = setup();
    t.app.store.setEtapa(3, "subió: respondió la cita de la etapa 2");
    await tickAt(t, "2026-11-02T22:30");

    t.clock.set(parseSantiago("2026-11-02T22:40"));
    await t.app.receiveMensaje({ text: "👌", whatsappId: "in-1" });

    expect(texts(t)).toEqual([]);
    expect(t.app.store.getPatricia().etapa).toBe(3);
  });
});
