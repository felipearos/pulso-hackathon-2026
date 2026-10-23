import type { Llm, LlmRequest } from "./ports";

export const HAIKU_MODEL = "claude-haiku-5-5";

/** Creates a Claude messages client. */
export function anthropicLlm(options: {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Llm {
  const fetchFn = options.fetch ?? fetch;

  return {
    async complete(request: LlmRequest): Promise<string> {
      const body = {
        model: options.model ?? HAIKU_MODEL,
        max_tokens: 256,
        ...(request.system === undefined ? {} : { system: request.system }),
        messages: [{ role: "user", content: request.prompt }],
      };
      const response = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });

      if (!response.ok) {
        const responseBody = (await response.text()).replaceAll(options.apiKey, "[redacted]");
        throw new Error(`Anthropic API request failed with status ${response.status}: ${responseBody}`);
      }

      const result = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      return result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
    },
  };
}
