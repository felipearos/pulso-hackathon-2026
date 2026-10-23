import { describe, expect, test } from "bun:test";
import { HAIKU_MODEL } from "../anthropic";
import { FakeLlm } from "../fakes";
import { SAMPLE_MAILS } from "./samples";
import { classifyByLlm } from "./llm-classify";

describe("classifyByLlm", () => {
  const classifications = [
    ["banco", "S1"],
    ["tienda", "S2"],
    ["pedido", "S3"],
    ["cuotas", "S4"],
    ["pago", "S5"],
    ["publicidad", "ignorado"],
    ["falso", "S7"],
  ] as const;

  test.each(classifications)("classifies the %s sample as %s", async (kind, tipo) => {
    const mail = SAMPLE_MAILS[kind];
    const llm = new FakeLlm([[mail.subject, `{"tipo":"${tipo}","confianza":0.82}`]]);

    expect(await classifyByLlm(mail, llm)).toEqual({
      tipo,
      motivo: expect.stringContaining("(confianza 0,82)."),
    });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.model).toBe(HAIKU_MODEL);
  });

  test("parses fenced JSON with surrounding text", async () => {
    const mail = SAMPLE_MAILS.banco;
    const llm = new FakeLlm([[mail.subject, 'Resultado:\n```json\n{"tipo":"S1","confianza":0.91}\n```']]);

    expect((await classifyByLlm(mail, llm))?.tipo).toBe("S1");
  });

  test.each([
    ["garbage", "esto no es JSON"],
    ["unknown tipo", '{"tipo":"promo","confianza":0.9}'],
    ["missing confidence", '{"tipo":"S1"}'],
    ["string confidence", '{"tipo":"S1","confianza":"0.9"}'],
    ["confidence below zero", '{"tipo":"S1","confianza":-0.1}'],
    ["confidence above one", '{"tipo":"S1","confianza":1.1}'],
    ["low confidence", '{"tipo":"S1","confianza":0.59}'],
  ])("returns null for %s", async (_name, reply) => {
    const mail = SAMPLE_MAILS.banco;
    const llm = new FakeLlm([[mail.subject, reply]]);

    expect(await classifyByLlm(mail, llm)).toBeNull();
  });

  test("returns null when the LLM throws", async () => {
    expect(await classifyByLlm(SAMPLE_MAILS.banco, new FakeLlm([]))).toBeNull();
  });

  test("returns null when the LLM does not resolve before the timeout", async () => {
    const neverResolvingLlm = { complete: () => new Promise<string>(() => {}) };

    expect(await classifyByLlm(SAMPLE_MAILS.banco, neverResolvingLlm, { timeoutMs: 5 })).toBeNull();
  });

  test("includes link hostnames without paths and truncates text to 2000 characters", async () => {
    const llm = new FakeLlm([["Revisa esto", '{"tipo":"S1","confianza":0.8}']]);
    const longText = "x".repeat(2001);

    await classifyByLlm(
      {
        from: "Banco Andino <avisos@bancoandino.example>",
        subject: "Revisa esto",
        text: longText,
        links: ["https://bancoandino.example/private/estado?token=secreto"],
      },
      llm,
    );

    const prompt = llm.calls[0]?.prompt ?? "";
    expect(prompt).toContain("bancoandino.example");
    expect(prompt).not.toContain("/private/estado");
    expect(prompt).not.toContain("token=secreto");
    expect(prompt).toContain("x".repeat(2000));
    expect(prompt).not.toContain("x".repeat(2001));
  });

  test("redacts URLs embedded in the text", async () => {
    const mail = { ...SAMPLE_MAILS.banco, text: "Abre https://bancoandino.example/secreto para seguir." };
    const llm = new FakeLlm([[mail.subject, '{"tipo":"S1","confianza":0.8}']]);

    await classifyByLlm(mail, llm);

    expect(llm.calls[0]?.prompt).toContain("[link omitido]");
    expect(llm.calls[0]?.prompt).not.toContain("/secreto");
  });
});
