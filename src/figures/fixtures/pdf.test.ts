import { describe, expect, test } from "bun:test";
import { extractText, getDocumentProxy } from "unpdf";
import { normalizeRut } from "../../mail/rut";
import { PATRICIA_RUT_FICTICIO } from "../../patricia/fixtures";
import { ESTADO_DE_CUENTA_8_TEXTO } from "./estado-de-cuenta-8";
import { ESTADO_DE_CUENTA_9_TEXTO } from "./estado-de-cuenta-9";
import { ESTADO_DE_CUENTA_TIENDA_TEXTO } from "./estado-de-cuenta-tienda";
import { estadoDeCuenta8PdfCifrado } from "./pdf";

/** The bank's rule: «tu RUT sin guión ni dígito verificador». */
const CLAVE = PATRICIA_RUT_FICTICIO.split("-")[0]!;

describe("Patricia's fictional RUT", () => {
  test("is a valid RUT in its normalized form", () => {
    expect(normalizeRut(PATRICIA_RUT_FICTICIO)).toBe(PATRICIA_RUT_FICTICIO);
  });

  test("never appears among the estados de cuenta's digits", () => {
    for (const texto of [ESTADO_DE_CUENTA_8_TEXTO, ESTADO_DE_CUENTA_9_TEXTO, ESTADO_DE_CUENTA_TIENDA_TEXTO]) {
      expect(texto.replace(/\D/g, "")).not.toContain(CLAVE);
    }
  });
});

describe("the encrypted estado de cuenta 8", () => {
  test("does not open without a password", async () => {
    const error = await getDocumentProxy(estadoDeCuenta8PdfCifrado(CLAVE)).catch((e: unknown) => e);
    expect((error as Error).name).toBe("PasswordException");
  });

  test("does not open with a wrong password", async () => {
    const error = await getDocumentProxy(estadoDeCuenta8PdfCifrado(CLAVE), { password: "12345678" }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("PasswordException");
  });

  test("opens with the clave derived from the RUT and reads like the plain one", async () => {
    const pdf = await getDocumentProxy(estadoDeCuenta8PdfCifrado(CLAVE), { password: CLAVE });
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("MONTO MÍNIMO A PAGAR");
    expect(text).toContain("$41.900");
  });

  test("is reproducible", () => {
    expect(estadoDeCuenta8PdfCifrado(CLAVE)).toEqual(estadoDeCuenta8PdfCifrado(CLAVE));
  });
});
