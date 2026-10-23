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
