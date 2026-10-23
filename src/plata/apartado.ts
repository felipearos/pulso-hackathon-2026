/**
 * Plata apartada: the 10 % of each paid pedido del catálogo that Luna
 * proposes to pay sobre el mínimo. Pure functions; every "now" is a parameter
 * (ADR 0002).
 */
import { fromSantiago, santiagoParts } from "../clock/santiago";
import type { TipoSenal } from "../patricia/entities";

/** What plataApartada needs from a señal. `monto` is the pedido's paid amount, when known. */
export type SenalApartable = {
  id: number;
  tipo: TipoSenal;
  monto: number | null;
  receivedAt: Date;
};

/** One counted pedido and what it puts aside. */
export type Aporte = { senalId: number; monto: number; aporte: number };

export type PlataApartada = { total: number; aportes: Aporte[] };

// `$` then either dot-grouped thousands (`1.250.000`) or plain digits (`18500`).
const MONTO_PATTERN = /\$\s*(\d{1,3}(?:\.\d{3})+|\d+)/;

/** The first amount after a `$` in `text`, in whole pesos, or null when there is none. */
export function montoDePedido(text: string): number | null {
  const match = MONTO_PATTERN.exec(text);
  if (!match) return null;
  return Number(match[1]!.replaceAll(".", ""));
}

/** 10 % of `monto`, rounded to the nearest 100 pesos (half up); 0 for non-positive amounts. */
export function aporteDePedido(monto: number): number {
  if (!(monto > 0)) return 0;
  // 10 % rounded to 100 is `monto` rounded to 1.000, divided by 10.
  return Math.floor((monto + 500) / 1000) * 100;
}

/** Monday 00:00 in Santiago of the Monday–Sunday week containing `now`. */
export function inicioDeSemana(now: Date): Date {
  const { year, month, day, weekday } = santiagoParts(now);
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday));
  return fromSantiago({
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
  });
}

/**
 * The plata apartada this week: the aporte of every S3 received since Monday
 * 00:00 and after the week's last S5 (a «Recibimos tu pago» resets the tally).
 */
export function plataApartada(senales: readonly SenalApartable[], now: Date): PlataApartada {
  const desde = inicioDeSemana(now).getTime();
  const hasta = now.getTime();
  const semana = senales.filter((s) => s.receivedAt.getTime() >= desde && s.receivedAt.getTime() <= hasta);
  const ultimoPago = semana.reduce((last, s) => (s.tipo === "S5" && s.id > last ? s.id : last), -Infinity);
  const aportes = semana
    .filter((s) => s.tipo === "S3" && s.id > ultimoPago && s.monto !== null)
    .sort((a, b) => a.id - b.id)
    .map((s) => ({ senalId: s.id, monto: s.monto!, aporte: aporteDePedido(s.monto!) }));
  return { total: aportes.reduce((sum, a) => sum + a.aporte, 0), aportes };
}
