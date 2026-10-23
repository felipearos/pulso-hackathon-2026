import { describe, expect, test } from "bun:test";
import { createTestApp } from "../testing";
import { SAFE_TEMPLATE } from "../validator/validator";

const MINUTE = 60_000;
const receivedAt = new Date("2026-10-19T08:00:00-03:00");

const WHY = "¿por qué me dices esto?";
const WHAT_READ = "¿qué leíste?";

const LUNES =
  "Te escribí porque tocaba nuestra cita del lunes, la que acordamos para mirar tus cuentas con calma.";
const BIENVENIDA = "Te escribí para darte la bienvenida, nada más.";
const NOT_WRITTEN_YET = "Todavía no te he escrito por mi cuenta; solo te respondo cuando me hablas.";
const NOTHING_READ = "Todavía no he leído ningún correo tuyo.";

/** Classifier replies first; the tone review prompt is the answer itself. */
function llmTable(tone = "OK"): Array<[string | RegExp, string]> {
  return [
    [WHY, '{"intencion":"askWhy"}'],
    [WHAT_READ, '{"intencion":"askWhatRead"}'],
    [/^(Te escribí|Todavía|Leí solo)/, tone],
  ];
}

function programarCita(app: ReturnType<typeof createTestApp>["app"], tipo: string) {
  return app.store.recordDecision({
    tipo: "programar-cita",
    motivo: `cita ${tipo}`,
    datos: { citaId: 1, tipo, fecha: "2026-10-19", pendienteIds: [] },
  });
}

describe("answerPregunta", () => {
  test("«¿por qué?» after a lunes cita answers with the lunes sentence and logs it", async () => {
    const { app, clock, whatsapp } = createTestApp({ llm: llmTable() });
    const cita = programarCita(app, "lunes");
    clock.advance(MINUTE);

    const move = await app.receiveMensaje({ text: WHY, whatsappId: null });

    expect(move.kind).toBe("stay");
    expect(whatsapp.outbox).toEqual([{ kind: "text", text: LUNES }]);
    const decisions = app.store.decisions();
    expect(decisions.map((d) => d.tipo)).toEqual(["programar-cita", "quedarse", "mensaje"]);
    expect(decisions.at(-1)?.motivo).toBe("respondió por qué le habló");
    expect(decisions.at(-1)?.datos).toEqual({
      pregunta: "askWhy",
      text: LUNES,
      source: "draft",
      sourceDecisionId: cita.id,
      whatsappId: "wamid-1",
    });
  });

  test("the answer follows the latest decision that made Luna speak", async () => {
    const { app, clock, whatsapp } = createTestApp({ llm: llmTable() });
    programarCita(app, "lunes");
    clock.advance(MINUTE);
    const bienvenida = programarCita(app, "bienvenida");
    app.store.recordDecision({ tipo: "callar", motivo: "hoy no", datos: { tipo: "jueves" } });
    clock.advance(MINUTE);

    await app.receiveMensaje({ text: WHY, whatsappId: null });

    expect(whatsapp.outbox).toEqual([{ kind: "text", text: BIENVENIDA }]);
    expect(app.store.decisions().at(-1)?.datos).toMatchObject({ sourceDecisionId: bienvenida.id });
  });

  test.each([
    ["jueves", "Te escribí porque tocaba nuestra cita del jueves, la que acordamos para mirar tus cuentas con calma."],
    ["domingo", "Te escribí porque tocaba nuestra cita del domingo, la que acordamos para mirar tus cuentas con calma."],
    ["bienvenida-de-vuelta", "Te escribí para darte la bienvenida de vuelta, nada más."],
    ["graduada", "Te escribí porque tocaba nuestra cita del mes, para ver cómo sigues."],
  ])("«¿por qué?» after a %s cita answers with its sentence", async (tipo, sentence) => {
    const { app, clock, whatsapp } = createTestApp({ llm: llmTable() });
    programarCita(app, tipo);
    clock.advance(MINUTE);

    await app.receiveMensaje({ text: WHY, whatsappId: null });

    expect(whatsapp.outbox).toEqual([{ kind: "text", text: sentence }]);
  });

  test("«¿por qué?» after Luna proposed plata apartada says so", async () => {
    const { app, clock, whatsapp } = createTestApp({ llm: llmTable() });
    const propuesta = app.store.recordDecision({ tipo: "proponer-plata-apartada", motivo: "propuso apartar", datos: {} });
    clock.advance(MINUTE);

    await app.receiveMensaje({ text: WHY, whatsappId: null });

    expect(whatsapp.outbox).toEqual([
      { kind: "text", text: "Te escribí para proponerte dejar un poquito de plata apartada." },
    ]);
    expect(app.store.decisions().at(-1)?.datos).toMatchObject({ sourceDecisionId: propuesta.id });
  });

  test("«¿por qué?» before Luna spoke on her own says so", async () => {
    const { app, whatsapp } = createTestApp({ llm: llmTable() });

    await app.receiveMensaje({ text: WHY, whatsappId: null });

    expect(whatsapp.outbox).toEqual([{ kind: "text", text: NOT_WRITTEN_YET }]);
    expect(app.store.decisions().at(-1)?.datos).toMatchObject({ sourceDecisionId: null });
  });

  test("«¿qué leíste?» names only the sender domains, never a subject", async () => {
    const { app, whatsapp } = createTestApp({ llm: llmTable() });
    app.receiveMail({
      id: "m1", from: "Banco Andino <avisos@bancoandino.example>", subject: "Tu estado de cuenta de octubre",
      text: "", receivedAt, links: [],
    });
    app.receiveMail({
      id: "m2", from: "avisos@tiendaplaza.example", subject: "Estado de cuenta Tienda Plaza", text: "", receivedAt, links: [],
    });
    app.receiveMail({
      id: "m3", from: "avisos@bancoandino.example", subject: "Tu compra en 6 cuotas", text: "", receivedAt, links: [],
    });

    await app.receiveMensaje({ text: WHAT_READ, whatsappId: null });

    const text = "Leí solo correos de bancoandino.example y tiendaplaza.example. Nada más.";
    expect(whatsapp.outbox).toEqual([{ kind: "text", text }]);
    expect(app.store.decisions().at(-1)?.motivo).toBe("respondió qué leyó");
  });

  test("«¿qué leíste?» with no señales says she read nothing", async () => {
    const { app, whatsapp } = createTestApp({ llm: llmTable() });

    await app.receiveMensaje({ text: WHAT_READ, whatsappId: null });

    expect(whatsapp.outbox).toEqual([{ kind: "text", text: NOTHING_READ }]);
  });

  test("a tone review that says no twice sends the plantilla segura", async () => {
    const { app, whatsapp } = createTestApp({ llm: llmTable("NO: suena seco") });
    programarCita(app, "lunes");

    await app.receiveMensaje({ text: WHY, whatsappId: null });

    expect(whatsapp.outbox).toEqual([{ kind: "text", text: SAFE_TEMPLATE }]);
    const [validator, answer] = app.store.decisions().slice(-2);
    expect(validator?.tipo).toBe("mensaje");
    expect(validator?.motivo).toContain("plantilla segura");
    expect(answer?.datos).toMatchObject({ text: SAFE_TEMPLATE, source: "safe-template" });
  });

  test("answering keeps her etapa and stores no MensajeSaliente", async () => {
    const { app, clock } = createTestApp({ llm: llmTable() });
    programarCita(app, "lunes");
    clock.advance(MINUTE);

    await app.receiveMensaje({ text: WHY, whatsappId: null });
    clock.advance(MINUTE);
    await app.receiveMensaje({ text: "👍", whatsappId: null });

    expect(app.store.getPatricia().etapa).toBe(1);
    expect(app.store.etapaHistory()).toEqual([]);
    expect(app.store.mensajesSalientes()).toEqual([]);
  });
});
