import { describe, expect, test } from "bun:test";
import { BANCO_ANDINO_MINIMUM_RULE, TIENDA_PLAZA_MINIMUM_RULE } from "../../mail/estado-de-cuenta";
import { documentText } from "../../web/documento";
import type { CifrasExtraidas } from "../extractor";
import { minimumPayment, payoff, type MinimumRule, type Payoff, type Statement } from "../payoff";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "./estado-de-cuenta-8";
import { ESTADO_DE_CUENTA_9_CIFRAS, ESTADO_DE_CUENTA_9_TEXTO } from "./estado-de-cuenta-9";
import { ESTADO_DE_CUENTA_TIENDA_CIFRAS, ESTADO_DE_CUENTA_TIENDA_TEXTO } from "./estado-de-cuenta-tienda";
import { estadoDeCuenta8Pdf, estadoDeCuenta9Pdf, estadoDeCuentaTiendaPdf } from "./pdf";

const FIXTURES = [
  ["estado de cuenta 8", ESTADO_DE_CUENTA_8_TEXTO, ESTADO_DE_CUENTA_8_CIFRAS, BANCO_ANDINO_MINIMUM_RULE, estadoDeCuenta8Pdf],
  ["estado de cuenta 9", ESTADO_DE_CUENTA_9_TEXTO, ESTADO_DE_CUENTA_9_CIFRAS, BANCO_ANDINO_MINIMUM_RULE, estadoDeCuenta9Pdf],
  [
    "the tienda's estado de cuenta",
    ESTADO_DE_CUENTA_TIENDA_TEXTO,
    ESTADO_DE_CUENTA_TIENDA_CIFRAS,
    TIENDA_PLAZA_MINIMUM_RULE,
    estadoDeCuentaTiendaPdf,
  ],
] as const satisfies readonly (readonly [string, string, CifrasExtraidas, MinimumRule, () => Uint8Array])[];

function statement(cifras: CifrasExtraidas, minimumRule: MinimumRule): Statement {
  return { totalBilled: cifras.totalFacturado!, monthlyRate: cifras.tasaMensual!, minimumRule, overdue: cifras.mora! };
}

function months(result: Payoff): number {
  if (!result.ends) throw new Error(`expected the plan to end, got ${result.reason}`);
  return result.months;
}

/** How a figure is printed on the estados de cuenta: «$41.900». */
function impreso(pesos: number): string {
  return `$${pesos.toLocaleString("es-CL")}`;
}

describe.each(FIXTURES)("%s", (_name, texto, cifras, rule, pdf) => {
  test("prints its pago mínimo as its issuer's rule computes it", () => {
    expect(minimumPayment(cifras.totalFacturado!, rule)).toBe(cifras.pagoMinimo!);
  });

  test("prints every amount it says the extractor reads", () => {
    for (const pesos of [cifras.pagoMinimo!, cifras.totalFacturado!, cifras.cupo!, ...cifras.pagosAnteriores!.map((p) => p.monto)]) {
      expect(texto).toContain(impreso(pesos));
    }
  });

  test("its PDF reads back as its text", async () => {
    const read = await documentText({ contentType: "application/pdf", body: pdf() });
    const squash = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(squash(read ?? "")).toBe(squash(texto));
  });

  test("carries no real data: the card and account numbers are zeros", () => {
    expect(texto).not.toMatch(/\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}/);
    expect(texto.match(/N° de tarjeta: .*|Cuenta N°: .*/)?.[0]).toMatch(/^[^1-9]*$/);
    expect(texto).toContain("Documento de ejemplo sin valor comercial.");
  });
});

describe("the case's figures", () => {
  test("estado de cuenta 8: pago mínimo 41.900, about 59 months on the minimum and 17 paying 50.000", () => {
    const figures = payoff(statement(ESTADO_DE_CUENTA_8_CIFRAS, BANCO_ANDINO_MINIMUM_RULE), 50_000, "2026-10-24");

    expect(ESTADO_DE_CUENTA_8_CIFRAS.pagoMinimo).toBe(41_900);
    expect(figures.firstMinimum).toBe(41_900);
    expect(months(figures.onlyMinimum)).toBe(59);
    expect(months(figures.fixedPayment)).toBe(17);
  });

  test("estado de cuenta 9 follows the 8th after paying 50.000: the rest plus a month of interest", () => {
    const eight = ESTADO_DE_CUENTA_8_CIFRAS;
    const nine = ESTADO_DE_CUENTA_9_CIFRAS;

    expect(nine.totalFacturado).toBe(Math.round((eight.totalFacturado! - 50_000) * (1 + eight.tasaMensual!)));
    expect(nine.pagosAnteriores!.at(-1)).toEqual({ monto: 50_000, aTiempo: true });
    expect(nine.fechaCierre).toBe("2026-11-15");
  });
});
