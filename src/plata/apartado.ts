/**
 * Plata apartada: the 10 % of each paid pedido del catálogo that Luna
 * proposes to pay sobre el mínimo. Pure functions; every "now" is a parameter
 * (ADR 0002).
 */
import { fromSantiago, santiagoParts } from "../clock/santiago";
import type { TipoSenal } from "../patricia/entities";

/** What plataApartada needs from a señal. `monto` is what the pedido was paid, when known. */
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
// The largest monto the app can show or say (src/voz/montos.ts).
const MONTO_MAX = 999_999_999_999;

/** The first monto after a `$` in `text`, in whole pesos; null when there is none or it is absurdly large. */
export function montoDePedido(text: string): number | null {
  const match = MONTO_PATTERN.exec(text);
  if (!match) return null;
  const monto = Number(match[1]!.replaceAll(".", ""));
  return monto <= MONTO_MAX ? monto : null;
}

/** 10 % of `monto`, rounded to the nearest 100 pesos (half up); 0 for a monto of zero or less. */
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
  // Clock order, id breaking ties: a /demo clock reset can give a later id an earlier time.
  const despues = (a: SenalApartable, b: SenalApartable) =>
    a.receivedAt.getTime() > b.receivedAt.getTime() || (a.receivedAt.getTime() === b.receivedAt.getTime() && a.id > b.id);
  const ultimoPago = semana.filter((s) => s.tipo === "S5").reduce<SenalApartable | null>(
    (last, s) => (last === null || despues(s, last) ? s : last),
    null,
  );
  const aportes = semana
    .filter((s) => s.tipo === "S3" && s.monto !== null && (ultimoPago === null || despues(s, ultimoPago)))
    .sort((a, b) => (despues(a, b) ? 1 : -1))
    .map((s) => ({ senalId: s.id, monto: s.monto!, aporte: aporteDePedido(s.monto!) }));
  return { total: aportes.reduce((sum, a) => sum + a.aporte, 0), aportes };
}

/** Whether a «Recibimos tu pago» (S5) arrived between Monday 00:00 of this week and `now`. */
export function pagoRecibidoEstaSemana(
  senales: readonly Pick<SenalApartable, "tipo" | "receivedAt">[],
  now: Date,
): boolean {
  const desde = inicioDeSemana(now).getTime();
  const hasta = now.getTime();
  return senales.some((s) => s.tipo === "S5" && s.receivedAt.getTime() >= desde && s.receivedAt.getTime() <= hasta);
}
