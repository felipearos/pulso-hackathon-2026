import { describe, expect, test } from "bun:test";
import type { IncomingMail } from "../ports";
import { createTestApp, type TestApp } from "../testing";
import {
  bolsilloNombrado,
  PEDIR_NOMBRE,
  PREGUNTA_BOLSILLO,
  SIN_BOLSILLO,
} from "./bolsillo";

const CATALOGO = "pedidos@catalogoejemplo.example";
const JUEVES = new Date("2026-10-22T22:31:00-03:00");
const CIERRE = "Gracias por contarme, Patricia.";
const APORTES = ["$30.000", "$27.000", "$24.000"] as const;
const LLM_REPLIES: Array<[string, string]> = [
  ["Anotado", "OK"],
  ["Una pregunta", "OK"],
  ["Qué nombre", "OK"],
  ["No te vuelvo", "OK"],
  ["Listo: desde ahora", "OK"],
  ["👎", '{"intencion":"other"}'],
  ["🤷", '{"intencion":"other"}'],
  ["Para la mamá", '{"intencion":"other"}'],
  ['"sí"', '{"intencion":"other"}'],
  ["Viaje 2027", '{"intencion":"other"}'],
];

let nextId = 1;
function mail(subject: string, receivedAt: Date): IncomingMail {
  return { id: `bolsillo-${nextId++}`, from: CATALOGO, subject, text: "", receivedAt, links: [] };
}

function addS3Week(t: TestApp, dates: readonly string[]): void {
  for (const [index, day] of dates.entries()) {
    t.clock.set(new Date(`${day}T13:00:00-03:00`));
    t.app.receiveMail(mail(`Pagamos tu pedido #${index + 1} por ${APORTES[index]!}`, t.clock.now()));
  }
}

function setup(): TestApp {
  const t = createTestApp({ llm: LLM_REPLIES });
  t.app.store.addEstadoDeCuenta({
    origen: "banco",
    ciclo: 1,
    fechaCierre: null,
    fechaVencimiento: null,
    cifras: null,
    pagoMinimo: 41900,
  });
  addS3Week(t, ["2026-10-19", "2026-10-20", "2026-10-21"]);
  t.clock.set(JUEVES);
  return t;
}

async function jueves(t: TestApp) {
  await t.app.tick();
  const cita = t.app.store.citaOn("2026-10-22");
  expect(cita).toMatchObject({ tipo: "jueves", estado: "programada" });
  return cita!;
}

async function nextThursday(t: TestApp) {
  addS3Week(t, ["2026-10-26", "2026-10-27", "2026-10-28"]);
  t.clock.set(new Date("2026-10-29T22:31:00-03:00"));
  await t.app.tick();
  const cita = t.app.store.citaOn("2026-10-29");
  expect(cita).toMatchObject({ tipo: "jueves", estado: "programada" });
  return cita!;
}

const decisionsOf = (t: TestApp, tipo: string) => t.app.store.decisions().filter((decision) => decision.tipo === tipo);
const outboxTexts = (t: TestApp) =>
  t.whatsapp.outbox.filter((message) => message.kind === "text").map((message) => message.text);

function expectNoMovementQuestion(t: TestApp): void {
  expect(outboxTexts(t).some((text) => /pasaste|moviste/i.test(text))).toBe(false);
}

async function askBolsillo(t: TestApp, citaId: number): Promise<void> {
  await t.app.receiveMensaje({ text: "👍", whatsappId: "in-propuesta" });
  expect(outboxTexts(t).slice(-2)).toEqual([`Anotado: $50.000 este mes. ${CIERRE}`, PREGUNTA_BOLSILLO]);
  expect(decisionsOf(t, "preguntar-bolsillo")).toMatchObject([{ datos: { citaId, text: PREGUNTA_BOLSILLO } }]);
}

describe("the bolsillo through the app", () => {
  test("a 👍 to the propuesta gets its reply and then asks about the bolsillo once", async () => {
    const t = setup();
    const cita = await jueves(t);

    await askBolsillo(t, cita.id);

    expect(decisionsOf(t, "preguntar-bolsillo")).toHaveLength(1);
    expect(decisionsOf(t, "respuesta-propuesta")).toHaveLength(1);
    expect(t.app.store.mensajesSalientes().filter((message) => message.kind === "text")).toEqual([]);
    expectNoMovementQuestion(t);
  });

  test("a named bolsillo is used in next week's propuesta and its reminder", async () => {
    const t = setup();
    const cita = await jueves(t);
    await askBolsillo(t, cita.id);

    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-si" });
    expect(outboxTexts(t).at(-1)).toBe(PEDIR_NOMBRE);
    await t.app.receiveMensaje({ text: "Para la mamá", whatsappId: "in-nombre" });
    expect(t.app.store.getPatricia().bolsillo).toBe("Para la mamá");
    expect(outboxTexts(t).at(-1)).toBe(bolsilloNombrado("Para la mamá"));
    expect(decisionsOf(t, "nombrar-bolsillo")).toMatchObject([
      { motivo: "le puso «Para la mamá» a su bolsillo", datos: { citaId: cita.id, nombre: "Para la mamá" } },
    ]);

    await nextThursday(t);
    const propuesta = decisionsOf(t, "proponer-plata-apartada").at(-1)!.datos as { texto: string };
    expect(propuesta.texto).toContain("Esta semana llevas $8.100 para «Para la mamá».");
    t.whatsapp.outbox.length = 0;
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-next-week" });

    expect(outboxTexts(t)).toEqual([
      `Anotado: $50.000 este mes. Mañana, cuando pagues, pasa lo apartado a «Para la mamá». ${CIERRE}`,
    ]);
    expect(decisionsOf(t, "preguntar-bolsillo")).toHaveLength(1);
    expectNoMovementQuestion(t);
  });

  test("the mínimo reply with a named bolsillo has no reminder", async () => {
    const t = setup();
    t.app.store.updatePatricia({ bolsillo: "Para la mamá" });
    const cita = await jueves(t);
    t.app.store.recordDecision({
      tipo: "preguntar-bolsillo",
      motivo: "preguntó si su banco le deja tener un bolsillo",
      datos: { citaId: cita.id, text: PREGUNTA_BOLSILLO, source: "draft", whatsappId: "wamid-question" },
    });
    t.app.store.recordDecision({
      tipo: "respuesta-bolsillo",
      motivo: "tiene bolsillo",
      datos: { citaId: cita.id, respuesta: "si", text: "👍" },
    });
    t.app.store.recordDecision({
      tipo: "nombrar-bolsillo",
      motivo: "le puso «Para la mamá» a su bolsillo",
      datos: { citaId: cita.id, nombre: "Para la mamá" },
    });

    await t.app.receiveMensaje({ text: "👌", whatsappId: "in-minimo" });

    expect(outboxTexts(t)).toEqual([`Anotado: el mínimo este mes. ${CIERRE}`]);
    expectNoMovementQuestion(t);
  });

  test("👎 closes the question for good and never adds a reminder", async () => {
    const t = setup();
    const cita = await jueves(t);
    await askBolsillo(t, cita.id);

    await t.app.receiveMensaje({ text: "👎", whatsappId: "in-no" });
    expect(outboxTexts(t).at(-1)).toBe(SIN_BOLSILLO);
    expect(decisionsOf(t, "respuesta-bolsillo")).toMatchObject([
      { motivo: "no tiene bolsillo", datos: { citaId: cita.id, respuesta: "no", text: "👎" } },
    ]);

    t.whatsapp.outbox.length = 0;
    await nextThursday(t);
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-next-week" });
    expect(outboxTexts(t)).toEqual([`Anotado: $50.000 este mes. ${CIERRE}`]);
    expect(decisionsOf(t, "preguntar-bolsillo")).toHaveLength(1);
    expectNoMovementQuestion(t);
  });

  test("🤷 gets the same reply as 👎", async () => {
    const t = setup();
    const cita = await jueves(t);
    await askBolsillo(t, cita.id);

    await t.app.receiveMensaje({ text: "🤷", whatsappId: "in-no-sabe" });

    expect(outboxTexts(t).at(-1)).toBe(SIN_BOLSILLO);
    expect(decisionsOf(t, "respuesta-bolsillo")).toMatchObject([
      { motivo: "no sabe si tiene bolsillo", datos: { citaId: cita.id, respuesta: "no-sabe", text: "🤷" } },
    ]);
    expectNoMovementQuestion(t);
  });

  test("an unanswered question closes when a later cita is programada", async () => {
    const t = setup();
    const cita = await jueves(t);
    await askBolsillo(t, cita.id);
    t.whatsapp.outbox.length = 0;

    await nextThursday(t);
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-next-week" });

    expect(outboxTexts(t)).toEqual([`Anotado: $50.000 este mes. ${CIERRE}`]);
    expect(decisionsOf(t, "respuesta-bolsillo")).toEqual([]);
    expect(decisionsOf(t, "preguntar-bolsillo")).toHaveLength(1);
    expectNoMovementQuestion(t);
  });

  test("a crisis-like message while naming is open is not stored as the name", async () => {
    const t = setup();
    const cita = await jueves(t);
    await askBolsillo(t, cita.id);
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-si" });
    expect(outboxTexts(t).at(-1)).toBe(PEDIR_NOMBRE);

    await t.app.receiveMensaje({ text: "no quiero vivir", whatsappId: "in-crisis" });

    expect(t.app.store.getPatricia().bolsillo).toBeNull();
    expect(decisionsOf(t, "nombrar-bolsillo")).toEqual([]);
    expectNoMovementQuestion(t);
  });

  test("a second «sí» or a name with a figure is not the name; the next plain one is", async () => {
    const t = setup();
    const cita = await jueves(t);
    await askBolsillo(t, cita.id);
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-si" });

    await t.app.receiveMensaje({ text: "sí", whatsappId: "in-si-otra-vez" });
    await t.app.receiveMensaje({ text: "Viaje 2027", whatsappId: "in-cifra" });
    expect(t.app.store.getPatricia().bolsillo).toBeNull();
    expect(outboxTexts(t).at(-1)).toBe(PEDIR_NOMBRE);

    await t.app.receiveMensaje({ text: "Para la mamá", whatsappId: "in-nombre" });
    expect(t.app.store.getPatricia().bolsillo).toBe("Para la mamá");
  });

  test("the name still lands after a later cita is programada", async () => {
    const t = setup();
    const cita = await jueves(t);
    await askBolsillo(t, cita.id);
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-si" });

    await nextThursday(t);
    await t.app.receiveMensaje({ text: "Para la mamá", whatsappId: "in-nombre" });

    expect(t.app.store.getPatricia().bolsillo).toBe("Para la mamá");
    expect(outboxTexts(t).at(-1)).toBe(bolsilloNombrado("Para la mamá"));
  });
});
