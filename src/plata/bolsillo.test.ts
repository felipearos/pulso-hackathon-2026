import { describe, expect, test } from "bun:test";
import { nombreDeBolsillo, respuestaBolsilloDe } from "./bolsillo";

describe("respuestaBolsilloDe", () => {
  test.each([
    ["👍", "si"],
    ["👍🏻", "si"],
    ["👍️🏽👍", "si"],
    ["👎", "no"],
    ["👎🏿", "no"],
    ["👎️🏻👎", "no"],
    ["🤷", "no-sabe"],
    ["🤷🏽", "no-sabe"],
    ["🤷‍♀️", "no-sabe"],
    ["🤷🏽‍♂️", "no-sabe"],
    ["🤷‍♀️🤷🏻‍♂️", "no-sabe"],
    ["  SÍ  ", "si"],
    ["si!!!", "si"],
    ["No.", "no"],
    ["  NO SÉ?  ", "no-sabe"],
    ["no se!", "no-sabe"],
    ["nose.", "no-sabe"],
    ["Ni idea,", "no-sabe"],
  ] as const)("reads %p as %p", (text, answer) => {
    expect(respuestaBolsilloDe(text)).toBe(answer);
  });

  test.each(["", "quizás", "sí, no", "👍 sí", "no sé todavía", "🤷🏻♀️", "👌"])(
    "does not read %p as a direct answer",
    (text) => {
      expect(respuestaBolsilloDe(text)).toBeNull();
    },
  );
});

describe("nombreDeBolsillo", () => {
  test.each([
    ["  «Para   la mamá»  ", "Para la mamá"],
    ['"Plata   para 2027"', "Plata para 2027"],
    ["'Mis cuotas'", "Mis cuotas"],
    ["Gastos\tde\nla casa", "Gastos de la casa"],
    ["  Mi ahorro  ", "Mi ahorro"],
    ["123", "123"],
  ] as const)("cleans %p to %p", (text, name) => {
    expect(nombreDeBolsillo(text)).toBe(name);
  });

  test.each([
    "",
    "   ",
    "«   »",
    "👍🏽",
    "💰💸",
    "---",
    "a".repeat(41),
  ])("rejects unusable name %p", (text) => {
    expect(nombreDeBolsillo(text)).toBeNull();
  });
});
