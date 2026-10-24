import { expect, test } from "bun:test";
import { claudeCliLlm } from "../claude-cli";
import { extractCifras } from "./extractor";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "./fixtures/estado-de-cuenta-8";
import { ESTADO_DE_CUENTA_9_CIFRAS, ESTADO_DE_CUENTA_9_TEXTO } from "./fixtures/estado-de-cuenta-9";
import { ESTADO_DE_CUENTA_TIENDA_CIFRAS, ESTADO_DE_CUENTA_TIENDA_TEXTO } from "./fixtures/estado-de-cuenta-tienda";

// Spends the logged-in claude account, so the gate runs it only on request: CLAUDE_CLI_SMOKE=1.
const enabled = process.env.CLAUDE_CLI_SMOKE === "1";

test.skipIf(!enabled).each([
  ["estado de cuenta 8", ESTADO_DE_CUENTA_8_TEXTO, ESTADO_DE_CUENTA_8_CIFRAS],
  ["estado de cuenta 9", ESTADO_DE_CUENTA_9_TEXTO, ESTADO_DE_CUENTA_9_CIFRAS],
  ["the tienda's estado de cuenta", ESTADO_DE_CUENTA_TIENDA_TEXTO, ESTADO_DE_CUENTA_TIENDA_CIFRAS],
] as const)(
  "extracts the figures of %s with Claude Opus",
  async (_name, texto, expected) => {
    const llm = claudeCliLlm({ command: process.env.CLAUDE_BIN });

    const cifras = await extractCifras(texto, llm);

    expect(cifras).toEqual(expected);
  },
  90_000,
);
