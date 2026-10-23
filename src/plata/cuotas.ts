/**
 * Compras en cuotas: what an S4 mail says about a purchase, how many cuotas
 * it has left and when the last one is billed, and whether a December
 * purchase is plata de cariño. Pure functions; every "now" is a parameter
 * (ADR 0002).
 */
import { santiagoParts } from "../clock/santiago";
import type { CompraEnCuotas } from "../figures/buena-noticia";
import type { TipoSenal } from "../patricia/entities";

/** What comprasEnCuotas needs from a señal. */
export type SenalEnCuotas = { id: number; tipo: TipoSenal; origen: { subject: string }; receivedAt: Date };

/** One registered compra en cuotas that still has cuotas to bill. */
export type CompraRegistrada = {
  senalId: number;
  cuotas: number;
  comercio: string | null;
  compradaEn: Date;
  cuotasRestantes: number;
  /** Spanish month name of the last cuota, e.g. «enero». */
  mesTermino: string;
  plataDeCarino: boolean;
};

const CUOTAS_MAX = 48;

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

const CUOTAS_PATTERN = new RegExp(`\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+cuotas?\\b`);
// The comercio runs from `cuotas en ` to the end or the first punctuation.
const COMERCIO_PATTERN = /\bcuotas?\s+en\s+([^.,;(]+)/;

/**
 * Words that make a purchase look like a gift, matched as whole words on the
 * lowercased, accent-free subject. Ropa alone is not a gift; «ropa para el
 * nieto» is, through «nieto».
 */
export const GIFT_WORDS = [
  "regalo",
  "regalos",
  "juguete",
  "juguetes",
  "jugueteria",
  "navidad",
  "navideno",
  "navidena",
  "navidenos",
  "navidenas",
  "pascua",
  "nieto",
  "nieta",
  "nietos",
  "nietas",
  "cumpleanos",
] as const;

const GIFT_PATTERN = new RegExp(`\\b(?:${GIFT_WORDS.join("|")})\\b`);

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/**
 * Lowercased and accent-free, one character for each of `text`'s, so an index
 * in the result is an index in `text`.
 */
function normalize(text: string): string {
  let out = "";
  for (const char of text) {
    const base = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += base.length === char.length ? base : char;
  }
  return out;
}

/** The purchase an S4 subject announces; null when no cuotas count from 1 to 48 can be read. */
export function compraEnCuotas(subject: string): { cuotas: number; comercio: string | null } | null {
  const normalized = normalize(subject);
  const match = CUOTAS_PATTERN.exec(normalized);
  if (!match) return null;
  const word = match[1]!;
  const cuotas = NUMBER_WORDS[word] ?? Number(word);
  if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > CUOTAS_MAX) return null;

  const comercioMatch = COMERCIO_PATTERN.exec(normalized);
  let comercio: string | null = null;
  if (comercioMatch) {
    const start = comercioMatch.index + comercioMatch[0].length - comercioMatch[1]!.length;
    const text = subject.slice(start, start + comercioMatch[1]!.length).trim();
    comercio = text === "" ? null : text;
  }
  return { cuotas, comercio };
}

/** True when the purchase was made in December (Santiago) and its subject looks like a gift. */
export function esPlataDeCarino(subject: string, compradaEn: Date): boolean {
  return santiagoParts(compradaEn).month === 12 && GIFT_PATTERN.test(normalize(subject));
}

/** Months since year zero for the Santiago month of `instant`. */
function monthIndex(instant: Date): number {
  const { year, month } = santiagoParts(instant);
  return year * 12 + (month - 1);
}

/**
 * The S4 compras that still have cuotas to bill at `now`, in input order. The
 * first cuota is billed the month after the purchase, one more each month.
 */
export function comprasEnCuotas(senales: readonly SenalEnCuotas[], now: Date): CompraRegistrada[] {
  const compras: CompraRegistrada[] = [];
  for (const senal of senales) {
    if (senal.tipo !== "S4") continue;
    const compra = compraEnCuotas(senal.origen.subject);
    if (compra === null) continue;
    const purchaseMonth = monthIndex(senal.receivedAt);
    const billed = Math.max(0, monthIndex(now) - purchaseMonth);
    const cuotasRestantes = compra.cuotas - billed;
    if (cuotasRestantes <= 0) continue;
    compras.push({
      senalId: senal.id,
      cuotas: compra.cuotas,
      comercio: compra.comercio,
      compradaEn: senal.receivedAt,
      cuotasRestantes,
      mesTermino: MONTH_NAMES[(purchaseMonth + compra.cuotas) % 12]!,
      plataDeCarino: esPlataDeCarino(senal.origen.subject, senal.receivedAt),
    });
  }
  return compras;
}

/** A registered compra as the buena noticia reads it. */
export function aCompraEnCuotas(compra: CompraRegistrada): CompraEnCuotas {
  return {
    descripcion: compra.comercio === null ? "la compra en cuotas" : `la compra en ${compra.comercio}`,
    cuotasRestantes: compra.cuotasRestantes,
    mesTermino: compra.mesTermino,
  };
}
