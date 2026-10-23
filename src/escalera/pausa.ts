import type { Database } from "bun:sqlite";
import type { Etapa } from "../patricia/entities";
import type { Store } from "../patricia/store";
import { etapaOnReturn } from "./policy";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Without a reply for this long, Luna goes silent on her own. */
export const SILENCE_MS = 14 * DAY_MS;
/** A bank estado de cuenta comes once a month: an elapsed 30 days is a missed cycle even with no mail read. */
const CYCLE_MS = 30 * DAY_MS;

/**
 * When Patricia was last in touch: her latest mensaje entrante; if she never
 * wrote, the first message Luna sent her; null if Luna never sent one either.
 */
export function lastContactAt(store: Store): Date | null {
  return store.mensajesEntrantes().at(-1)?.receivedAt ?? store.mensajesSalientes()[0]?.sentAt ?? null;
}

/**
 * Puts Patricia in pausa when 14 days of the clock passed since her last
 * contact. Luna sends nothing: the pausa itself is the answer. A graduada
 * hears from Luna once a month, so two quiet weeks are her normal rhythm.
 */
export function pauseIfSilent(db: Database, store: Store, now: Date): void {
  const { enPausa, etapa } = store.getPatricia();
  if (enPausa || etapa === "graduada") return;
  const last = lastContactAt(store);
  if (last === null || now.getTime() - last.getTime() < SILENCE_MS) return;
  db.transaction(() => {
    store.updatePatricia({ enPausa: true });
    store.recordDecision({
      tipo: "pausa",
      motivo: "en pausa: 14 días sin respuesta",
      datos: { desde: last.toISOString() },
    });
  })();
}

/** When the current pausa started: the `desde` of the latest pausa decision, or `fallback` if there is none. */
export function pausaDesde(store: Store, fallback: Date): Date {
  const datos = store.decisions().findLast((decision) => decision.tipo === "pausa")?.datos;
  const desde = (datos as { desde?: unknown } | undefined)?.desde;
  return typeof desde === "string" ? new Date(desde) : fallback;
}

/**
 * The estado de cuenta cycles she missed during a pausa: the bank estados de
 * cuenta that came in, or the months that passed, whichever is more.
 */
export function missedCyclesSince(store: Store, desde: Date, now: Date): number {
  const estados = store
    .estadosDeCuenta()
    .filter((estado) => estado.origen === "banco" && estado.receivedAt.getTime() > desde.getTime()).length;
  const months = Math.floor((now.getTime() - desde.getTime()) / CYCLE_MS);
  return Math.max(estados, months);
}

/** The etapa she comes back to after a pausa, with the reason and what it was read from. */
export function returnFromPausa(
  store: Store,
  now: Date,
): { from: Etapa; to: Etapa; reason: string; desde: Date; missedCycles: number } {
  const from = store.getPatricia().etapa;
  const desde = pausaDesde(store, now);
  const missedCycles = missedCyclesSince(store, desde, now);
  const { etapa: to, reason } = etapaOnReturn({ etapa: from, missedCycles, afterCrisis: false });
  return { from, to, reason, desde, missedCycles };
}
