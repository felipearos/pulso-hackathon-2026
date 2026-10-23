import { describe, expect, test } from "bun:test";
import { FakeLlm } from "../fakes";
import { payoff, type Statement } from "../figures/payoff";
import type { Cita, Etapa, EstadoDeCuenta, TipoCita } from "../patricia/entities";
import { ANGUSTIA_EMOJIS, SUENO_EMOJIS } from "../escalera/policy";
import { SAFE_TEMPLATE, findFigures, type ValidatorDecision } from "../validator/validator";
import { REDACTOR_MODEL, allowedFigures, cifraEscrita, decisionDeCita, redactarGuion } from "./redactor";

/** Estado de cuenta 8 from the case, as in `src/figures/payoff.test.ts`. */
const statementEight: Statement = {
  totalBilled: 650_000,
  monthlyRate: 0.031,
  minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
  overdue: 0,
};

const estadoOcho: EstadoDeCuenta = {
  id: 8,
  origen: "banco",
  ciclo: 8,
  fechaCierre: "2026-10-15",
  fechaVencimiento: "2026-11-05",
  cifras: statementEight,
  pagoMinimo: 41_900,
  receivedAt: new Date("2026-10-16T12:00:00Z"),
};

function cita(etapa: Etapa, tipo: TipoCita = "lunes"): Cita {
  return {
    id: 1,
    fecha: "2026-10-26",
    tipo,
    estado: "programada",
    etapa,
    motivo: `cita del ${tipo}, etapa ${etapa}`,
    pendientes: [],
    programadaAt: new Date("2026-10-26T12:00:00Z"),
    mensajeSalienteId: null,
  };
}

const EMOJI_AT_END = /\p{Extended_Pictographic}$/u;

function recorder() {
  const decisions: ValidatorDecision[] = [];
  return { decisions, recordDecision: (d: ValidatorDecision) => decisions.push(d) };
}

describe("decisionDeCita", () => {
  test("etapa 1 carries the pago mínimo of estado de cuenta 8", () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho });
    expect(decision.cifra).toEqual({ kind: "pago-minimo", monto: 41_900 });
    expect(decision.buenaNoticia.regla).toBe("sin-mora");
    expect(decision.motivo).toBe("cita del lunes, etapa 1");
  });

  test("etapa 2 carries la salida: 17 meses pagando 50.000", () => {
    const decision = decisionDeCita({ cita: cita(2), estadoDeCuenta: estadoOcho });
    expect(decision.cifra).toEqual({ kind: "salida", meses: 17, cuota: 50_000 });
  });

  test("a bienvenida carries no cifra", () => {
    expect(decisionDeCita({ cita: cita(1, "bienvenida"), estadoDeCuenta: estadoOcho }).cifra).toBeNull();
    expect(decisionDeCita({ cita: cita(2, "bienvenida-de-vuelta"), estadoDeCuenta: estadoOcho }).cifra).toBeNull();
  });

  test("without an estado de cuenta there is no cifra and the buena noticia is the warm one", () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: null });
    expect(decision.cifra).toBeNull();
    expect(decision.buenaNoticia.regla).toBe("calida");
  });

  test("a compra with one cuota left gives the buena noticia when there is mora", () => {
    const compra = { descripcion: "la compra en Farmacia Ejemplo", cuotasRestantes: 1, mesTermino: "enero" };
    const conMora: EstadoDeCuenta = { ...estadoOcho, cifras: { ...statementEight, overdue: 25_000 } };
    for (const estadoDeCuenta of [conMora, null]) {
      const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta, comprasEnCuotas: [compra] });
      expect(decision.buenaNoticia).toEqual({
        regla: "cuota-termina",
        texto: "a la compra en Farmacia Ejemplo le queda una sola cuota, termina en enero",
      });
      expect(decision.buenaNoticia.texto).not.toMatch(/\d/);
    }
    expect(decisionDeCita({ cita: cita(1), estadoDeCuenta: conMora }).buenaNoticia.regla).toBe("calida");
  });

  test("every pregunta has no digits and ends with an emoji", () => {
    for (const tipo of ["lunes", "jueves", "domingo", "bienvenida", "bienvenida-de-vuelta", "graduada"] as const) {
      const { pregunta } = decisionDeCita({ cita: cita(1, tipo), estadoDeCuenta: estadoOcho });
      expect(pregunta).not.toMatch(/\d/);
      expect(pregunta).toMatch(EMOJI_AT_END);
    }
  });
});

describe("decisionDeCita on domingo", () => {
  test("with a pago recibido this week it celebrates, keeps the cifra and asks the angustia", () => {
    const decision = decisionDeCita({ cita: cita(1, "domingo"), estadoDeCuenta: estadoOcho, pagoRecibido: true });
    expect(decision.buenaNoticia.regla).toBe("pago-recibido");
    expect(decision.buenaNoticia.texto).not.toMatch(/\d/);
    expect(decision.cifra).toEqual(decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho }).cifra);
    expect(decision.pregunta).not.toMatch(/\d/);
    expect(decision.pregunta).not.toContain("💛");
    for (const emoji of ANGUSTIA_EMOJIS) expect(decision.pregunta).toContain(emoji);
  });

  test("without a pago recibido the buena noticia is the usual one and the cifra is a lunes one", () => {
    const decision = decisionDeCita({ cita: cita(2, "domingo"), estadoDeCuenta: estadoOcho, pagoRecibido: false });
    expect(decision.buenaNoticia.regla).toBe("sin-mora");
    expect(decision.cifra).toEqual(decisionDeCita({ cita: cita(2), estadoDeCuenta: estadoOcho }).cifra);
    for (const emoji of ANGUSTIA_EMOJIS) expect(decision.pregunta).toContain(emoji);
  });

  test("the pregunta also asks how she slept, with the sleep emojis and no figure", () => {
    const decision = decisionDeCita({ cita: cita(1, "domingo"), estadoDeCuenta: estadoOcho, pagoRecibido: false });
    for (const emoji of ANGUSTIA_EMOJIS) expect(decision.pregunta).toContain(emoji);
    for (const emoji of SUENO_EMOJIS) expect(decision.pregunta).toContain(emoji);
    expect(decision.pregunta).toContain("cómo dormiste");
    expect(findFigures(decision.pregunta)).toEqual([]);
  });

  test("a pago recibido does not change a lunes cita", () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho, pagoRecibido: true });
    expect(decision.buenaNoticia.regla).toBe("sin-mora");
    expect(decision.cifra).toEqual({ kind: "pago-minimo", monto: 41_900 });
    expect(decision.pregunta).toContain("💛");
  });
});

describe("decisionDeCita with a pago sobre el mínimo", () => {
  test("on domingo the cifra is the fecha en que queda libre from the motor de cifras", () => {
    const domingo = cita(1, "domingo");
    const decision = decisionDeCita({ cita: domingo, estadoDeCuenta: estadoOcho, pagoSobreElMinimo: 50_000 });
    const { fixedPayment, versusMinimum } = payoff(statementEight, 50_000, domingo.fecha);
    if (!fixedPayment.ends || !versusMinimum.comparable) throw new Error("estado 8 pays off at 50.000");
    expect(decision.cifra).toEqual({
      kind: "fecha-libre",
      freeOn: fixedPayment.freeOn,
      mesesAdelantados: versusMinimum.monthsSaved,
    });
    expect(versusMinimum.monthsSaved).toBeGreaterThan(30);
  });

  test("on domingo without it the cifra is the usual one", () => {
    const decision = decisionDeCita({ cita: cita(1, "domingo"), estadoDeCuenta: estadoOcho });
    expect(decision.cifra).toEqual({ kind: "pago-minimo", monto: 41_900 });
  });

  test("a lunes cita ignores it", () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho, pagoSobreElMinimo: 50_000 });
    expect(decision.cifra).toEqual({ kind: "pago-minimo", monto: 41_900 });
  });

  test("a pago that never ends the balance falls back to the usual cifra", () => {
    const decision = decisionDeCita({ cita: cita(2, "domingo"), estadoDeCuenta: estadoOcho, pagoSobreElMinimo: 1_000 });
    expect(decision.cifra).toEqual(decisionDeCita({ cita: cita(2), estadoDeCuenta: estadoOcho }).cifra);
  });
});

describe("figure rules", () => {
  test("pago mínimo allows one figure, la salida a pair, no cifra none", () => {
    expect(allowedFigures({ kind: "pago-minimo", monto: 41_900 })).toEqual({ allowedFigures: [41_900], maxFigures: 1 });
    expect(allowedFigures({ kind: "salida", meses: 17, cuota: 50_000 })).toEqual({
      allowedFigures: [17, 50_000],
      maxFigures: 2,
    });
    expect(allowedFigures(null)).toEqual({ allowedFigures: [], maxFigures: 1 });
  });

  test("la fecha en que queda libre is written as month, year and meses antes, and allows those two", () => {
    const cifra = { kind: "fecha-libre" as const, freeOn: "2028-03-26", mesesAdelantados: 42 };
    expect(cifraEscrita(cifra)).toBe("en marzo de 2028, 42 meses antes");
    expect(allowedFigures(cifra)).toEqual({ allowedFigures: [2028, 42], maxFigures: 2 });
    expect(findFigures(cifraEscrita(cifra))).toEqual([2028, 42]);
    expect(cifraEscrita({ kind: "fecha-libre", freeOn: "2027-12-05", mesesAdelantados: 1 })).toBe(
      "en diciembre de 2027, 1 mes antes",
    );
  });

  test("cifraEscrita writes the figure as the guion must say it", () => {
    expect(cifraEscrita({ kind: "pago-minimo", monto: 41_900 })).toBe("$41.900");
    expect(cifraEscrita({ kind: "salida", meses: 17, cuota: 50_000 })).toBe("17 meses pagando $50.000");
  });
});

describe("redactarGuion", () => {
  test("the LLM is told to call her by her nombre, never a nickname", async () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho });
    const llm = new FakeLlm([
      ["Escribe el guion", "Hola, Paty. Estás al día, no estás en DICOM. Este mes el pago mínimo es $41.900."],
      ["Respóndeme", "OK"],
    ]);
    const { recordDecision } = recorder();

    await redactarGuion({ llm, decision, nombre: "Paty", recordDecision });

    expect(llm.calls[0]!.system).toContain("Si la nombras, dile «Paty», nunca un apodo ni otro nombre.");
  });

  test("etapa 1: the guion carries only the pago mínimo and ends with the pregunta", async () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho });
    const llm = new FakeLlm([
      ["Escribe el guion", "Hola, Patricia. Estás al día, no estás en DICOM. Este mes el pago mínimo es $41.900."],
      ["Respóndeme", "OK"],
    ]);
    const { decisions, recordDecision } = recorder();

    const { guion, source } = await redactarGuion({ llm, decision, nombre: "Patricia", recordDecision });

    expect(source).toBe("draft");
    expect(findFigures(guion)).toEqual([41_900]);
    expect(guion.endsWith(decision.pregunta)).toBe(true);
    expect(guion).toMatch(EMOJI_AT_END);
    expect(llm.calls[0]!.model).toBe(REDACTOR_MODEL);
    expect(llm.calls[0]!.prompt).toContain("$41.900");
    expect(decisions).toEqual([]);
  });

  test("domingo after a pago sobre el mínimo: the guion carries la fecha en que queda libre and passes", async () => {
    const decision = decisionDeCita({
      cita: cita(1, "domingo"),
      estadoDeCuenta: estadoOcho,
      pagoSobreElMinimo: 50_000,
    });
    if (decision.cifra?.kind !== "fecha-libre") throw new Error("expected la fecha en que queda libre");
    const escrita = cifraEscrita(decision.cifra);
    const llm = new FakeLlm([
      ["Escribe el guion", `Hola, Patricia. Estás al día. Pagando como esta semana, quedas libre de la tarjeta ${escrita}.`],
      ["Respóndeme", "OK"],
    ]);
    const { decisions, recordDecision } = recorder();

    const { guion, source } = await redactarGuion({ llm, decision, recordDecision });

    expect(source).toBe("draft");
    expect(guion).toContain(escrita);
    expect(llm.calls[0]!.prompt).toContain(`«${escrita}»`);
    expect(decisions).toEqual([]);
  });

  test("etapa 2: the guion carries la salida and passes", async () => {
    const decision = decisionDeCita({ cita: cita(2), estadoDeCuenta: estadoOcho });
    const llm = new FakeLlm([
      ["Escribe el guion", "Estás al día, no estás en DICOM. Hay una salida: 17 meses pagando $50.000, con calma."],
      ["Respóndeme", "OK"],
    ]);
    const { recordDecision } = recorder();

    const { guion, source } = await redactarGuion({ llm, decision, nombre: "Patricia", recordDecision });

    expect(source).toBe("draft");
    expect(guion).toContain("17 meses pagando $50.000");
    expect(llm.calls[0]!.prompt).toContain("17 meses pagando $50.000");
  });

  test("a draft with two pesos figures is redrafted, then the safe template goes out", async () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho });
    const llm = new FakeLlm([
      ["Escribe el guion", "Estás al día. El pago mínimo es $41.900 y el total es $650.000."],
      ["Reescribe", "Estás al día. Pagaste $30.000 el mes pasado."],
      ["Respóndeme", "OK"],
    ]);
    const { decisions, recordDecision } = recorder();

    const { guion, source } = await redactarGuion({ llm, decision, nombre: "Patricia", recordDecision });

    expect(source).toBe("safe-template");
    expect(guion).toBe(`${SAFE_TEMPLATE} ${decision.pregunta}`);
    expect(decisions).toHaveLength(1);
    const redraftCall = llm.calls.find((c) => c.prompt.startsWith("Reescribe"));
    expect(redraftCall?.model).toBe(REDACTOR_MODEL);
  });

  test("a redraft that passes comes back with the pregunta", async () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho });
    const llm = new FakeLlm([
      ["Escribe el guion", "El pago mínimo es $41.900 y el total es $650.000."],
      ["Reescribe", "Estás al día. El pago mínimo es $41.900."],
      ["Respóndeme", "OK"],
    ]);
    const { recordDecision } = recorder();

    const { guion, source } = await redactarGuion({ llm, decision, nombre: "Patricia", recordDecision });

    expect(source).toBe("redraft");
    expect(guion).toBe(`Estás al día. El pago mínimo es $41.900. ${decision.pregunta}`);
  });

  test("when the draft cannot be written the safe template goes out and the decision is recorded", async () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho });
    const llm = new FakeLlm([]);
    const { decisions, recordDecision } = recorder();

    const { guion, source } = await redactarGuion({ llm, decision, nombre: "Patricia", recordDecision });

    expect(source).toBe("safe-template");
    expect(guion).toBe(`${SAFE_TEMPLATE} ${decision.pregunta}`);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.reason).toContain("No se pudo escribir el guion");
    expect(decisions[0]!.input.draft).toBe("");
    expect(decisions[0]!.input.redraft).toBeNull();
    expect(decisions[0]!.input.error).toBeDefined();
  });

  test("acortar asks to shorten the previous guion and validates the result", async () => {
    const decision = decisionDeCita({ cita: cita(1), estadoDeCuenta: estadoOcho });
    const previous = `Estás al día, no estás en DICOM. Una historia larga y el pago mínimo de $41.900. ${decision.pregunta}`;
    const llm = new FakeLlm([
      ["Acorta este guion", "Estás al día. El pago mínimo es $41.900."],
      ["Respóndeme", "OK"],
    ]);
    const { recordDecision } = recorder();

    const { guion, source } = await redactarGuion({
      llm,
      decision,
      nombre: "Patricia",
      recordDecision,
      acortar: { guion: previous, durationSeconds: 52 },
    });

    expect(llm.calls[0]!.prompt).toContain("52 segundos");
    expect(llm.calls[0]!.model).toBe(REDACTOR_MODEL);
    expect(source).toBe("draft");
    expect(guion).toBe(`Estás al día. El pago mínimo es $41.900. ${decision.pregunta}`);
    expect(llm.calls).toHaveLength(2);
  });
});
