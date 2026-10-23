import { describe, expect, test } from "bun:test";
import { anthropicLlm, HAIKU_MODEL } from "./anthropic";

type FetchHandler = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

function mockFetch(handler: FetchHandler): typeof fetch {
  return handler as typeof fetch;
}

describe("anthropicLlm", () => {
  test("sends the messages request and joins text blocks", async () => {
    let capturedUrl: string | Request | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const llm = anthropicLlm({
      apiKey: "test-api-key",
      fetch: mockFetch(async (input, init) => {
        capturedUrl = input;
        capturedInit = init;
        return Response.json({
          content: [
            { type: "text", text: "Hola " },
            { type: "tool_use", id: "tool_1" },
            { type: "text", text: "Patricia" },
          ],
        });
      }),
    });

    await expect(llm.complete({ system: "Clasifica", prompt: "Hola" })).resolves.toBe("Hola Patricia");
    expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      "x-api-key": "test-api-key",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: "Clasifica",
      messages: [{ role: "user", content: "Hola" }],
    });
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  test("omits the system field when it is undefined", async () => {
    let capturedBody = "";
    const llm = anthropicLlm({
      apiKey: "test-api-key",
      model: "claude-test-model",
      timeoutMs: 1_000,
      fetch: mockFetch(async (_input, init) => {
        capturedBody = init?.body as string;
        return Response.json({ content: [{ type: "text", text: "Respuesta" }] });
      }),
    });

    await expect(llm.complete({ prompt: "Hola" })).resolves.toBe("Respuesta");
    expect(JSON.parse(capturedBody)).toEqual({
      model: "claude-test-model",
      max_tokens: 256,
      messages: [{ role: "user", content: "Hola" }],
    });
  });

  test("a request's model and max tokens override the client's defaults", async () => {
    let capturedBody = "";
    const llm = anthropicLlm({
      apiKey: "test-api-key",
      model: "claude-test-model",
      fetch: mockFetch(async (_input, init) => {
        capturedBody = init?.body as string;
        return Response.json({ content: [{ type: "text", text: "{}" }] });
      }),
    });

    await llm.complete({ model: "claude-opus-5-5", prompt: "Lee", maxTokens: 1024, timeoutMs: 60_000 });
    expect(JSON.parse(capturedBody)).toMatchObject({ model: "claude-opus-5-5", max_tokens: 1024 });
  });

  test("includes an HTTP error status and body without exposing the API key", async () => {
    const apiKey = "secret-test-key";
    const llm = anthropicLlm({
      apiKey,
      fetch: mockFetch(async () => new Response(`invalid key ${apiKey}`, { status: 401 })),
    });

    let error: Error | undefined;
    try {
      await llm.complete({ prompt: "Hola" });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("401");
    expect(error?.message).toContain("invalid key");
    expect(error?.message).not.toContain(apiKey);
  });

  test("sends each image as a base64 block before the prompt", async () => {
    let capturedBody = "";
    const llm = anthropicLlm({
      apiKey: "test-api-key",
      fetch: mockFetch(async (_input, init) => {
        capturedBody = init?.body as string;
        return Response.json({ content: [{ type: "text", text: "Leído" }] });
      }),
    });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    await expect(
      llm.complete({ prompt: "Foto", images: [{ bytes, mimeType: "Image/JPEG; charset=binary" }] }),
    ).resolves.toBe("Leído");
    expect(JSON.parse(capturedBody).messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4A==" } },
          { type: "text", text: "Foto" },
        ],
      },
    ]);
  });

  test("keeps the plain string content when the images are empty", async () => {
    let capturedBody = "";
    const llm = anthropicLlm({
      apiKey: "test-api-key",
      fetch: mockFetch(async (_input, init) => {
        capturedBody = init?.body as string;
        return Response.json({ content: [{ type: "text", text: "Respuesta" }] });
      }),
    });

    await llm.complete({ prompt: "Hola", images: [] });
    expect(JSON.parse(capturedBody).messages).toEqual([{ role: "user", content: "Hola" }]);
  });
});
