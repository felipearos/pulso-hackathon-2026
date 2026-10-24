import { tmpdir } from "node:os";
import type { Llm, LlmImage, LlmRequest } from "./ports";

export const HAIKU_MODEL = "claude-haiku-5-5";

/** The user message content: the plain prompt, or each image before the prompt. */
function userContent(prompt: string, images: readonly LlmImage[] | undefined) {
  if (!images || images.length === 0) return prompt;
  return [
    ...images.map((image) => ({
      type: "image",
      source: {
        type: "base64",
        // Claude takes the bare type: `image/jpeg; charset=…` is refused.
        media_type: (image.mimeType.split(";")[0] ?? "").trim().toLowerCase(),
        data: Buffer.from(image.bytes).toString("base64"),
      },
    })),
    { type: "text", text: prompt },
  ];
}

export type CliResult = { stdout: string; stderr: string; exitCode: number; timedOut?: boolean };

/** The CLI starts a process per call: a few seconds more than the API. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Runs the claude binary with these arguments and stdin, killed after `timeoutMs`. */
export type RunCli = (args: string[], stdin: string, timeoutMs: number) => Promise<CliResult>;

/**
 * Runs it from the temp directory, so no CLAUDE.md from the live checkout
 * reaches the prompt.
 */
function spawnCli(command: string): RunCli {
  return async (args, stdin, timeoutMs) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const child = Bun.spawn([command, ...args], {
      cwd: tmpdir(),
      stdin: new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
      signal,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode, timedOut: signal.aborted };
  };
}

type CliEvent = { type?: string; is_error?: boolean; result?: string };

/** One stream-json line; anything else, like a line cut short by a kill, is skipped. */
function parseEvent(line: string): CliEvent | undefined {
  try {
    return JSON.parse(line) as CliEvent;
  } catch {
    return undefined;
  }
}

/**
 * Claude through the Claude Code CLI logged in on this machine: the only way the
 * app reaches Claude, so it spends that account and needs no API key. Plain completion: no tools, settings, MCP servers, skills or
 * saved session. `maxTokens` has no CLI flag and is ignored.
 */
export function claudeCliLlm(options: { command?: string; run?: RunCli; timeoutMs?: number } = {}): Llm {
  const run = options.run ?? spawnCli(options.command ?? "claude");

  return {
    async complete(request: LlmRequest): Promise<string> {
      const content = userContent(request.prompt, request.images);
      const message = {
        type: "user",
        message: { role: "user", content: typeof content === "string" ? [{ type: "text", text: content }] : content },
      };
      const args = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        ...(request.system === undefined ? [] : ["--system-prompt", request.system]),
        "--model",
        request.model ?? HAIKU_MODEL,
      ];
      const timeoutMs = request.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const { stdout, stderr, exitCode, timedOut } = await run(args, JSON.stringify(message), timeoutMs);

      if (timedOut) throw new Error(`claude CLI timed out after ${timeoutMs} ms`);
      if (exitCode !== 0) throw new Error(`claude CLI exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`);

      const result = stdout
        .split("\n")
        .map(parseEvent)
        .find((event) => event?.type === "result");
      if (!result) throw new Error("claude CLI returned no result");
      if (result.is_error) throw new Error(`claude CLI failed: ${result.result ?? ""}`);
      return result.result ?? "";
    },
  };
}
