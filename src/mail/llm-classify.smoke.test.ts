import { expect, test } from "bun:test";
import { anthropicLlm } from "../anthropic";
import { classifyByLlm } from "./llm-classify";

// Calls the real Claude API, so the gate runs it only on request: LLM_SMOKE=1 with a key.
const apiKey = process.env.LLM_SMOKE === "1" ? process.env.ANTHROPIC_API_KEY : undefined;

test.skipIf(!apiKey)(
  "classifies ambiguous bank mail and catalogue promotion with Claude Haiku",
  async () => {
    if (!apiKey) return;
    const llm = anthropicLlm({ apiKey });

    expect(await classifyByLlm(
      {
        from: "Banco Ficticio <avisos@bancoficticio.example>",
        subject: "Resumen mensual de tu tarjeta",
        text: "El monto facturado para octubre es $89.000 y el pago mínimo es $12.000. Revisa los movimientos del mes.",
        links: [],
      },
      llm,
    )).toMatchObject({ tipo: "S1" });

    expect(await classifyByLlm(
      {
        from: "Catálogo Aurora <hola@catalogoaurora.example>",
        subject: "Llegó el catálogo de primavera",
        text: "Conoce los nuevos productos, ofertas y descuentos de esta temporada.",
        links: [],
      },
      llm,
    )).toMatchObject({ tipo: "ignorado" });
  },
  20_000,
);
