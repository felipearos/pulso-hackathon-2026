import { createHash } from "node:crypto";
import { ESTADO_DE_CUENTA_8_TEXTO } from "./estado-de-cuenta-8";
import { ESTADO_DE_CUENTA_9_TEXTO } from "./estado-de-cuenta-9";
import { ESTADO_DE_CUENTA_TIENDA_TEXTO } from "./estado-de-cuenta-tienda";

/**
 * The fictional estados de cuenta as one-page A4 PDFs, built in memory: one
 * text line per line of their text, in Courier with WinAnsiEncoding so
 * accents and «°» render. No binary file is committed.
 */
export function estadoDeCuenta8Pdf(): Uint8Array {
  return pdfDeTexto(ESTADO_DE_CUENTA_8_TEXTO);
}

/**
 * The estado de cuenta 8 as the bank mails it: encrypted with the PDF
 * Standard Security Handler (RC4, 128-bit key), opening only with `clave`.
 */
export function estadoDeCuenta8PdfCifrado(clave: string): Uint8Array {
  return pdfDeTexto(ESTADO_DE_CUENTA_8_TEXTO, clave);
}

export function estadoDeCuenta9Pdf(): Uint8Array {
  return pdfDeTexto(ESTADO_DE_CUENTA_9_TEXTO);
}

export function estadoDeCuentaTiendaPdf(): Uint8Array {
  return pdfDeTexto(ESTADO_DE_CUENTA_TIENDA_TEXTO);
}

/**
 * A one-page A4 PDF with the lines of `texto` set from the top-left margin, 10 pt on 12 pt leading.
 * With `clave`, the content stream is encrypted and the PDF opens only with that user password.
 */
function pdfDeTexto(texto: string, clave?: string): Uint8Array {
  const lines = texto.replace(/\n$/, "").split("\n");
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 10 Tf",
    "12 TL",
    "40 800 Td",
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    "ET",
  ].join("\n");
  const security = clave === undefined ? null : standardSecurity(clave, md5(latin1(texto)));
  const contentObject = 4;
  const stream = security ? rc4(security.objectKey(contentObject), latin1(content)) : latin1(content);
  const objects: Uint8Array[][] = [
    [latin1("<< /Type /Catalog /Pages 2 0 R >>")],
    [latin1("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    [latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObject} 0 R /Resources << /Font << /F1 5 0 R >> >> >>`)],
    [latin1(`<< /Length ${stream.length} >>\nstream\n`), stream, latin1("\nendstream")],
    [latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")],
  ];
  if (security) objects.push([latin1(security.dictionary)]);

  const parts: Uint8Array[] = [latin1("%PDF-1.4\n")];
  let length = parts[0]!.length;
  const push = (part: Uint8Array) => {
    parts.push(part);
    length += part.length;
  };
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(length);
    push(latin1(`${i + 1} 0 obj\n`));
    object.forEach(push);
    push(latin1("\nendobj\n"));
  });
  const xref = length;
  const trailer = security
    ? `/Size ${objects.length + 1} /Root 1 0 R /Encrypt ${objects.length} 0 R /ID [<${hex(security.id)}> <${hex(security.id)}>]`
    : `/Size ${objects.length + 1} /Root 1 0 R`;
  push(
    latin1(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
        `trailer\n<< ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/** The 32-byte string passwords are padded with (PDF 1.7, 7.6.3.3). */
const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6,
  0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);
const OWNER_PASSWORD = "banco-ficticio-propietario";
/** Print, modify, copy, annotate: every permission but the reserved low bits. */
const PERMISSIONS = -4;
const KEY_BYTES = 16;

/** Standard Security Handler, revision 3: the file key (Algorithm 2), O (Algorithm 3) and U (Algorithm 5). */
function standardSecurity(clave: string, id: Uint8Array) {
  let ownerHash = md5(pad(OWNER_PASSWORD));
  for (let i = 0; i < 50; i++) ownerHash = md5(ownerHash);
  const o = rc4Rounds(ownerHash.subarray(0, KEY_BYTES), pad(clave));

  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, PERMISSIONS, true);
  let key = md5(pad(clave), o, p, id).subarray(0, KEY_BYTES);
  for (let i = 0; i < 50; i++) key = md5(key).subarray(0, KEY_BYTES);

  const u = new Uint8Array(32);
  u.set(rc4Rounds(key, md5(PASSWORD_PADDING, id)));

  return {
    id,
    dictionary: `<< /Filter /Standard /V 2 /R 3 /Length 128 /O <${hex(o)}> /U <${hex(u)}> /P ${PERMISSIONS} >>`,
    /** Algorithm 1: the key for one object, salted with its number and generation 0. */
    objectKey: (num: number) => md5(key, Uint8Array.from([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, 0, 0])).subarray(0, KEY_BYTES),
  };
}

/** RC4 with `key`, then 19 more passes with each key byte XORed with the pass number. */
function rc4Rounds(key: Uint8Array, data: Uint8Array): Uint8Array {
  let out = rc4(key, data);
  for (let i = 1; i <= 19; i++) out = rc4(key.map((b) => b ^ i), out);
  return out;
}

/** RC4, hand-written: OpenSSL 3 no longer offers it to node:crypto. */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function pad(password: string): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = latin1(password).subarray(0, 32);
  out.set(bytes);
  out.set(PASSWORD_PADDING.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

function md5(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function latin1(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "latin1"));
}
