import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import type { OutgoingWhatsApp } from "../ports";
import { createTestApp, type TestApp } from "../testing";
import { findFigures } from "../validator/validator";
import { guionHablado } from "./envio";

const DRAFT_ETAPA_1 = "Hola, Patricia. Estás al día, no estás en DICOM. Este mes el pago mínimo es $41.900.";
const DRAFT_ETAPA_2 = "Estás al día, no estás en DICOM. Hay una salida: 17 meses pagando $50.000, con calma.";
const SHORT = "Estás al día. El pago mínimo es $41.900.";
const DRAFT_DOMINGO = "Hola, Patricia. Llegó tu pago esta semana, ya te confirmaron que lo recibieron.";
const PAGO_ORIGEN = { mailId: "mail-pago", from: "avisos@banco.example", subject: "Recibimos tu pago" };

const EMOJI_AT_END = /\p{Extended_Pictographic}$/u;

function setup(options: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const t = createTestApp({
    now: parseSantiago("2026-10-19T09:00"),
    llm: [
      ["Escribe el guion", DRAFT_ETAPA_1],
      ["Acorta este guion", SHORT],
      ["", "OK"],
    ],
    ...options,
  });
  // Estado de cuenta 8 from the case, as in `src/citas/redactor.test.ts`.
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
  return t;
}

async function tickAt({ app, clock }: TestApp, at: string): Promise<void> {
  clock.set(parseSantiago(at));
  await app.tick();
}

function audios(t: TestApp): Extract<OutgoingWhatsApp, { kind: "audio" }>[] {
  return t.whatsapp.outbox.filter((m): m is Extract<OutgoingWhatsApp, { kind: "audio" }> => m.kind === "audio");
}

function sentDecision(t: TestApp) {
  return t.app.store.decisions().find((d) => d.tipo === "mensaje" && d.motivo.startsWith("salió"));
}

describe("guionHablado", () => {
  test("says the pago mínimo in words", () => {
    expect(guionHablado("El pago mínimo es $41.900.", { kind: "pago-minimo", monto: 41_900 })).toBe(
      "El pago mínimo es cuarenta y un mil novecientos pesos.",
    );
  });

  test("says the cuota of la salida in words and keeps the meses", () => {
    expect(guionHablado("Son 17 meses pagando $50.000.", { kind: "salida", meses: 17, cuota: 50_000 })).toBe(
      "Son 17 meses pagando cincuenta mil pesos.",
    );
  });

  test("says the monto in words without a dollar sign, and does not repeat pesos", () => {
    const cifra = { kind: "pago-minimo" as const, monto: 41_900 };
    expect(guionHablado("El mínimo es 41.900 pesos, o 41900.", cifra)).toBe(
      "El mínimo es cuarenta y un mil novecientos pesos, o cuarenta y un mil novecientos pesos.",
    );
    expect(guionHablado("Son $ 141.900 y 41.9001.", cifra)).toBe("Son $ 141.900 y 41.9001.");
  });

  test("leaves la fecha en que queda libre as it is", () => {
    const guion = "Quedas libre en marzo de 2028, 42 meses antes.";
    expect(guionHablado(guion, { kind: "fecha-libre", freeOn: "2028-03-26", mesesAdelantados: 42 })).toBe(guion);
  });

  test("leaves a guion without cifra as it is", () => {
    expect(guionHablado("Hola, Patricia.", null)).toBe("Hola, Patricia.");
  });
});

describe("cita sender", () => {
  test("the lunes cita goes out once as a nota de voz", async () => {
    const t = setup();
    await tickAt(t, "2026-10-19T22:30");

    expect(audios(t)).toHaveLength(1);
    expect(t.whatsapp.outbox).toHaveLength(1);
    const mensajes = t.app.store.mensajesSalientes();
    expect(mensajes).toHaveLength(1);
    const mensaje = mensajes[0]!;
    expect(mensaje.kind).toBe("audio");
    expect(mensaje.whatsappId).toBe("wamid-1");
    expect(findFigures(mensaje.text!)).toEqual([41_900]);
    expect(mensaje.text).toMatch(EMOJI_AT_END);
    expect(t.voice.calls[0]).toContain("cuarenta y un mil novecientos pesos");
    expect(t.voice.calls[0]).not.toContain("41.900");
    expect(t.app.store.citaOn("2026-10-19")?.mensajeSalienteId).toBe(mensaje.id);
    expect(sentDecision(t)?.motivo).toBe("salió la cita del lunes, etapa 1: nota de voz de 3 s");

    await tickAt(t, "2026-10-19T22:31");
    await tickAt(t, "2026-10-19T22:45");
    expect(t.whatsapp.outbox).toHaveLength(1);
    expect(t.voice.calls).toHaveLength(1);
  });

  test("a later tienda estado de cuenta does not replace the bank's in the cita", async () => {
    const t = setup();
    t.app.store.addEstadoDeCuenta({
      origen: "tienda",
      ciclo: 1,
      fechaCierre: "2026-10-16",
      fechaVencimiento: "2026-11-06",
      cifras: { totalBilled: 180_000, monthlyRate: 0.035, minimumRule: { percent: 0.05, floor: 5_000, roundTo: 100 } },
      pagoMinimo: 9_000,
    });
    await tickAt(t, "2026-10-19T22:30");

    expect(findFigures(t.app.store.mensajesSalientes()[0]!.text!)).toEqual([41_900]);
  });

  test("etapa 2 carries la salida", async () => {
    const t = setup({
      llm: [
        ["Escribe el guion", DRAFT_ETAPA_2],
        ["", "OK"],
      ],
    });
    t.app.store.setEtapa(2, "subió: quiere ver la salida");
    await tickAt(t, "2026-10-19T22:30");

    expect(audios(t)).toHaveLength(1);
    expect(t.app.store.mensajesSalientes()[0]!.text).toContain("17 meses pagando $50.000");
    expect(t.voice.calls[0]).toContain("17 meses pagando cincuenta mil pesos");
  });

  test("the domingo cita celebrates a «recibimos tu pago» from this week", async () => {
    const t = setup({ llm: [["Escribe el guion", DRAFT_DOMINGO], ["", "OK"]] });
    t.clock.set(parseSantiago("2026-10-22T10:00"));
    t.app.store.addSenal({ tipo: "S5", origen: PAGO_ORIGEN });
    await tickAt(t, "2026-10-25T21:30");

    expect(sentDecision(t)?.datos).toMatchObject({
      decision: { tipo: "domingo", buenaNoticia: { regla: "pago-recibido" }, cifra: { kind: "pago-minimo", monto: 41_900 } },
    });
  });

  test("a «recibimos tu pago» from last week is not celebrated on domingo", async () => {
    const t = setup({ llm: [["Escribe el guion", DRAFT_DOMINGO], ["", "OK"]] });
    t.clock.set(parseSantiago("2026-10-18T10:00"));
    t.app.store.addSenal({ tipo: "S5", origen: PAGO_ORIGEN });
    await tickAt(t, "2026-10-25T21:30");

    expect(sentDecision(t)?.datos).toMatchObject({
      decision: { tipo: "domingo", buenaNoticia: { regla: "sin-mora" } },
    });
  });

  test("a compra en cuotas from October gives December's buena noticia: its last cuota, ending in enero", async () => {
    const t = createTestApp({
      now: parseSantiago("2026-10-22T10:00"),
      llm: [
        ["Escribe el guion", "Hola, Patricia. A la compra en Farmacia Ejemplo le queda una sola cuota."],
        ["", "OK"],
      ],
    });
    t.app.store.addSenal({
      tipo: "S4",
      origen: { mailId: "mail-cuotas", from: "avisos@banco.example", subject: "Compra en 3 cuotas en Farmacia Ejemplo" },
    });
    await tickAt(t, "2026-12-07T22:30");

    expect(sentDecision(t)?.datos).toMatchObject({
      decision: {
        buenaNoticia: {
          regla: "cuota-termina",
          texto: "a la compra en Farmacia Ejemplo le queda una sola cuota, termina en enero",
        },
      },
    });
  });

  test("an audio over 45 seconds is rewritten shorter once", async () => {
    const t = setup({ voice: { durations: [52, 30] } });
    await tickAt(t, "2026-10-19T22:30");

    expect(t.voice.calls).toHaveLength(2);
    expect(t.llm.calls.some((c) => c.prompt.includes("Acorta este guion"))).toBe(true);
    expect(audios(t).map((a) => a.durationSeconds)).toEqual([30]);
    expect(t.app.store.mensajesSalientes()[0]!.text).toStartWith(SHORT);
    expect(sentDecision(t)?.datos).toMatchObject({ acortado: true, durationSeconds: 30 });
  });

  test("the audio's decision records the bank estado de cuenta its cifra came from", async () => {
    const t = setup();
    const banco = t.app.store.estadosDeCuenta()[0]!;
    await tickAt(t, "2026-10-19T22:30");

    expect(sentDecision(t)?.datos).toMatchObject({ estadoDeCuentaId: banco.id });
  });

  test("the audio's decision records no estado de cuenta when none is stored", async () => {
    const t = createTestApp({
      now: parseSantiago("2026-10-19T09:00"),
      llm: [
        ["Escribe el guion", "Hola, Patricia. Esta semana no hay nada que hacer."],
        ["", "OK"],
      ],
    });
    await tickAt(t, "2026-10-19T22:30");

    expect(sentDecision(t)?.datos).toMatchObject({ estadoDeCuentaId: null });
  });

  test("a failed send is retried on the next tick of the same day", async () => {
    const t = setup({ voice: { failures: 2 } });
    await tickAt(t, "2026-10-19T22:30");
    await tickAt(t, "2026-10-19T22:35");

    expect(t.whatsapp.outbox).toEqual([]);
    const failures = t.app.store.decisions().filter((d) => d.motivo.startsWith("no salió"));
    expect(failures).toHaveLength(1);
    expect(failures[0]!.datos).toMatchObject({ error: "FakeVoice failed on purpose" });
    expect(t.app.store.mensajesSalientes()).toEqual([]);
    expect(t.app.store.citaOn("2026-10-19")?.mensajeSalienteId).toBeNull();

    await tickAt(t, "2026-10-19T22:45");
    expect(audios(t)).toHaveLength(1);
    expect(t.app.store.citaOn("2026-10-19")?.mensajeSalienteId).not.toBeNull();
  });

  test("a cita whose day has passed is never sent", async () => {
    const t = setup({ voice: { failures: 1 } });
    await tickAt(t, "2026-10-19T22:30");
    expect(t.whatsapp.outbox).toEqual([]);

    await tickAt(t, "2026-10-20T09:00");
    expect(t.whatsapp.outbox).toEqual([]);
    expect(t.app.store.citaOn("2026-10-19")?.mensajeSalienteId).toBeNull();
  });

  test("a second tick while one send is running does not send twice", async () => {
    const t = setup();
    t.clock.set(parseSantiago("2026-10-19T22:30"));
    await Promise.all([t.app.tick(), t.app.tick()]);
    expect(t.whatsapp.outbox).toHaveLength(1);
  });

  test("a fresh Patricia hears the principal voice", async () => {
    const t = setup();
    await tickAt(t, "2026-10-19T22:30");
    expect(t.voice.voces).toEqual(["principal"]);
  });

  test("speaks with the voz Patricia chose", async () => {
    const t = setup();
    t.app.store.updatePatricia({ voz: "otra" });
    await tickAt(t, "2026-10-19T22:30");
    expect(t.voice.voces).toEqual(["otra"]);
  });
});

describe("bienvenida", () => {
  const PERMITIR = "https://desktop.taild8ed7e.ts.net/permitir";

  function setupBienvenida(): TestApp {
    const t = setup();
    t.app.store.addPendiente({ tipo: "bienvenida", motivo: "su primera cita", datos: null });
    return t;
  }

  test("speaks the fixed guion, then sends the «Permitir» link, without the LLM", async () => {
    const t = setupBienvenida();
    const llmCalls = t.llm.calls.length;
    await tickAt(t, "2026-10-19T22:30");

    expect(t.llm.calls).toHaveLength(llmCalls);
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio", "text"]);
    const link = t.whatsapp.outbox[1] as Extract<OutgoingWhatsApp, { kind: "text" }>;
    expect(link.text).toContain(PERMITIR);

    const [audio, text] = t.app.store.mensajesSalientes();
    expect(audio!.kind).toBe("audio");
    expect(findFigures(audio!.text!)).toEqual([]);
    expect(audio!.text).toContain("Hola Patricia");
    expect(audio!.text).toContain("Te voy a decir Patricia; si prefieres otro nombre, escríbemelo");
    expect(audio!.text).not.toContain("¿Cómo te gusta que te llamen?");
    expect(audio!.text).toContain("diez y media");
    expect(audio!.text).toContain("otra voz");
    expect(t.app.store.citaOn("2026-10-19")?.mensajeSalienteId).toBe(audio!.id);
    expect(text).toMatchObject({ kind: "text", text: link.text, durationSeconds: null, whatsappId: "wamid-2" });
    expect(t.app.store.decisions().some((d) => d.motivo.startsWith("salió el enlace «Permitir»"))).toBe(true);

    await tickAt(t, "2026-10-19T22:31");
    await tickAt(t, "2026-10-19T22:45");
    expect(t.whatsapp.outbox).toHaveLength(2);
    expect(t.voice.calls).toHaveLength(1);
  });

  test("confirms the nombre Luna has at send time", async () => {
    const t = setupBienvenida();
    t.app.store.updatePatricia({ nombre: "Pati" });
    await tickAt(t, "2026-10-19T22:30");

    const [audio] = t.app.store.mensajesSalientes();
    expect(audio!.text).toContain("Hola Pati, soy Luna");
    expect(audio!.text).toContain("Te voy a decir Pati; si prefieres otro nombre, escríbemelo");
  });

  test("a failed link is retried alone on the next tick, and recorded once", async () => {
    const t = setupBienvenida();
    t.whatsapp.failNextTexts = 2;
    await tickAt(t, "2026-10-19T22:30");
    await tickAt(t, "2026-10-19T22:31");

    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);
    const failures = t.app.store.decisions().filter((d) => d.motivo.startsWith("no salió el enlace"));
    expect(failures).toHaveLength(1);

    await tickAt(t, "2026-10-19T22:32");
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio", "text"]);
    expect(t.voice.calls).toHaveLength(1);
    expect(t.app.store.mensajesSalientes().map((m) => m.kind)).toEqual(["audio", "text"]);

    await tickAt(t, "2026-10-19T22:33");
    expect(t.whatsapp.outbox).toHaveLength(2);
  });

  test("a restart between the audio and the link still sends the link that night", async () => {
    const t = setupBienvenida();
    t.whatsapp.failNextTexts = 1;
    await tickAt(t, "2026-10-19T22:30");
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);

    const restarted = createTestApp({ db: t.db, now: parseSantiago("2026-10-19T22:45") });
    await restarted.app.tick();
    expect(restarted.whatsapp.outbox.map((m) => m.kind)).toEqual(["text"]);
    expect(restarted.voice.calls).toHaveLength(0);
  });

  test("a link still owed when the day ends goes out the next day, without the audio again", async () => {
    const t = setupBienvenida();
    t.whatsapp.failNextTexts = 100;
    await tickAt(t, "2026-10-19T22:30");
    await tickAt(t, "2026-10-19T23:59");
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);

    t.whatsapp.failNextTexts = 0;
    await tickAt(t, "2026-10-20T09:00");
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio", "text"]);
    expect(t.voice.calls).toHaveLength(1);

    await tickAt(t, "2026-10-20T09:01");
    expect(t.whatsapp.outbox).toHaveLength(2);
  });
});
