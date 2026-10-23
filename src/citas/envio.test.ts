import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import type { OutgoingWhatsApp } from "../ports";
import { createTestApp, type TestApp } from "../testing";
import { findFigures } from "../validator/validator";
import { guionHablado } from "./envio";

const DRAFT_ETAPA_1 = "Hola, Patricia. Estás al día, no estás en DICOM. Este mes el pago mínimo es $41.900.";
const DRAFT_ETAPA_2 = "Estás al día, no estás en DICOM. Hay una salida: 17 meses pagando $50.000, con calma.";
const SHORT = "Estás al día. El pago mínimo es $41.900.";

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

  test("an audio over 45 seconds is rewritten shorter once", async () => {
    const t = setup({ voice: { durations: [52, 30] } });
    await tickAt(t, "2026-10-19T22:30");

    expect(t.voice.calls).toHaveLength(2);
    expect(t.llm.calls.some((c) => c.prompt.includes("Acorta este guion"))).toBe(true);
    expect(audios(t).map((a) => a.durationSeconds)).toEqual([30]);
    expect(t.app.store.mensajesSalientes()[0]!.text).toStartWith(SHORT);
    expect(sentDecision(t)?.datos).toMatchObject({ acortado: true, durationSeconds: 30 });
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
    expect(audio!.text).toContain("¿Cómo te gusta que te llamen?");
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
});
