import { describe, expect, test } from "bun:test";
import { documentText } from "./documento";

const encoder = new TextEncoder();

function doc(contentType: string, body: string | Uint8Array) {
  return { contentType, body: typeof body === "string" ? encoder.encode(body) : body };
}

const HTML = `<!DOCTYPE html>
<html>
<head><title>Tienda Plaza</title><style>td { color: red; }</style></head>
<body>
<!-- tracking pixel -->
<script>window.track("estado");</script>
<h1>Estado de cuenta Tienda&nbsp;Plaza</h1>
<p>Informaci&oacute;n de su tarjeta</p>
<table>
<tr><td>Monto total facturado</td><td>$184.000</td></tr>
<tr><td>Monto m&iacute;nimo a pagar</td><td>$18.400</td></tr>
<tr><th>Fecha de vencimiento</th><th>05/11/2026</th></tr>
</table>
<div>P&amp;C &#191;dudas? &#xBF;consultas?</div>
</body>
</html>`;

/** A one-page PDF with Helvetica text, built with a correct xref table. */
function minimalPdf(line: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(pdf);
}

describe("documentText", () => {
  test("reads an HTML estado de cuenta table line by line", async () => {
    const text = await documentText(doc("text/html; charset=utf-8", HTML));
    expect(text).not.toBeNull();
    const lines = text!.split("\n");
    expect(lines.some((l) => l.includes("Monto mínimo a pagar") && l.includes("$18.400"))).toBe(true);
    expect(lines.some((l) => l.includes("Fecha de vencimiento") && l.includes("05/11/2026"))).toBe(true);
    expect(text).toContain("Estado de cuenta Tienda Plaza");
    expect(text).toContain("Información de su tarjeta");
    expect(text).toContain("P&C ¿dudas? ¿consultas?");
    expect(text).not.toContain("track");
    expect(text).not.toContain("color");
    expect(text).not.toContain("tracking pixel");
    expect(text).not.toContain("<");
    expect(text).not.toMatch(/\n\n\n/);
  });

  test("honours a latin1 charset", async () => {
    const body = new Uint8Array([...encoder.encode("<p>Monto m"), 0xed, ...encoder.encode("nimo</p>")]);
    expect(await documentText(doc("TEXT/HTML; Charset=ISO-8859-1", body))).toBe("Monto mínimo");
  });

  test("returns plain text as is, trimmed", async () => {
    expect(await documentText(doc("text/plain", "  Monto mínimo a pagar $18.400\n"))).toBe(
      "Monto mínimo a pagar $18.400",
    );
  });

  test("sniffs HTML when the type is missing", async () => {
    expect(await documentText(doc("application/octet-stream", "<p>Hola</p>"))).toBe("Hola");
  });

  test("returns null for an unsupported type", async () => {
    expect(await documentText(doc("image/png", "<p>Hola</p>"))).toBeNull();
  });

  test("returns null for an empty body", async () => {
    expect(await documentText(doc("text/html", ""))).toBeNull();
    expect(await documentText(doc("", ""))).toBeNull();
  });

  test("reads the text of a PDF", async () => {
    const text = await documentText(doc("application/pdf", minimalPdf("MONTO MINIMO A PAGAR $18.400")));
    expect(text).toContain("MONTO MINIMO A PAGAR $18.400");
  });

  test("sniffs a PDF when the content type is empty", async () => {
    const text = await documentText(doc("", minimalPdf("MONTO MINIMO A PAGAR $18.400")));
    expect(text).toContain("MONTO MINIMO A PAGAR $18.400");
  });

  test("returns null for garbage typed as a PDF", async () => {
    expect(await documentText(doc("application/pdf", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])))).toBeNull();
  });
});
