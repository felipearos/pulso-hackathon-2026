import { extractText, getDocumentProxy } from "unpdf";
import type { WebDocument } from "../ports";

const LATIN1_CHARSETS = new Set(["iso-8859-1", "latin1", "windows-1252"]);

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  uuml: "ü",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  Uuml: "Ü",
  iexcl: "¡",
  iquest: "¿",
  ordm: "º",
  ordf: "ª",
};

/**
 * The readable text of the page or PDF a mail links to, as a plain-text dump
 * the extractor reads. Null when the type is not supported or there is no text.
 * `clave` opens an encrypted PDF; for one, a wrong or missing clave gives null.
 */
export async function documentText(doc: WebDocument, options: { clave?: string } = {}): Promise<string | null> {
  const [mediaType = "", ...params] = doc.contentType.split(";").map((part) => part.trim());
  const charset = params.find((p) => p.toLowerCase().startsWith("charset="))?.slice(8).replace(/"/g, "");
  let type = mediaType.toLowerCase();
  if (type === "" || type === "application/octet-stream") type = sniff(doc.body);

  let text: string | null;
  if (type === "application/pdf") text = await pdfText(doc.body, options.clave);
  else if (type === "text/html" || type === "application/xhtml+xml") text = htmlText(decode(doc.body, charset));
  else if (type === "text/plain") text = decode(doc.body, charset);
  else text = null;

  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function sniff(body: Uint8Array): string {
  if (new TextDecoder("latin1").decode(body.subarray(0, 5)) === "%PDF-") return "application/pdf";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return text.includes("<") ? "text/html" : "";
  } catch {
    return "";
  }
}

function decode(body: Uint8Array, charset: string | undefined): string {
  const label = charset?.toLowerCase();
  return new TextDecoder(label && LATIN1_CHARSETS.has(label) ? "windows-1252" : "utf-8").decode(body);
}

async function pdfText(body: Uint8Array, clave: string | undefined): Promise<string | null> {
  try {
    // pdf.js may detach the buffer it is handed, so it gets a copy.
    const pdf = await getDocumentProxy(new Uint8Array(body), clave === undefined ? {} : { password: clave });
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return null;
  }
}

function htmlText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, "   ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => decodeEntity(name) ?? entity);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function decodeEntity(name: string): string | undefined {
  if (name[0] !== "#") return NAMED_ENTITIES[name];
  const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}
