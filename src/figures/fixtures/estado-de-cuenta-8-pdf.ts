import { ESTADO_DE_CUENTA_8_TEXTO } from "./estado-de-cuenta-8";

/**
 * The fictional estado de cuenta 8 as a one-page A4 PDF, built in memory:
 * one text line per line of `ESTADO_DE_CUENTA_8_TEXTO`, in Courier with
 * WinAnsiEncoding so accents and «°» render. No binary file is committed.
 */
export function estadoDeCuenta8Pdf(): Uint8Array {
  return pdfDeTexto(ESTADO_DE_CUENTA_8_TEXTO.replace(/\n$/, "").split("\n"));
}

/** A one-page A4 PDF with `lines` set from the top-left margin, 10 pt on 12 pt leading. */
function pdfDeTexto(lines: string[]): Uint8Array {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 10 Tf",
    "12 TL",
    "40 800 Td",
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${latin1Length(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(latin1Length(out));
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = latin1Length(out);
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

function latin1Length(s: string): number {
  return Buffer.byteLength(s, "latin1");
}
