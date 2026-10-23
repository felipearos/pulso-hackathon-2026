import { expect, test } from "bun:test";
import { anthropicLlm } from "../anthropic";
import { extractCifras } from "./extractor";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "./fixtures/estado-de-cuenta-8";
import { ESTADO_DE_CUENTA_9_CIFRAS, ESTADO_DE_CUENTA_9_TEXTO } from "./fixtures/estado-de-cuenta-9";
import { ESTADO_DE_CUENTA_TIENDA_CIFRAS, ESTADO_DE_CUENTA_TIENDA_TEXTO } from "./fixtures/estado-de-cuenta-tienda";

// Calls the real Claude API, so the gate runs it only on request: LLM_SMOKE=1 with a key.
const apiKey = process.env.LLM_SMOKE === "1" ? process.env.ANTHROPIC_API_KEY : undefined;

test.skipIf(!apiKey).each([
  ["estado de cuenta 8", ESTADO_DE_CUENTA_8_TEXTO, ESTADO_DE_CUENTA_8_CIFRAS],
  ["estado de cuenta 9", ESTADO_DE_CUENTA_9_TEXTO, ESTADO_DE_CUENTA_9_CIFRAS],
  ["the tienda's estado de cuenta", ESTADO_DE_CUENTA_TIENDA_TEXTO, ESTADO_DE_CUENTA_TIENDA_CIFRAS],
] as const)(
  "extracts the figures of %s with Claude Opus",
  async (_name, texto, expected) => {
    if (!apiKey) return;
    const llm = anthropicLlm({ apiKey });

    const cifras = await extractCifras(texto, llm);

    expect(cifras).toEqual(expected);
  },
  90_000,
);
