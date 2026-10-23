import { describe, expect, test } from "bun:test";
import { montoEnPalabras, montoEnPantalla } from "./montos";

const acceptance: [number, string, string][] = [
  [0, "cero pesos", "$0"],
  [100, "cien pesos", "$100"],
  [1000, "mil pesos", "$1.000"],
  [8100, "ocho mil cien pesos", "$8.100"],
  [41900, "cuarenta y un mil novecientos pesos", "$41.900"],
  [50000, "cincuenta mil pesos", "$50.000"],
  [162700, "ciento sesenta y dos mil setecientos pesos", "$162.700"],
  [1000000, "un millón de pesos", "$1.000.000"],
];

const extra: [number, string][] = [
  [1, "un peso"],
  [21, "veintiún pesos"],
  [101, "ciento un pesos"],
  [115, "ciento quince pesos"],
  [1001, "mil un pesos"],
  [21000, "veintiún mil pesos"],
  [451000, "cuatrocientos cincuenta y un mil pesos"],
  [1200000, "un millón doscientos mil pesos"],
  [2000000, "dos millones de pesos"],
  [16, "dieciséis pesos"],
  [22, "veintidós pesos"],
  [23, "veintitrés pesos"],
  [26, "veintiséis pesos"],
  [35, "treinta y cinco pesos"],
  [500, "quinientos pesos"],
  [1000000000, "mil millones de pesos"],
  [999999999999, "novecientos noventa y nueve mil novecientos noventa y nueve millones novecientos noventa y nueve mil novecientos noventa y nueve pesos"],
];

const invalid = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000_000];

describe("montoEnPalabras", () => {
  test.each(acceptance)("says %p as %p", (pesos, words) => {
    expect(montoEnPalabras(pesos)).toBe(words);
  });

  test.each(extra)("says %p as %p", (pesos, words) => {
    expect(montoEnPalabras(pesos)).toBe(words);
  });

  test.each(invalid)("rejects %p", (pesos) => {
    expect(() => montoEnPalabras(pesos)).toThrow(RangeError);
  });
});

describe("montoEnPantalla", () => {
  test.each(acceptance)("shows %p as %p", (pesos, _words, screen) => {
    expect(montoEnPantalla(pesos)).toBe(screen);
  });

  test.each(invalid)("rejects %p", (pesos) => {
    expect(() => montoEnPantalla(pesos)).toThrow(RangeError);
  });
});
