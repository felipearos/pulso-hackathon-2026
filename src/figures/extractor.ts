import type { Llm, LlmImage } from "../ports";
import type { CompraEnCuotas } from "./buena-noticia";

/** One past payment as the estado de cuenta lists it. */
export interface PagoAnterior {
  /** Pesos paid. */
  monto: number;
  /** True when it was paid on or before its vencimiento. */
  aTiempo: boolean;
}

/**
 * What the extractor read on one estado de cuenta. Every field is null when it
 * was not found or the extractor doubted it: «no encontrado», never used.
 */
export interface CifrasExtraidas {
  /** Pago mínimo in integer pesos. */
  pagoMinimo: number | null;
  /** Total facturado in integer pesos. */
  totalFacturado: number | null;
  /** Cupo total of the card in integer pesos. */
  cupo: number | null;
  /** Monthly interest rate as a fraction, e.g. 0.031. */
  tasaMensual: number | null;
  /** `YYYY-MM-DD`. */
  fechaVencimiento: string | null;
  /** `YYYY-MM-DD`. */
  fechaCierre: string | null;
  /** Pesos in mora; 0 when the estado de cuenta says she owes nothing overdue. */
  mora: number | null;
  /** Oldest first. */
  pagosAnteriores: PagoAnterior[] | null;
  comprasEnCuotas: CompraEnCuotas[] | null;
}

export const EXTRACTOR_MODEL = "claude-opus-5-5";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1500;

// The model copies figures as printed; the code does the arithmetic (percent to
// fraction, cuotas left), so the model never computes a number.
const REGLAS = `Responde SOLO un objeto JSON con exactamente estas claves:
{"pagoMinimo":<entero>,"totalFacturado":<entero>,"cupo":<entero>,"tasaMensualPorcentaje":<número>,"fechaVencimiento":"AAAA-MM-DD","fechaCierre":"AAAA-MM-DD","mora":<entero>,"pagosAnteriores":[{"monto":<entero>,"aTiempo":<true|false>}],"comprasEnCuotas":[{"descripcion":"<texto>","cuotaActual":<entero>,"cuotasTotales":<entero>}]}
Reglas:
- Copia cada cifra exactamente como está impresa. Nunca calcules, redondees ni deduzcas una cifra. Si no la encuentras o dudas, usa null.
- Los montos en pesos son enteros: los puntos son separadores de miles y no hay decimales ($41.900 es 41900).
- pagoMinimo es el monto mínimo a pagar; totalFacturado es el monto total facturado; cupo es el cupo total.
- tasaMensualPorcentaje es la tasa de interés mensual tal como está impresa, en porcentaje y con punto decimal (3,10 % es 3.1).
- fechaVencimiento es la fecha hasta la que se puede pagar; fechaCierre es la fecha de facturación. Escríbelas como AAAA-MM-DD.
- mora es el monto en mora en pesos; usa 0 solo si el texto dice explícitamente que no hay nada en mora (por ejemplo «Monto en mora: $0»); usa null si el texto no lo dice.
- pagosAnteriores va del más antiguo al más reciente; aTiempo es true si se pagó en o antes de su vencimiento.
- comprasEnCuotas copia la cuota impresa: «cuota 4 de 6» es cuotaActual 4 y cuotasTotales 6.
- Si una lista no aparece en el texto, usa null.`;

const CIERRE = `Ejemplo de un estado de cuenta sin ninguna cifra legible:
{"pagoMinimo":null,"totalFacturado":null,"cupo":null,"tasaMensualPorcentaje":null,"fechaVencimiento":null,"fechaCierre":null,"mora":null,"pagosAnteriores":null,"comprasEnCuotas":null}
No agregues explicaciones, formato Markdown ni texto fuera del JSON.`;

const SYSTEM_PROMPT = `Lees el texto de un estado de cuenta (de un banco o de una tienda, en cualquier formato) y copias sus cifras.
${REGLAS}
${CIERRE}`;

// A photo can blur or cut a figure; the model leaves it null rather than guess.
const FOTO_SYSTEM_PROMPT = `Lees el texto o la foto de un estado de cuenta (de un banco o de una tienda, en cualquier formato) y copias sus cifras.
${REGLAS}
- Una cifra borrosa, cortada o ilegible en la foto es null.
${CIERRE}`;

function pesos(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function tasa(porcentaje: unknown): number | null {
  if (typeof porcentaje !== "number" || !Number.isFinite(porcentaje)) return null;
  // Rounding to the printed precision keeps 3.1 % from becoming 0.031000000000000003.
  const fraction = Math.round(porcentaje * 10_000) / 1_000_000;
  return fraction > 0 && fraction < 1 ? fraction : null;
}

function fecha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= daysInMonth ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A list with any malformed item is not trusted as a whole: null. */
function lista<T>(value: unknown, item: (raw: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const raw of value) {
    const parsed = item(raw);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

function pagoAnterior(raw: unknown): PagoAnterior | null {
  if (!isRecord(raw)) return null;
  const monto = pesos(raw.monto);
  if (monto === null || typeof raw.aTiempo !== "boolean") return null;
  return { monto, aTiempo: raw.aTiempo };
}

function compraEnCuotas(raw: unknown): CompraEnCuotas | null {
  if (!isRecord(raw)) return null;
  const { descripcion, cuotaActual, cuotasTotales } = raw;
  if (typeof descripcion !== "string" || descripcion.trim() === "") return null;
  if (typeof cuotaActual !== "number" || !Number.isSafeInteger(cuotaActual) || cuotaActual < 1) return null;
  if (typeof cuotasTotales !== "number" || !Number.isSafeInteger(cuotasTotales) || cuotasTotales < cuotaActual) {
    return null;
  }
  return { descripcion: descripcion.trim(), cuotasRestantes: cuotasTotales - cuotaActual };
}

function parseReply(reply: string): Record<string, unknown> | null {
  const unfenced = reply
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const objectText = unfenced.match(/\{[\s\S]*\}/)?.[0];
  if (!objectText) return null;
  try {
    const parsed = JSON.parse(objectText) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Checks every field of Claude's reply; a doubtful one becomes null without discarding the others. */
function cifras(reply: string): CifrasExtraidas | null {
  const raw = parseReply(reply);
  if (!raw) return null;

  return {
    pagoMinimo: pesos(raw.pagoMinimo),
    totalFacturado: pesos(raw.totalFacturado),
    cupo: pesos(raw.cupo),
    tasaMensual: tasa(raw.tasaMensualPorcentaje),
    fechaVencimiento: fecha(raw.fechaVencimiento),
    fechaCierre: fecha(raw.fechaCierre),
    mora: pesos(raw.mora),
    pagosAnteriores: lista(raw.pagosAnteriores, pagoAnterior),
    comprasEnCuotas: lista(raw.comprasEnCuotas, compraEnCuotas),
  };
}

/**
 * Reads the figures of one estado de cuenta with Claude. Every field is checked
 * in code; a doubtful one becomes null without discarding the others. Never
 * throws: null when Claude failed or its answer was not JSON, so the caller can
 * read again instead of taking a failed call for figures not found.
 */
export async function extractCifras(
  text: string,
  llm: Llm,
  options?: { timeoutMs?: number },
): Promise<CifrasExtraidas | null> {
  let reply: string;
  try {
    reply = await llm.complete({
      model: EXTRACTOR_MODEL,
      system: SYSTEM_PROMPT,
      prompt: `Estado de cuenta:\n\n${text}`,
      maxTokens: MAX_TOKENS,
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  return cifras(reply);
}

/**
 * Reads the same figures from a foto of an estado de cuenta: a screen capture
 * of the tienda's portal or a photo of the paper one. Never throws, like
 * `extractCifras`.
 */
export async function extractCifrasDeFoto(
  foto: LlmImage,
  llm: Llm,
  options?: { timeoutMs?: number },
): Promise<CifrasExtraidas | null> {
  let reply: string;
  try {
    reply = await llm.complete({
      model: EXTRACTOR_MODEL,
      system: FOTO_SYSTEM_PROMPT,
      prompt: "Foto de un estado de cuenta: copia sus cifras.",
      images: [foto],
      maxTokens: MAX_TOKENS,
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  return cifras(reply);
}
