import { expect, test } from "bun:test";
import { claudeCliLlm } from "./claude-cli";

// Opt-in: it spends the logged-in Claude Code account, and the gate must not wait on it.
const enabled = process.env.CLAUDE_CLI_SMOKE === "1";

test.skipIf(!enabled)(
  "the claude CLI answers a short prompt with no tools",
  async () => {
    const llm = claudeCliLlm({ command: process.env.CLAUDE_BIN });

    const reply = await llm.complete({ system: "Responde solo con un número.", prompt: "¿Cuánto es dos más dos?" });

    expect(reply).toContain("4");
  },
  60_000,
);
