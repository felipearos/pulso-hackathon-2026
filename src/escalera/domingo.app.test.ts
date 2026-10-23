import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import { cifraEscrita, type CifraPermitida } from "../citas/redactor";
import { payoff } from "../figures/payoff";
import type { IncomingMail } from "../ports";
import { createTestApp, type TestApp } from "../testing";
import { ANGUSTIA_EMOJIS, SUENO_EMOJIS } from "./policy";

const BANCO = "avisos@bancoficticio.example";
const DRAFT = "Hola, Patricia. Aquí estoy contigo, con calma, para mirar juntas cómo va todo.";

const CIFRAS = {
  totalBilled: 650_000,
  monthlyRate: 0.031,
  minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
  overdue: 0,
};
const PAGO_MINIMO = 41_900;

function addEstadoDeCuenta(t: TestApp): void {
  t.app.store.addEstadoDeCuenta({
    origen: "banco",
    ciclo: 8,
    fechaCierre: "2026-10-15",
    fechaVencimiento: "2026-11-05",
    cifras: CIFRAS,
    pagoMinimo: PAGO_MINIMO,
  });
}

let nextId = 1;
function mail(subject: string, receivedAt: Date): IncomingMail {
  return { id: `domingo-${nextId++}`, from: BANCO, subject, text: "", receivedAt, links: [] };
}

function setup(): TestApp {
  return createTestApp({
    now: parseSantiago("2026-10-19T09:00"),
    llm: [
      ["Escribe el guion", DRAFT],
      ["", "OK"],
    ],
  });
}

async function domingo(t: TestApp) {
  t.clock.set(parseSantiago("2026-10-25T21:30"));
  await t.app.tick();
  const sent = t.app.store.decisions().find((d) => d.tipo === "mensaje" && d.motivo.startsWith("salió"));
  expect(sent).toBeDefined();
  return (sent!.datos as { decision: { buenaNoticia: { regla: string }; pregunta: string } })
    .decision;
}

/** The sent domingo audio's decision and the source of its guion. */
async function domingoEnviado(t: TestApp) {
  await domingo(t);
  const sent = t.app.store.decisions().find((d) => d.tipo === "mensaje" && d.motivo.startsWith("salió"));
  return sent!.datos as { decision: { cifra: CifraPermitida | null; pregunta: string }; source: string };
}

describe("the domingo cita and her angustia through the app", () => {
  test("a «recibimos tu pago» this week is celebrated and the cita asks the angustia", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-22T10:00"));
    await t.app.receiveMail(mail("Banco Ficticio: recibimos tu pago", t.clock.now()));

    const decision = await domingo(t);
    expect(decision.buenaNoticia.regla).toBe("pago-recibido");
    for (const emoji of ANGUSTIA_EMOJIS) expect(decision.pregunta).toContain(emoji);
  });

  test("without a «recibimos tu pago» this week the cita still asks the angustia", async () => {
    const t = setup();

    const decision = await domingo(t);
    expect(decision.buenaNoticia.regla).not.toBe("pago-recibido");
    for (const emoji of ANGUSTIA_EMOJIS) expect(decision.pregunta).toContain(emoji);
  });

  test("a pago sobre el mínimo this week makes the domingo say la fecha en que queda libre", async () => {
    const { fixedPayment, versusMinimum } = payoff(CIFRAS, 50_000, "2026-10-25");
    if (!fixedPayment.ends || !versusMinimum.comparable) throw new Error("the fixture must pay off earlier");
    const cifra: CifraPermitida = {
      kind: "fecha-libre",
      freeOn: fixedPayment.freeOn,
      mesesAdelantados: versusMinimum.monthsSaved,
    };
    const t = createTestApp({
      now: parseSantiago("2026-10-19T09:00"),
      llm: [
        ["Escribe el guion", `Hola, Patricia. Pagando como esta semana, quedas libre de la tarjeta ${cifraEscrita(cifra)} que pagando solo el mínimo.`],
        ["", "OK"],
      ],
    });
    addEstadoDeCuenta(t);
    t.clock.set(parseSantiago("2026-10-22T10:00"));
    await t.app.receiveMail(mail("Banco Ficticio: recibimos tu pago de $50.000", t.clock.now()));

    const { decision, source } = await domingoEnviado(t);
    expect(decision.cifra).toEqual(cifra);
    expect(source).not.toBe("safe-template");
    for (const emoji of SUENO_EMOJIS) expect(decision.pregunta).toContain(emoji);
  });

  test("a pago of exactly the pago mínimo keeps the usual domingo cifra", async () => {
    const t = setup();
    addEstadoDeCuenta(t);
    t.clock.set(parseSantiago("2026-10-22T10:00"));
    await t.app.receiveMail(mail("Banco Ficticio: recibimos tu pago de $41.900", t.clock.now()));

    const { decision } = await domingoEnviado(t);
    expect(decision.cifra?.kind).not.toBe("fecha-libre");
  });

  test("her «😐😴» is stored as angustia 3 without asking the LLM", async () => {
    const t = setup();
    await domingo(t);
    const llmCalls = t.llm.calls.length;

    t.clock.set(parseSantiago("2026-10-25T21:40"));
    await t.app.receiveMensaje({ text: "😐😴", whatsappId: "in-1" });

    expect(t.app.store.mensajesEntrantes().at(-1)?.intencion).toEqual({ kind: "angustia", value: 3 });
    expect(t.llm.calls).toHaveLength(llmCalls);
  });

  test("her 😟 is stored as angustia 4 without asking the LLM", async () => {
    const t = setup();
    await domingo(t);
    const llmCalls = t.llm.calls.length;

    t.clock.set(parseSantiago("2026-10-25T21:40"));
    await t.app.receiveMensaje({ text: "😟", whatsappId: "in-1" });

    expect(t.app.store.mensajesEntrantes().at(-1)?.intencion).toEqual({ kind: "angustia", value: 4 });
    expect(t.llm.calls).toHaveLength(llmCalls);
  });

  test("a 😰 in etapa 3 moves her down to etapa 2", async () => {
    const t = setup();
    t.app.store.setEtapa(3, "subió: respondió la cita de la etapa 2");
    await domingo(t);

    t.clock.set(parseSantiago("2026-10-25T21:40"));
    await t.app.receiveMensaje({ text: "😰", whatsappId: "in-1" });

    expect(t.app.store.getPatricia().etapa).toBe(2);
    const bajar = t.app.store.decisions().filter((d) => d.tipo === "bajar-etapa");
    expect(bajar).toHaveLength(1);
    expect(bajar[0]!.motivo).toBe("bajó: angustia 5");
  });

  test("a 😰 after the domingo cita's estado de cuenta image is still read as her angustia", async () => {
    const t = setup();
    t.app.store.addEstadoDeCuenta({
      origen: "banco",
      ciclo: 8,
      fechaCierre: "2026-10-15",
      fechaVencimiento: "2026-11-05",
      cifras: {
        totalBilled: 650_000,
        monthlyRate: 0.031,
        minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
        overdue: 0,
      },
      pagoMinimo: 41_900,
    });
    t.app.store.setEtapa(3, "subió: respondió la cita de la etapa 2");
    await domingo(t);
    expect(t.app.store.mensajesSalientes().at(-1)?.kind).toBe("image");

    t.clock.set(parseSantiago("2026-10-25T21:40"));
    await t.app.receiveMensaje({ text: "😰", whatsappId: "in-1" });

    expect(t.app.store.mensajesEntrantes().at(-1)?.intencion).toEqual({ kind: "angustia", value: 5 });
    expect(t.app.store.getPatricia().etapa).toBe(2);
  });

  test("a 😟 to Luna's answer after the domingo cita is not read as an angustia answer", async () => {
    const t = createTestApp({
      now: parseSantiago("2026-10-19T09:00"),
      llm: [
        ["Escribe el guion", DRAFT],
        ["¿por qué me escribes?", '{"intencion":"askWhy"}'],
        ["", "OK"],
      ],
    });
    t.app.store.setEtapa(3, "subió: respondió la cita de la etapa 2");
    await domingo(t);
    t.clock.set(parseSantiago("2026-10-25T21:35"));
    await t.app.receiveMensaje({ text: "¿por qué me escribes?", whatsappId: "in-1" });
    const llmCalls = t.llm.calls.length;

    t.clock.set(parseSantiago("2026-10-25T21:40"));
    await t.app.receiveMensaje({ text: "😟", whatsappId: "in-2" });

    expect(t.llm.calls.length).toBeGreaterThan(llmCalls);
    expect(t.app.store.mensajesEntrantes().at(-1)?.intencion).not.toEqual({ kind: "angustia", value: 4 });
    expect(t.app.store.getPatricia().etapa).toBe(3);
  });

  test("after a lunes cita a 😟 is not read as an angustia answer: the LLM classifies it", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-19T22:30"));
    await t.app.tick();
    expect(t.app.store.citas().find((c) => c.mensajeSalienteId !== null)?.tipo).toBe("lunes");
    const llmCalls = t.llm.calls.length;

    t.clock.set(parseSantiago("2026-10-19T22:40"));
    await t.app.receiveMensaje({ text: "😟", whatsappId: "in-1" });

    expect(t.llm.calls.length).toBeGreaterThan(llmCalls);
    expect(t.llm.calls.at(-1)?.prompt).toContain("😟");
  });
});
