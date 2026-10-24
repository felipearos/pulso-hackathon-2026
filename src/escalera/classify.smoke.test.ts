import { expect, test } from "bun:test";
import { claudeCliLlm } from "../claude-cli";
import { classifyIntencion } from "./classify";

// Spends the logged-in claude account, so the gate runs it only on request: CLAUDE_CLI_SMOKE=1.
const enabled = process.env.CLAUDE_CLI_SMOKE === "1";

test.skipIf(!enabled)(
  "classifies clear messages with Claude Haiku",
  async () => {
    const llm = claudeCliLlm({ command: process.env.CLAUDE_BIN });

    expect(await classifyIntencion("Me compré un televisor en 12 cuotas", llm)).toEqual({
      kind: "installmentPurchase",
    });
    expect(await classifyIntencion("¿Por qué me dices esto?", llm)).toEqual({ kind: "askWhy" });
  },
  20_000,
);
