import { expect, test } from "bun:test";
import { anthropicLlm } from "../anthropic";
import { classifyIntencion } from "./classify";

// Calls the real Claude API, so the gate runs it only on request: LLM_SMOKE=1 with a key.
const apiKey = process.env.LLM_SMOKE === "1" ? process.env.ANTHROPIC_API_KEY : undefined;

test.skipIf(!apiKey)(
  "classifies clear messages with Claude Haiku",
  async () => {
    if (!apiKey) return;
    const llm = anthropicLlm({ apiKey });

    expect(await classifyIntencion("Me compré un televisor en 12 cuotas", llm)).toEqual({
      kind: "installmentPurchase",
    });
    expect(await classifyIntencion("¿Por qué me dices esto?", llm)).toEqual({ kind: "askWhy" });
  },
  20_000,
);
