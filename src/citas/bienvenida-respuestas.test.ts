import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import { FakeLlm } from "../fakes";
import { createTestApp, type TestApp } from "../testing";
import { leerRespuestasBienvenida } from "./bienvenida-respuestas";

const ANSWER = "Respuesta de Patricia a la bienvenida";
const MOTIVO = "guardó lo que respondió a la bienvenida: nombre, hora y voz";
const MESSAGE = "Dime Paty. Sí, a esa hora me acomoda, y quiero otra voz";

describe("leerRespuestasBienvenida", () => {
  test("a name and a yes to the night hour keep the name and 22:30", async () => {
    const llm = new FakeLlm([[ANSWER, '{"nombre":" Paty ","hora":null,"acomoda":true}']]);
    expect(await leerRespuestasBienvenida("Dime Paty, sí me acomoda", llm)).toEqual({ nombre: "Paty", hora: "22:30" });
  });

  test("another hour is kept as she said it", async () => {
    const llm = new FakeLlm([[ANSWER, '{"nombre":null,"hora":"21:00","acomoda":false}']]);
    expect(await leerRespuestasBienvenida("mejor a las 21:00", llm)).toEqual({ hora: "21:00" });
  });

  test("an hour in the madrugada is dropped", async () => {
    const llm = new FakeLlm([[ANSWER, '{"nombre":null,"hora":"03:00","acomoda":null}']]);
    expect(await leerRespuestasBienvenida("a las 3 de la mañana", llm)).toEqual({});
  });

  test("«otra voz» is read even when the LLM fails", async () => {
    const llm = new FakeLlm([]);
    expect(await leerRespuestasBienvenida("Quiero OTRA VOZ, por favor", llm)).toEqual({ voz: "otra" });
  });

  test("an unreadable reply keeps nothing", async () => {
    const llm = new FakeLlm([[ANSWER, "no sé {nombre: Paty"]]);
    expect(await leerRespuestasBienvenida("Dime Paty", llm)).toEqual({});
  });

  test("a name with digits is dropped", async () => {
    const llm = new FakeLlm([[ANSWER, '{"nombre":"Paty123","hora":null,"acomoda":null}']]);
    expect(await leerRespuestasBienvenida("Dime Paty123", llm)).toEqual({});
  });
});

describe("app.receiveMensaje and the bienvenida", () => {
  function setup(): TestApp {
    const t = createTestApp({
      now: parseSantiago("2026-10-19T09:00"),
      llm: [
        [ANSWER, '{"nombre":"Paty","hora":null,"acomoda":true}'],
        ["Mensaje de Patricia", '{"intencion":"accepted"}'],
        ["Escribe el guion", "Hola, Patricia. Estás al día, no estás en DICOM. Este mes el pago mínimo es $41.900."],
        ["Acorta este guion", "Estás al día. El pago mínimo es $41.900."],
        ["", "OK"],
      ],
    });
    // Estado de cuenta 8 from the case, as in `src/citas/envio.test.ts`.
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
    t.app.store.addPendiente({ tipo: "bienvenida", motivo: "su primera cita", datos: null });
    return t;
  }

  async function tickAt({ app, clock }: TestApp, at: string): Promise<void> {
    clock.set(parseSantiago(at));
    await app.tick();
  }

  function answers(t: TestApp) {
    const { nombre, hora, voz } = t.app.store.getPatricia();
    return { nombre, hora, voz };
  }

  function saved(t: TestApp) {
    return t.app.store.decisions().filter((d) => d.motivo === MOTIVO);
  }

  test("her answer to the bienvenida keeps her name, hour and voz", async () => {
    const t = setup();
    await tickAt(t, "2026-10-19T22:30");

    await t.app.receiveMensaje({ text: MESSAGE, whatsappId: "w1" });

    expect(t.app.store.getPatricia()).toMatchObject({ nombre: "Paty", hora: "22:30", voz: "otra" });
    expect(saved(t)).toHaveLength(1);
    expect(saved(t)[0]!.tipo).toBe("mensaje");
    expect(t.app.store.mensajesEntrantes().at(-1)?.text).toBe(MESSAGE);
  });

  test("before the bienvenida goes out, the same message changes nothing on her", async () => {
    const t = setup();
    const before = answers(t);

    await t.app.receiveMensaje({ text: MESSAGE, whatsappId: "w1" });

    expect(answers(t)).toEqual(before);
    expect(saved(t)).toHaveLength(0);
    expect(t.llm.calls.some((c) => c.prompt.includes(ANSWER))).toBe(false);
  });

  test("once the next cita went out, a message no longer touches her", async () => {
    const t = setup();
    await tickAt(t, "2026-10-19T22:30");
    await tickAt(t, "2026-10-22T22:30");
    expect(t.app.store.citaOn("2026-10-22")?.mensajeSalienteId).not.toBeNull();
    const before = answers(t);

    await t.app.receiveMensaje({ text: MESSAGE, whatsappId: "w1" });

    expect(answers(t)).toEqual(before);
    expect(saved(t)).toHaveLength(0);
  });
});
