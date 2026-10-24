import { describe, expect, test } from "bun:test";
import { digitoVerificador, normalizeRut } from "./rut";

describe("digitoVerificador", () => {
  test("computes módulo 11, with 0 for remainder 11 and K for remainder 10", () => {
    expect(digitoVerificador("12345678")).toBe("5");
    expect(digitoVerificador("10000004")).toBe("0");
    expect(digitoVerificador("10000013")).toBe("K");
  });
});

describe("normalizeRut", () => {
  test("accepts a RUT with dots and hyphen", () => {
    expect(normalizeRut("12.345.678-5")).toBe("12345678-5");
  });

  test("accepts a RUT without dots or hyphen, with spaces around", () => {
    expect(normalizeRut(" 123456785 ")).toBe("12345678-5");
    expect(normalizeRut("12 345 678 - 5")).toBe("12345678-5");
  });

  test("accepts a lowercase or uppercase k and returns uppercase K", () => {
    expect(normalizeRut("10.000.013-k")).toBe("10000013-K");
    expect(normalizeRut("10000013K")).toBe("10000013-K");
  });

  test("accepts a dígito verificador 0", () => {
    expect(normalizeRut("10.000.004-0")).toBe("10000004-0");
  });

  test("accepts a seven-digit cuerpo", () => {
    expect(normalizeRut("7.654.321-6")).toBe("7654321-6");
  });

  test("rejects a wrong dígito verificador", () => {
    expect(normalizeRut("12.345.678-4")).toBeNull();
    expect(normalizeRut("10000013-0")).toBeNull();
    expect(normalizeRut("10000004-K")).toBeNull();
  });

  test("rejects letters, empty input and absurd lengths", () => {
    expect(normalizeRut("12.34a.678-5")).toBeNull();
    expect(normalizeRut("abc")).toBeNull();
    expect(normalizeRut("")).toBeNull();
    expect(normalizeRut("   ")).toBeNull();
    expect(normalizeRut("-")).toBeNull();
    expect(normalizeRut("1-9")).toBeNull();
    expect(normalizeRut("1234567890123-1")).toBeNull();
  });
});
