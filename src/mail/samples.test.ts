import { describe, expect, test } from "bun:test";
import { extractText, getDocumentProxy } from "unpdf";
import { PATRICIA_RUT_FICTICIO } from "../patricia/fixtures";
import { linkDelEstadoDeCuenta } from "./estado-de-cuenta";
import { allowedSender, senderDomain } from "./senders";
import { FakeWeb } from "../fakes";
import { documentText } from "../web/documento";
import { SAMPLE_MAILS, withSampleDocuments } from "./samples";
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
    expect(suspiciousReason(SAMPLE_MAILS.falso, { senderAllowed: allowedSender(SAMPLE_MAILS.falso.from) !== null })).not.toBeNull();

    for (const [kind, mail] of Object.entries(SAMPLE_MAILS)) {
      if (kind === "falso") continue;
      expect(suspiciousReason(mail, { senderAllowed: allowedSender(mail.from) !== null })).toBeNull();
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

describe("withSampleDocuments", () => {
  const link = SAMPLE_MAILS.tienda.links[0]!;
  const domains = ["tiendaplaza.example"];

  test("serves the tienda sample's estado de cuenta without going to the web", async () => {
    const web = new FakeWeb();
    const document = await withSampleDocuments(web).fetchDocument(link, domains);

    expect(web.calls).toEqual([]);
    expect(document.contentType).toBe("application/pdf");
    expect(await documentText(document)).toContain("Tienda Plaza");
  });

  test("a sample link outside the allowed domains goes to the web, which refuses it", async () => {
    const web = new FakeWeb();
    await expect(withSampleDocuments(web).fetchDocument(link, ["bancoficticio.example"])).rejects.toThrow("refused");
    expect(web.calls).toEqual([link]);
  });

  test("any other link goes to the web", async () => {
    const other = "https://www.tiendaplaza.example/cuenta/noviembre";
    const web = new FakeWeb({ [other]: "<p>noviembre</p>" });
    const document = await withSampleDocuments(web).fetchDocument(other, domains);

    expect(web.calls).toEqual([other]);
    expect(new TextDecoder().decode(document.body)).toBe("<p>noviembre</p>");
  });
});
