/**
 * The counters the /sala control room shows, derived from rows the store
 * already holds: citas, mensajes salientes and entrantes, señales and
 * estados de cuenta. Nothing is stored apart; every "now" is a parameter.
 */

import type { Intencion } from "../escalera/policy";
import type { Cita, EstadoDeCuenta, MensajeEntrante, MensajeSaliente, Senal } from "../patricia/entities";
import { inicioDeSemana } from "../plata/apartado";

/**
 * The intenciones that show she heard the cita: she can only accept, ask
 * about it or talk about the mínimo after listening to it.
 */
const INTENCIONES_ESCUCHADA: ReadonlySet<Intencion["kind"]> = new Set([
  "listened",
  "accepted",
  "minimum",
  "askWhy",
  "askWhatRead",
]);

export type NochesDeLaSemana = {
  /** Nights this week a programada cita went out (an invitation). */
  conInvitacion: number;
  /** Of those, nights she showed she heard it. */
  escuchadas: number;
  /** Of the nights she did not show it, those where Luna did not write again unprompted. */
  sinPresion: number;
};

export function nochesDeLaSemana(input: {
  citas: readonly Pick<Cita, "fecha" | "estado" | "mensajeSalienteId">[];
  salientes: readonly Pick<MensajeSaliente, "id" | "sentAt">[];
  entrantes: readonly Pick<MensajeEntrante, "intencion" | "receivedAt">[];
  now: Date;
}): NochesDeLaSemana {
  const desde = inicioDeSemana(input.now).getTime();
  const hasta = input.now.getTime();
  const salientes = input.salientes.filter((m) => m.sentAt.getTime() <= hasta);
  const entrantes = input.entrantes.filter((m) => m.receivedAt.getTime() <= hasta);
  const porId = new Map(salientes.map((m) => [m.id, m]));

  // Every invitation up to now, in time order: a night ends where the next one starts.
  const invitaciones = input.citas
    .filter((c) => c.estado === "programada" && c.mensajeSalienteId !== null)
    .flatMap((c) => {
      const saliente = porId.get(c.mensajeSalienteId!);
      return saliente === undefined ? [] : [saliente];
    })
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  const noches = { conInvitacion: 0, escuchadas: 0, sinPresion: 0 };
  invitaciones.forEach((invitacion, i) => {
    const inicio = invitacion.sentAt.getTime();
    if (inicio < desde) return;
    const siguiente = invitaciones[i + 1];
    const enLaNoche = (t: number) => t >= inicio && (siguiente === undefined || t < siguiente.sentAt.getTime());
    noches.conInvitacion += 1;

    const suyos = entrantes.filter((m) => enLaNoche(m.receivedAt.getTime()));
    if (suyos.some((m) => m.intencion !== null && INTENCIONES_ESCUCHADA.has(m.intencion.kind))) {
      noches.escuchadas += 1;
      return;
    }
    const primerEntrante = Math.min(...suyos.map((m) => m.receivedAt.getTime()));
    const insistio = salientes.some(
      (m) => m.id !== invitacion.id && enLaNoche(m.sentAt.getTime()) && m.sentAt.getTime() < primerEntrante,
    );
    if (!insistio) noches.sinPresion += 1;
  });
  return noches;
}

export type PagosSobreElMinimo = { sobreElMinimo: number; pagos: number; meta: { sobre: 2; de: 3 } };

/**
 * Every «Recibimos tu pago» (S5) with a monto up to `now`, compared with the
 * pago mínimo of the latest estado de cuenta that had one when it arrived.
 * A pago with no such estado de cuenta is left out.
 */
export function pagosSobreElMinimo(input: {
  senales: readonly Pick<Senal, "tipo" | "monto" | "receivedAt">[];
  estadosDeCuenta: readonly Pick<EstadoDeCuenta, "pagoMinimo" | "receivedAt">[];
  now: Date;
}): PagosSobreElMinimo {
  const hasta = input.now.getTime();
  const conMinimo = input.estadosDeCuenta.filter((e) => e.pagoMinimo !== null);
  const result: PagosSobreElMinimo = { sobreElMinimo: 0, pagos: 0, meta: { sobre: 2, de: 3 } };
  for (const s of input.senales) {
    if (s.tipo !== "S5" || s.monto === null || s.receivedAt.getTime() > hasta) continue;
    const estado = conMinimo
      .filter((e) => e.receivedAt.getTime() <= s.receivedAt.getTime())
      .reduce<(typeof conMinimo)[number] | null>(
        (last, e) => (last === null || e.receivedAt.getTime() > last.receivedAt.getTime() ? e : last),
        null,
      );
    if (estado === null) continue;
    result.pagos += 1;
    if (s.monto > estado.pagoMinimo!) result.sobreElMinimo += 1;
  }
  return result;
}
