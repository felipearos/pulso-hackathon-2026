import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import type { IncomingMail } from "../ports";
import { createTestApp, type TestApp } from "../testing";
import { ANGUSTIA_EMOJIS } from "./policy";

const BANCO = "avisos@bancoandino.example";
const DRAFT = "Hola, Patricia. Aquí estoy contigo, con calma, para mirar juntas cómo va todo.";

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

describe("the domingo cita and her angustia through the app", () => {
  test("a «recibimos tu pago» this week is celebrated and the cita asks the angustia", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-22T10:00"));
    await t.app.receiveMail(mail("Banco Andino: recibimos tu pago", t.clock.now()));

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
