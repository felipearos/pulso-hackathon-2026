import { describe, expect, test } from "bun:test";
import { FakeLlm } from "../fakes";
import { angustiaDeRespuesta, classifyIntencion, pideQueLeCuente } from "./classify";
import type { Intencion } from "./policy";

describe("classifyIntencion", () => {
  const rows: Array<[string, string, string, Intencion]> = [
    ["listened", "Ya escuché el audio, gracias", '{"intencion":"listened"}', { kind: "listened" }],
    ["accepted", "Sí, lo voy a intentar mañana", '{"intencion":"accepted"}', { kind: "accepted" }],
    ["minimum", "Este mes pago el mínimo no más", '{"intencion":"minimum"}', { kind: "minimum" }],
    ["angustia", "Me siento muy angustiada con esto", '{"intencion":"angustia","valor":4}', { kind: "angustia", value: 4 }],
    ["doesNotWantToSee", "No quiero mirar la cuenta todavía", '{"intencion":"doesNotWantToSee"}', { kind: "doesNotWantToSee" }],
    ["pause", "Luna, por favor hagamos una pausa", '{"intencion":"pause"}', { kind: "pause" }],
    ["hello", "Hola Luna, ¿cómo estás?", '{"intencion":"hello"}', { kind: "hello" }],
    ["askWhy", "¿Por qué me dices esto?", '{"intencion":"askWhy"}', { kind: "askWhy" }],
    ["askWhatRead", "¿Qué leíste de mi estado de cuenta?", '{"intencion":"askWhatRead"}', { kind: "askWhatRead" }],
    [
      "installmentPurchase",
      "Me compré unas zapatillas en 6 cuotas",
      '{"intencion":"installmentPurchase"}',
      { kind: "installmentPurchase" },
    ],
    [
      "crisis",
      "Siento que todos estarían mejor sin mí",
      '{"intencion":"crisis"}',
      { kind: "crisis" },
    ],
    ["other", "Hoy fui a dejar unos remedios", '{"intencion":"other"}', { kind: "other" }],
  ];

  test.each(rows)("classifies %s", async (_name, message, reply, expected) => {
    const llm = new FakeLlm([[message, reply]]);

    expect(await classifyIntencion(message, llm)).toEqual(expected);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.prompt).toContain(message);
  });

  test("extracts the first JSON object from a longer reply", async () => {
    const llm = new FakeLlm([["ya escuché", 'Respuesta: ```json\n{"intencion":"listened"}\n``` listo']]);

    expect(await classifyIntencion("ya escuché", llm)).toEqual({ kind: "listened" });
  });

  test("recognizes requests for Luna to tell her what the estado de cuenta says", () => {
    for (const message of ["Cuéntamelo tú", "mejor tú dime", "te lo cuento yo", "prefiero que me lo cuentes"]) {
      expect(pideQueLeCuente(message)).toBe(true);
    }
    for (const message of ["lo abro yo", "mejor tuve que pagar"]) {
      expect(pideQueLeCuente(message)).toBe(false);
    }
  });

  test("reads an expected request for Luna to tell her without the LLM", async () => {
    const llm = new FakeLlm([["Cuéntamelo tú", '{"intencion":"other"}']]);

    expect(await classifyIntencion("Cuéntamelo tú", llm, { cuentoEsperado: true })).toEqual({ kind: "listened" });
    expect(llm.calls).toHaveLength(0);
  });

  test("sends a request for Luna to tell her to the LLM when it is not expected", async () => {
    const llm = new FakeLlm([["Cuéntamelo tú", '{"intencion":"other"}']]);

    expect(await classifyIntencion("Cuéntamelo tú", llm)).toEqual({ kind: "other" });
    expect(llm.calls).toHaveLength(1);
  });

  test("crisis takes precedence over an expected request for Luna to tell her", async () => {
    const llm = new FakeLlm([]);

    expect(await classifyIntencion("no quiero vivir, cuéntamelo tú", llm, { cuentoEsperado: true })).toEqual({
      kind: "crisis",
    });
    expect(llm.calls).toHaveLength(0);
  });

  test.each([
    "Ya no doy más",
    "NO QUIERO VIVIR",
    "No quiero seguir viviendo.",
    "No puedo más, de verdad",
    "A veces quiero desaparecer",
    "Sería mejor no despertar",
    "Quiero desaparecer de este mundo",
    "Pienso en quitarme la vida de una vez",
    "Quiero terminar con todo de una vez",
  ]) (
    "returns crisis for keyword phrase %s without calling the LLM",
    async (message) => {
      const llm = new FakeLlm([]);

      expect(await classifyIntencion(message, llm)).toEqual({ kind: "crisis" });
      expect(llm.calls).toHaveLength(0);
    },
  );

  test("returns crisis before an LLM that throws or never resolves", async () => {
    const throwingLlm = new FakeLlm([]);
    const neverResolvingLlm = { complete: () => new Promise<string>(() => {}) };

    expect(await classifyIntencion("Ya no doy más", throwingLlm)).toEqual({ kind: "crisis" });
    expect(throwingLlm.calls).toHaveLength(0);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      classifyIntencion("NO QUIERO VIVIR", neverResolvingLlm),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 100);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    expect(result).toEqual({ kind: "crisis" });
  });

  test.each([
    ["👍", { kind: "accepted" }],
    ["👍🏽", { kind: "accepted" }],
    ["👌", { kind: "listened" }],
    ["👌👌", { kind: "listened" }],
  ] as Array<[string, Intencion]>) ("classifies emoji %s without calling the LLM", async (message, expected) => {
    const llm = new FakeLlm([]);

    expect(await classifyIntencion(` ${message} `, llm)).toEqual(expected);
    expect(llm.calls).toHaveLength(0);
  });

  test("returns other when the LLM throws or times out", async () => {
    const throwingLlm = new FakeLlm([]);
    const neverResolvingLlm = { complete: () => new Promise<string>(() => {}) };

    expect(await classifyIntencion("No sé qué decir", throwingLlm)).toEqual({ kind: "other" });
    expect(throwingLlm.calls).toHaveLength(1);
    expect(await classifyIntencion("No sé qué decir", neverResolvingLlm, { timeoutMs: 5 })).toEqual({ kind: "other" });
  });

  test.each([
    ["garbage", "esto no es JSON"],
    ["unknown kind", '{"intencion":"compró"}'],
    ["angustia above range", '{"intencion":"angustia","valor":9}'],
    ["angustia without integer", '{"intencion":"angustia","valor":2.5}'],
  ])("returns other for %s", async (_name, reply) => {
    const llm = new FakeLlm([["mensaje", reply]]);

    expect(await classifyIntencion("mensaje", llm)).toEqual({ kind: "other" });
  });

  test.each([
    ["Este mes no puedo más que el mínimo", '{"intencion":"minimum"}', { kind: "minimum" }],
    ["No doy más de 20 mil al mes", '{"intencion":"other"}', { kind: "other" }],
    ["Ojalá la deuda pudiera desaparecer", '{"intencion":"other"}', { kind: "other" }],
  ] satisfies Array<[string, string, Intencion]>)("leaves money talk %s to the LLM", async (message, reply, expected) => {
    const llm = new FakeLlm([[message, reply]]);

    expect(await classifyIntencion(message, llm)).toEqual(expected);
    expect(llm.calls).toHaveLength(1);
  });
});

describe("angustiaDeRespuesta", () => {
  test.each([
    ["😌", 1],
    ["🙂", 2],
    [" 😐 ", 3],
    ["😟", 4],
    ["😰\uFE0F", 5],
    ["1️⃣", 1],
    ["3\u20E3", 3],
    ["5️⃣", 5],
    ["2", 2],
    [" 4\n", 4],
    ["😐😴", 3],
    ["😴 😟", 4],
    ["3 🥱", 3],
    ["😣\uFE0F😌", 1],
    ["5️⃣ 😴\uFE0F", 5],
  ] as const)("reads %p as angustia %p", (message, value) => {
    expect(angustiaDeRespuesta(message)).toBe(value);
  });

  test.each(["6", "0", "6️⃣", "😌😰", "3 o 4", "un 3", "😟 la verdad", "", "👍", "😴", "😴🥱", "😐😴🥱", "😴😐😴", "😌 😴 😰", "😐 😴 dormí mal"])("reads %p as no answer", (message) => {
    expect(angustiaDeRespuesta(message)).toBeNull();
  });

  test.each(["😟", "4️⃣", "4"])(
    "classifies %p as angustia 4 without calling the LLM when the angustia is expected",
    async (message) => {
      const llm = new FakeLlm([]);

      expect(await classifyIntencion(message, llm, { angustiaEsperada: true })).toEqual({ kind: "angustia", value: 4 });
      expect(llm.calls).toHaveLength(0);
    },
  );

  test("asks the LLM about a 😟 when the angustia is not expected", async () => {
    const llm = new FakeLlm([["😟", '{"intencion":"other"}']]);

    expect(await classifyIntencion("😟", llm)).toEqual({ kind: "other" });
    expect(llm.calls).toHaveLength(1);
  });

  test("sends a mixed answer like «3 o 4» to the LLM", async () => {
    const llm = new FakeLlm([["3 o 4", '{"intencion":"angustia","valor":3}']]);

    expect(await classifyIntencion("3 o 4", llm, { angustiaEsperada: true })).toEqual({ kind: "angustia", value: 3 });
    expect(llm.calls).toHaveLength(1);
  });
});
