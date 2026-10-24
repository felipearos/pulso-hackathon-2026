import { expect, test } from "bun:test";
import { claudeCliLlm } from "../claude-cli";
import { classifyByLlm } from "./llm-classify";

// Spends the logged-in claude account, so the gate runs it only on request: CLAUDE_CLI_SMOKE=1.
const enabled = process.env.CLAUDE_CLI_SMOKE === "1";

test.skipIf(!enabled)(
  "classifies ambiguous bank mail and catalogue promotion with Claude Haiku",
  async () => {
    const llm = claudeCliLlm({ command: process.env.CLAUDE_BIN });

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
        from: "Catálogo Ejemplo <hola@catalogoejemplo.example>",
        subject: "Llegó el catálogo de primavera",
        text: "Conoce los nuevos productos, ofertas y descuentos de esta temporada.",
        links: [],
      },
      llm,
    )).toMatchObject({ tipo: "ignorado" });
  },
  20_000,
);
