import { describe, expect, test } from "bun:test";
import { extractText, getDocumentProxy } from "unpdf";
import { PATRICIA_RUT_FICTICIO } from "../patricia/fixtures";
import { linkDelEstadoDeCuenta } from "./estado-de-cuenta";
import { senderDomain } from "./senders";
import { SAMPLE_MAILS } from "./samples";
import { suspiciousReason } from "./suspicious";

describe("SAMPLE_MAILS", () => {
  test.each(Object.entries(SAMPLE_MAILS))("%s uses only example domains", (_kind, mail) => {
    const fromDomain = senderDomain(mail.from);
    expect(fromDomain).not.toBeNull();
    expect(fromDomain).toMatch(/\.example$/);

    for (const link of mail.links) {
      expect(new URL(link).hostname).toMatch(/\.example$/);
    }
  });

  test("only the falso sample is suspicious", () => {
    expect(suspiciousReason(SAMPLE_MAILS.falso)).not.toBeNull();

    for (const [kind, mail] of Object.entries(SAMPLE_MAILS)) {
      if (kind === "falso") continue;
      expect(suspiciousReason(mail)).toBeNull();
    }
  });

  test("the banco sample is a notice with no figures and no links", () => {
    const { text } = SAMPLE_MAILS.banco;
    expect(text).not.toContain("$");
    expect(text).not.toMatch(/https?:\/\/|www\./);
    expect(text).toContain("RUT sin guión ni dígito verificador");
    expect(SAMPLE_MAILS.banco.links).toEqual([]);
  });

  test("the banco sample attaches estado de cuenta 8 encrypted with her RUT", async () => {
    const adjuntos = SAMPLE_MAILS.banco.adjuntos ?? [];
    expect(adjuntos).toHaveLength(1);
    const [adjunto] = adjuntos;
    expect(adjunto!.nombre).toMatch(/^EECC_TARJETA_\d+\.pdf$/);
    expect(adjunto!.mimeType).toBe("application/octet-stream");

    const error = await getDocumentProxy(adjunto!.bytes.slice()).catch((e: unknown) => e);
    expect((error as Error).name).toBe("PasswordException");

    const clave = PATRICIA_RUT_FICTICIO.split("-")[0]!;
    const pdf = await getDocumentProxy(adjunto!.bytes.slice(), { password: clave });
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("MONTO MÍNIMO A PAGAR");
    expect(text).toContain("$41.900");
  });

  test("the tienda sample links to its own estado de cuenta", () => {
    expect(linkDelEstadoDeCuenta(SAMPLE_MAILS.tienda)?.href).toBe(SAMPLE_MAILS.tienda.links[0]);
  });
});
