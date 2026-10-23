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
        // Anthropic takes the bare type: `image/jpeg; charset=…` is refused.
        media_type: (image.mimeType.split(";")[0] ?? "").trim().toLowerCase(),
        data: Buffer.from(image.bytes).toString("base64"),
      },
    })),
    { type: "text", text: prompt },
  ];
}

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
        model: request.model ?? options.model ?? HAIKU_MODEL,
        max_tokens: request.maxTokens ?? 256,
        ...(request.system === undefined ? {} : { system: request.system }),
        messages: [{ role: "user", content: userContent(request.prompt, request.images) }],
      };
      const response = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs ?? 10_000),
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
