import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import { FakeLlm } from "../fakes";
import { createTestApp, type TestApp } from "../testing";
import { confirmacionBienvenida, leerRespuestasBienvenida, tomarNombreDelPerfil } from "./bienvenida-respuestas";

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

  test("refusing «otra voz» keeps the voz she has", async () => {
    const llm = new FakeLlm([]);
    expect(await leerRespuestasBienvenida("Me gusta esta, no quiero otra voz", llm)).toEqual({});
    expect(await leerRespuestasBienvenida("Así está bien, sin otra voz", llm)).toEqual({});
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
  const PERFIL = "tomó el nombre de su perfil de WhatsApp";

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

  function fromPerfil(t: TestApp) {
    return t.app.store.decisions().filter((d) => d.motivo.startsWith(PERFIL));
  }

  test("her profile name is kept as her nombre and recorded as a decision", () => {
    const t = setup();

    expect(tomarNombreDelPerfil(t.app.store, "Pati")).toBe("Pati");

    expect(t.app.store.getPatricia().nombre).toBe("Pati");
    expect(fromPerfil(t)).toHaveLength(1);
    expect(fromPerfil(t)[0]).toMatchObject({
      tipo: "mensaje",
      motivo: `${PERFIL}: Pati`,
      datos: { perfilNombre: "Pati", nombre: "Pati" },
    });
  });

  test("only the first word of her profile name is kept", () => {
    const t = setup();
    expect(tomarNombreDelPerfil(t.app.store, "  María José Soto ")).toBe("María");
    expect(t.app.store.getPatricia().nombre).toBe("María");
  });

  test.each([["😀Pati"], ["Pati2"], ["Pati!"], [""], ["   "], [undefined]])(
    "profile name %p leaves the nombre she had",
    (perfilNombre) => {
      const t = setup();
      const before = t.app.store.getPatricia().nombre;

      expect(tomarNombreDelPerfil(t.app.store, perfilNombre)).toBeNull();

      expect(t.app.store.getPatricia().nombre).toBe(before);
      expect(fromPerfil(t)).toHaveLength(0);
    },
  );

  test("once she said her nombre in the bienvenida, a profile name never overwrites it", async () => {
    const t = setup();
    await tickAt(t, "2026-10-19T22:30");
    await t.app.receiveMensaje({ text: MESSAGE, whatsappId: "w1" });

    expect(tomarNombreDelPerfil(t.app.store, "Patricia Soto")).toBeNull();

    expect(t.app.store.getPatricia().nombre).toBe("Paty");
    expect(fromPerfil(t)).toHaveLength(0);
  });

  test("her answer to the bienvenida overwrites the profile name", async () => {
    const t = setup();
    tomarNombreDelPerfil(t.app.store, "Pati");
    await tickAt(t, "2026-10-19T22:30");

    await t.app.receiveMensaje({ text: MESSAGE, whatsappId: "w1" });

    expect(t.app.store.getPatricia().nombre).toBe("Paty");
  });

  test("the same profile name twice writes one decision", () => {
    const t = setup();
    tomarNombreDelPerfil(t.app.store, "Pati");
    expect(tomarNombreDelPerfil(t.app.store, "Pati Soto")).toBeNull();
    expect(fromPerfil(t)).toHaveLength(1);
  });
});

describe("confirmacionBienvenida", () => {
  test("names her and the next cita's day and hour", () => {
    expect(confirmacionBienvenida("Patricia", { fecha: "2026-10-22", tipo: "jueves", hora: "22:30" })).toBe(
      "Anotado, Patricia. Nos hablamos el jueves a las 22:30.",
    );
  });

  test("names no day when there is no next cita to name", () => {
    expect(confirmacionBienvenida("Patricia", null)).toBe("Anotado, Patricia. Gracias por contarme.");
    expect(confirmacionBienvenida("Patricia", { fecha: "2026-11-02", tipo: "graduada", hora: "22:30" })).toBe(
      "Anotado, Patricia. Gracias por contarme.",
    );
  });
});
