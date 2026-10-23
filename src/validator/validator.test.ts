import { describe, expect, test } from "bun:test";
import { FakeLlm } from "../fakes";
import { SAFE_TEMPLATE, TONE_REVIEW_MODEL, checkText, findFigures, validateText } from "./validator";
import type { Rejection, ValidatorDecision } from "./validator";

describe("findFigures", () => {
  const rows: Array<[string, number[]]> = [
    ["Pagaste $41.900 este mes.", [41900]],
    ["Pagaste 41.900 este mes.", [41900]],
    ["El cupo es $1.250.000.", [1250000]],
    ["La tasa es 3,1% al mes.", [3.1]],
    ["La tasa es 3,1 % al mes.", [3.1]],
    ["Llevas 59 días.", [59]],
    ["Quedas libre en 17 meses.", [17]],
    ["Vence el 15/11.", [15, 11]],
    ["En 2027 quedas libre.", [2027]],
    ["Hoy no hay números.", []],
  ];

  for (const [text, expected] of rows) {
    test(text, () => {
      expect(findFigures(text)).toEqual(expected);
    });
  }
});

describe("checkText", () => {
  const rows: Array<[string, string, number[], Rejection["kind"][]]> = [
    ["invented figure", "Te quedan $50.000 por pagar.", [41900], ["figure-not-allowed"]],
    ["two figures", "Pagaste $41.900 y quedan 17 meses.", [41900, 17], ["too-many-figures"]],
    ["same figure twice passes", "Pagaste $41.900; sí, $41.900.", [41900], []],
    ["deberías", "Deberías mirar tu cuenta.", [], ["forbidden-word"]],
    ["urgente", "Esto es URGENTE.", [], ["forbidden-word"]],
    ["tu deuda as blame", "Tu deuda sigue ahí.", [], ["forbidden-word"]],
    ["neutral deuda passes", "La deuda baja este mes.", [], []],
    ["reassuring negation passes", "No tienes que hacer nada hoy, y no es tu culpa.", [], []],
    ["culpa alone is still blame", "La culpa es de las cuotas.", [], ["forbidden-word"]],
    ["calm text with one allowed figure", "Este mes pagaste $41.900. Bien hecho, con calma.", [41900], []],
    ["text with no figure", "Hoy te escribo solo para saludarte.", [], []],
  ];

  for (const [name, text, allowed, kinds] of rows) {
    test(name, () => {
      expect(checkText(text, allowed).map((r) => r.kind)).toEqual(kinds);
    });
  }

  test("a pair from one motor result passes with maxFigures 2, a third figure does not", () => {
    expect(checkText("Son 17 meses pagando $50.000.", [17, 50000], 2)).toEqual([]);
    expect(checkText("Son 17 meses pagando $50.000, y $41.900 el mínimo.", [17, 50000, 41900], 2).map((r) => r.kind)).toEqual([
      "too-many-figures",
    ]);
  });

  test("forbidden word is matched without accents", () => {
    expect(checkText("Deberias revisar.", [])).toEqual([{ kind: "forbidden-word", word: "deberías" }]);
  });

  test("safe template passes with no figures", () => {
    expect(checkText(SAFE_TEMPLATE, [])).toEqual([]);
  });
});

describe("validateText", () => {
  const good = "Este mes pagaste $41.900. Vamos con calma.";
  const calmRedraft = "Pagaste $41.900 este mes, y eso cuenta.";

  test("draft passes: no redraft, one tone review with Haiku", async () => {
    const llm = new FakeLlm([[/.*/, "OK"]]);
    const redrafts: Rejection[][] = [];
    const result = await validateText({
      draft: good,
      allowedFigures: [41900],
      llm,
      redraft: async (rejections) => {
        redrafts.push(rejections);
        return calmRedraft;
      },
      safeTemplate: SAFE_TEMPLATE,
      recordDecision: () => {
        throw new Error("no decision expected");
      },
    });
    expect(result).toEqual({ text: good, source: "draft" });
    expect(redrafts).toHaveLength(0);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.model).toBe(TONE_REVIEW_MODEL);
    expect(llm.calls[0]?.model).toBe("claude-haiku-5-5");
    expect(llm.calls[0]?.prompt).toContain(good);
  });

  test("draft rejected by code, redraft passes", async () => {
    const llm = new FakeLlm([[/.*/, "OK"]]);
    const redrafts: Rejection[][] = [];
    const result = await validateText({
      draft: "Deberías pagar $50.000 urgente.",
      allowedFigures: [41900],
      llm,
      redraft: async (rejections) => {
        redrafts.push(rejections);
        return calmRedraft;
      },
      safeTemplate: SAFE_TEMPLATE,
      recordDecision: () => {
        throw new Error("no decision expected");
      },
    });
    expect(result).toEqual({ text: calmRedraft, source: "redraft" });
    expect(redrafts).toHaveLength(1);
    expect(redrafts[0]?.map((r) => r.kind)).toEqual(["figure-not-allowed", "forbidden-word", "forbidden-word"]);
    // The draft never reached the LLM: only the redraft was reviewed.
    expect(llm.calls).toHaveLength(1);
  });

  test("draft rejected by tone, redraft passes", async () => {
    const llm = new FakeLlm([
      [good, "NO: suena frío"],
      [calmRedraft, "OK"],
    ]);
    const redrafts: Rejection[][] = [];
    const result = await validateText({
      draft: good,
      allowedFigures: [41900],
      llm,
      redraft: async (rejections) => {
        redrafts.push(rejections);
        return calmRedraft;
      },
      safeTemplate: SAFE_TEMPLATE,
      recordDecision: () => {
        throw new Error("no decision expected");
      },
    });
    expect(result).toEqual({ text: calmRedraft, source: "redraft" });
    expect(redrafts).toEqual([[{ kind: "tone", reason: "NO: suena frío" }]]);
    expect(llm.calls).toHaveLength(2);
  });

  test("both rejected: safe template goes out and a decision is recorded", async () => {
    const llm = new FakeLlm([[/.*/, "NO: tiene reproche"]]);
    const draft = "Tienes que pagar ya mismo.";
    const redraft = "Este mes pagaste $41.900.";
    const redrafts: Rejection[][] = [];
    const decisions: ValidatorDecision[] = [];
    const result = await validateText({
      draft,
      allowedFigures: [41900],
      llm,
      redraft: async (rejections) => {
        redrafts.push(rejections);
        return redraft;
      },
      safeTemplate: SAFE_TEMPLATE,
      recordDecision: (d) => decisions.push(d),
    });
    expect(result).toEqual({ text: SAFE_TEMPLATE, source: "safe-template" });
    expect(redrafts).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.kind).toBe("safe-template");
    expect(decisions[0]?.input.draft).toBe(draft);
    expect(decisions[0]?.input.redraft).toBe(redraft);
    expect(decisions[0]?.reason).toContain("plantilla segura");
  });

  test("tone reply must be exactly OK", async () => {
    const llm = new FakeLlm([[/.*/, "OKAY, pero suena frío"]]);
    const decisions: ValidatorDecision[] = [];
    const result = await validateText({
      draft: good,
      allowedFigures: [41900],
      llm,
      redraft: async () => good,
      safeTemplate: SAFE_TEMPLATE,
      recordDecision: (d) => decisions.push(d),
    });
    expect(result.source).toBe("safe-template");
    expect(decisions).toHaveLength(1);
  });

  test("a failing tone review falls back to the safe template with a decision", async () => {
    const llm = new FakeLlm([]);
    const decisions: ValidatorDecision[] = [];
    const result = await validateText({
      draft: good,
      allowedFigures: [41900],
      llm,
      redraft: async () => good,
      safeTemplate: SAFE_TEMPLATE,
      recordDecision: (d) => decisions.push(d),
    });
    expect(result).toEqual({ text: SAFE_TEMPLATE, source: "safe-template" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.input.redraft).toBeNull();
    expect(decisions[0]?.input.error).toContain("FakeLlm has no reply");
    expect(decisions[0]?.reason).toContain("No se pudo revisar");
  });

  test("a failing redraft falls back to the safe template with a decision", async () => {
    const llm = new FakeLlm([[/.*/, "NO: suena frío"]]);
    const decisions: ValidatorDecision[] = [];
    const result = await validateText({
      draft: good,
      allowedFigures: [41900],
      llm,
      redraft: async () => {
        throw new Error("redraft timed out");
      },
      safeTemplate: SAFE_TEMPLATE,
      recordDecision: (d) => decisions.push(d),
    });
    expect(result.source).toBe("safe-template");
    expect(decisions[0]?.input.rejections).toEqual([{ kind: "tone", reason: "NO: suena frío" }]);
    expect(decisions[0]?.input.error).toBe("redraft timed out");
  });

  test("a safe template with a figure is a programming error", async () => {
    const llm = new FakeLlm([[/.*/, "OK"]]);
    await expect(
      validateText({
        draft: good,
        allowedFigures: [41900],
        llm,
        redraft: async () => good,
        safeTemplate: "Te quedan 17 meses.",
        recordDecision: () => {},
      }),
    ).rejects.toThrow();
  });
});
