/**
 * The buena noticia that opens each cita: one true and good thing taken from
 * what was extracted from her estado de cuenta, chosen by fixed priority.
 * Never a digit in the text, so it does not spend her one figure.
 */

/** A purchase in cuotas; `descripcion` starts with its article, e.g. «la lavadora». */
export interface CompraEnCuotas {
  descripcion: string;
  cuotasRestantes: number;
}

/** What the extractor read about her payments, for the buena noticia. Null fields: not found. */
export interface DatosBuenaNoticia {
  /** Past payments, oldest first; true when that month was paid on time. */
  pagosAnteriores: boolean[] | null;
  /**
   * Pesos in mora on this estado de cuenta (Statement.overdue); null if not
   * found. An absent `overdue` maps to null, never 0: 0 claims «no estás en DICOM».
   */
  mora: number | null;
  /** Purchases in cuotas with how many cuotas are left after this one. */
  comprasEnCuotas: CompraEnCuotas[] | null;
}

export type ReglaBuenaNoticia = "pagos-a-tiempo" | "sin-mora" | "cuota-termina" | "calida" | "pago-recibido";

export interface BuenaNoticia {
  regla: ReglaBuenaNoticia;
  texto: string;
}

const MONTH_WORDS: Record<number, string> = {
  2: "dos",
  3: "tres",
  4: "cuatro",
  5: "cinco",
  6: "seis",
  7: "siete",
  8: "ocho",
  9: "nueve",
  10: "diez",
  11: "once",
  12: "doce",
};

const WARM = "qué bueno que estemos conversando";

/** The domingo celebration when a «recibimos tu pago» arrived this week. */
export const PAGO_RECIBIDO: BuenaNoticia = {
  regla: "pago-recibido",
  texto: "llegó tu pago esta semana, el banco ya lo recibió",
};

/** Months paid on time at the end of the history, counting back from the latest. */
function trailingStreak(pagos: boolean[]): number {
  let streak = 0;
  for (let i = pagos.length - 1; i >= 0 && pagos[i]; i--) streak++;
  return streak;
}

function monthsInWords(n: number): string {
  return MONTH_WORDS[n] === undefined ? "más de un año" : `${MONTH_WORDS[n]} meses`;
}

/**
 * Picks the first rule that holds: pagos-a-tiempo, then sin-mora, then
 * cuota-termina, then the warm sentence with no data.
 */
export function buenaNoticia(datos: DatosBuenaNoticia): BuenaNoticia {
  if (datos.mora === 0) {
    const streak = datos.pagosAnteriores === null ? 0 : trailingStreak(datos.pagosAnteriores);
    if (streak >= 2) {
      return {
        regla: "pagos-a-tiempo",
        texto: `llevas ${monthsInWords(streak)} pagando a tiempo, no estás en DICOM`,
      };
    }
    return { regla: "sin-mora", texto: "estás al día, no estás en DICOM" };
  }

  let ending: CompraEnCuotas | undefined;
  for (const compra of datos.comprasEnCuotas ?? []) {
    if (compra.cuotasRestantes !== 1 && compra.cuotasRestantes !== 2) continue;
    // A digit in the description would spend her one figure.
    if (/\d/.test(compra.descripcion)) continue;
    if (ending === undefined || compra.cuotasRestantes < ending.cuotasRestantes) ending = compra;
  }
  if (ending !== undefined) {
    const quedan = ending.cuotasRestantes === 1 ? "le queda una sola cuota" : "le quedan dos cuotas";
    // «a el refrigerador» contracts to «al refrigerador».
    const texto = `a ${ending.descripcion} ${quedan}`.replace(/^a el /, "al ");
    return { regla: "cuota-termina", texto };
  }

  return { regla: "calida", texto: WARM };
}
