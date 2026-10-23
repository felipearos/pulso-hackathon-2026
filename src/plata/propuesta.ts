/**
 * The propuesta del jueves: pay the pago mínimo plus the plata apartada,
 * rounded up to the next thousand. The plata apartada stays in Patricia's own
 * account; Luna never moves money, she only proposes. The cifra comes from
 * this code, never from the LLM. Pure functions, no store and no clock.
 */
import { montoEnPantalla } from "../voz/montos";

export type Propuesta = { apartado: number; pagoMinimo: number; monto: number };

export type EleccionDePago = "propuesta" | "minimo";

const MIL = 1000;

/** Shared by both replies so neither choice sounds warmer than the other. */
const CIERRE = "Gracias por contarme, Patricia.";

/** The propuesta for this week, or null when there is nothing to propose sobre el mínimo. */
export function propuestaDelJueves({
  apartado,
  pagoMinimo,
}: {
  apartado: number;
  pagoMinimo: number | null;
}): Propuesta | null {
  if (apartado <= 0 || pagoMinimo === null || pagoMinimo <= 0) return null;
  const monto = Math.ceil((pagoMinimo + apartado) / MIL) * MIL;
  return { apartado, pagoMinimo, monto };
}

/** What the jueves cita says: the plata apartada this week and the question with the two emoji. */
export function textoPropuesta(p: Propuesta, bolsillo: string | null = null): string {
  const apartado = bolsillo === null
    ? `${montoEnPantalla(p.apartado)} apartados`
    : `${montoEnPantalla(p.apartado)} para «${bolsillo}»`;
  return `Esta semana llevas ${apartado}. ¿Pagas ${montoEnPantalla(p.monto)} 👍 o el mínimo 👌?`;
}

/** Luna's reply to Patricia's choice; equally warm either way, never comparing the two. */
export function respuestaAEleccion(eleccion: EleccionDePago, p: Propuesta, bolsillo: string | null = null): string {
  const anotado = eleccion === "propuesta" ? montoEnPantalla(p.monto) : "el mínimo";
  const recordatorio = eleccion === "propuesta" && bolsillo !== null
    ? ` Mañana, cuando pagues, pasa lo apartado a «${bolsillo}».`
    : "";
  return `Anotado: ${anotado} este mes.${recordatorio} ${CIERRE}`;
}
