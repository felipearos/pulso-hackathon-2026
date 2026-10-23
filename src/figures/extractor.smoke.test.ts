import { expect, test } from "bun:test";
import { anthropicLlm } from "../anthropic";
import { extractCifras } from "./extractor";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "./fixtures/estado-de-cuenta-8";

// Calls the real Claude API, so the gate runs it only on request: LLM_SMOKE=1 with a key.
const apiKey = process.env.LLM_SMOKE === "1" ? process.env.ANTHROPIC_API_KEY : undefined;

test.skipIf(!apiKey)(
  "extracts the figures of estado de cuenta 8 with Claude Opus",
  async () => {
    if (!apiKey) return;
    const llm = anthropicLlm({ apiKey });

    const cifras = await extractCifras(ESTADO_DE_CUENTA_8_TEXTO, llm);

    expect(cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
  },
  90_000,
);
