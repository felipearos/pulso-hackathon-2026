import { describe, expect, test } from "bun:test";
import { FakeLlm } from "../fakes";
import type { Llm } from "../ports";
import { type CifrasExtraidas, EXTRACTOR_MODEL, extractCifras } from "./extractor";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "./fixtures/estado-de-cuenta-8";

const REPLY_8 = {
  pagoMinimo: 41900,
  totalFacturado: 650000,
  cupo: 800000,
  tasaMensualPorcentaje: 3.1,
  fechaVencimiento: "2026-11-05",
  fechaCierre: "2026-10-15",
  mora: 0,
  pagosAnteriores: [37000, 37700, 38500, 39200, 40000, 40700, 41300].map((monto) => ({ monto, aTiempo: true })),
  comprasEnCuotas: [
    { descripcion: "Refrigerador", cuotaActual: 10, cuotasTotales: 12 },
    { descripcion: "Zapatillas", cuotaActual: 3, cuotasTotales: 3 },
  ],
};

function llmReplying(reply: string): FakeLlm {
  return new FakeLlm([[/[\s\S]/, reply]]);
}

function extractWith(reply: object): Promise<CifrasExtraidas | null> {
  return extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llmReplying(JSON.stringify(reply)));
}

describe("extractCifras", () => {
  test("reads estado de cuenta 8 into its expected figures", async () => {
    const llm = new FakeLlm([["MONTO MÍNIMO A PAGAR", JSON.stringify(REPLY_8)]]);

    expect(await extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llm)).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
  });

  test("asks the extractor model with the estado de cuenta text", async () => {
    const llm = llmReplying(JSON.stringify(REPLY_8));

    await extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llm);

    expect(llm.calls).toHaveLength(1);
    const request = llm.calls[0];
    expect(request?.model).toBe(EXTRACTOR_MODEL);
    expect(request?.prompt).toContain(ESTADO_DE_CUENTA_8_TEXTO);
    expect(request?.system).toContain("JSON");
    expect(request?.timeoutMs).toBe(60_000);
  });

  test("passes a custom timeout to the llm", async () => {
    const llm = llmReplying(JSON.stringify(REPLY_8));

    await extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llm, { timeoutMs: 5_000 });

    expect(llm.calls[0]?.timeoutMs).toBe(5_000);
  });

  test("a wrong-typed field becomes null and keeps the others", async () => {
    const cifras = await extractWith({ ...REPLY_8, pagoMinimo: "41.900" });

    expect(cifras).toEqual({ ...ESTADO_DE_CUENTA_8_CIFRAS, pagoMinimo: null });
  });

  test("negative or fractional pesos become null", async () => {
    const cifras = await extractWith({ ...REPLY_8, totalFacturado: -650000, cupo: 800000.5 });

    expect(cifras).toEqual({ ...ESTADO_DE_CUENTA_8_CIFRAS, totalFacturado: null, cupo: null });
  });

  test("an invalid date becomes null", async () => {
    const cifras = await extractWith({ ...REPLY_8, fechaVencimiento: "2026-02-30", fechaCierre: "15/10/2026" });

    expect(cifras).toEqual({ ...ESTADO_DE_CUENTA_8_CIFRAS, fechaVencimiento: null, fechaCierre: null });
  });

  test("accepts the 29th of February only in a leap year", async () => {
    expect((await extractWith({ ...REPLY_8, fechaCierre: "2028-02-29" }))?.fechaCierre).toBe("2028-02-29");
    expect((await extractWith({ ...REPLY_8, fechaCierre: "2026-02-29" }))?.fechaCierre).toBeNull();
  });

  test("missing and null fields become null", async () => {
    const { mora: _mora, ...withoutMora } = REPLY_8;
    const cifras = await extractWith({ ...withoutMora, cupo: null });

    expect(cifras).toEqual({ ...ESTADO_DE_CUENTA_8_CIFRAS, mora: null, cupo: null });
  });

  test("a list with a malformed item becomes null", async () => {
    const cifras = await extractWith({
      ...REPLY_8,
      pagosAnteriores: [{ monto: 37000, aTiempo: true }, { monto: 37700 }],
      comprasEnCuotas: [{ descripcion: "Refrigerador", cuotaActual: 13, cuotasTotales: 12 }],
    });

    expect(cifras).toEqual({ ...ESTADO_DE_CUENTA_8_CIFRAS, pagosAnteriores: null, comprasEnCuotas: null });
  });

  test("converts the printed monthly percent into a fraction", async () => {
    expect((await extractWith({ ...REPLY_8, tasaMensualPorcentaje: 2.95 }))?.tasaMensual).toBe(0.0295);
    expect((await extractWith({ ...REPLY_8, tasaMensualPorcentaje: 0 }))?.tasaMensual).toBeNull();
    expect((await extractWith({ ...REPLY_8, tasaMensualPorcentaje: 100 }))?.tasaMensual).toBeNull();
    expect((await extractWith({ ...REPLY_8, tasaMensualPorcentaje: "3,10" }))?.tasaMensual).toBeNull();
  });

  test("accepts JSON inside a Markdown fence", async () => {
    const llm = llmReplying("```json\n" + JSON.stringify(REPLY_8) + "\n```");

    expect(await extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llm)).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
  });

  test("a reply that is not JSON is a failed read, not figures not found", async () => {
    const llm = llmReplying("No pude leer el estado de cuenta.");

    expect(await extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llm)).toBeNull();
  });

  test("a failing llm is a failed read instead of throwing", async () => {
    const llm: Llm = {
      complete: async () => {
        throw new Error("timeout");
      },
    };

    expect(await extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llm)).toBeNull();
  });
});
