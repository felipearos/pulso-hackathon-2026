import { describe, expect, test } from "bun:test";
import { HAIKU_MODEL } from "./anthropic";
import { claudeCliLlm, type RunCli } from "./claude-cli";

type Run = { args: string[]; stdin: string; timeoutMs: number };

function fakeRun(stdout: string, exitCode = 0, stderr = "", timedOut = false): { run: RunCli; runs: Run[] } {
  const runs: Run[] = [];
  return {
    runs,
    run: async (args, stdin, timeoutMs) => {
      runs.push({ args, stdin, timeoutMs });
      return { stdout, stderr, exitCode, timedOut };
    },
  };
}

const success = [
  JSON.stringify({ type: "system", subtype: "init" }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hola Patricia" }] } }),
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hola Patricia" }),
].join("\n");

describe("claudeCliLlm", () => {
  test("runs claude headless with no tools, settings or session, and returns the result", async () => {
    const { run, runs } = fakeRun(success);
    const llm = claudeCliLlm({ run });

    await expect(llm.complete({ system: "Clasifica", prompt: "Hola" })).resolves.toBe("Hola Patricia");

    expect(runs).toHaveLength(1);
    expect(runs[0]!.args).toEqual([
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
      "--system-prompt",
      "Clasifica",
      "--model",
      HAIKU_MODEL,
    ]);
    expect(JSON.parse(runs[0]!.stdin)).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Hola" }] },
    });
    expect(runs[0]!.timeoutMs).toBe(30_000);
  });

  test("passes the request model and timeout, and leaves out an unset system prompt", async () => {
    const { run, runs } = fakeRun(success);
    const llm = claudeCliLlm({ run });

    await llm.complete({ model: "claude-sonnet-5-5", prompt: "Hola", timeoutMs: 5_000 });

    expect(runs[0]!.args).not.toContain("--system-prompt");
    expect(runs[0]!.args.slice(-2)).toEqual(["--model", "claude-sonnet-5-5"]);
    expect(runs[0]!.timeoutMs).toBe(5_000);
  });

  test("sends each image before the prompt, with the bare media type", async () => {
    const { run, runs } = fakeRun(success);
    const llm = claudeCliLlm({ run });

    await llm.complete({
      prompt: "¿Cuánto es el mínimo?",
      images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "Image/JPEG; charset=binary" }],
    });

    expect(JSON.parse(runs[0]!.stdin).message.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AQID" } },
      { type: "text", text: "¿Cuánto es el mínimo?" },
    ]);
  });

  test("rejects when claude exits with an error", async () => {
    const { run } = fakeRun("", 1, "Not logged in");
    const llm = claudeCliLlm({ run });

    await expect(llm.complete({ prompt: "Hola" })).rejects.toThrow("claude CLI exited with 1: Not logged in");
  });

  test("rejects when the result is an error", async () => {
    const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Usage limit reached" });
    const llm = claudeCliLlm({ run: fakeRun(stdout).run });

    await expect(llm.complete({ prompt: "Hola" })).rejects.toThrow("claude CLI failed: Usage limit reached");
  });

  test("rejects naming the timeout when the call ran out of time", async () => {
    const llm = claudeCliLlm({ run: fakeRun("", 143, "", true).run });

    await expect(llm.complete({ prompt: "Hola", timeoutMs: 8_000 })).rejects.toThrow("claude CLI timed out after 8000 ms");
  });

  test("skips a line that is not JSON and still finds the result", async () => {
    const llm = claudeCliLlm({ run: fakeRun(`{"type":"assist\n${success}`).run });

    await expect(llm.complete({ prompt: "Hola" })).resolves.toBe("Hola Patricia");
  });

  test("rejects when there is no result line", async () => {
    const llm = claudeCliLlm({ run: fakeRun(JSON.stringify({ type: "system" })).run });

    await expect(llm.complete({ prompt: "Hola" })).rejects.toThrow("claude CLI returned no result");
  });
});
