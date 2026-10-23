import type { Database } from "bun:sqlite";
import { santiagoDate, santiagoParts } from "../clock/santiago";
import type { Etapa, Pendiente, TipoCita } from "../patricia/entities";
import type { Store } from "../patricia/store";
import { proponerEnCita } from "../plata/jueves";
import type { Clock } from "../ports";

export type Scheduler = {
  /** Decides, at the clock's current time, whether tonight's cita is due, and stores it. Sends nothing. */
  tick(): void;
};

type Slot = { tipo: "lunes" | "jueves" | "domingo"; label: string; minute: number };

/** The three citas of the week, by Santiago weekday (0 is Sunday), at Santiago wall time. */
const SLOTS: Partial<Record<number, Slot>> = {
  1: { tipo: "lunes", label: "del lunes", minute: 22 * 60 + 30 },
  4: { tipo: "jueves", label: "del jueves", minute: 22 * 60 + 30 },
  0: { tipo: "domingo", label: "del domingo", minute: 21 * 60 + 30 },
};

/** The madrugada ends at 05:30, exclusive, in minutes of the Santiago day. */
export const MADRUGADA_END = 5 * 60 + 30;
const MAX_CITAS_PER_WEEK = 3;

/**
 * The cita scheduler. Each tick reads the demo clock and Patricia's state;
 * a due slot is decided once, as a `programada` cita that takes every waiting
 * pendiente or a `callada` one, together with its decision. Missed days are
 * never caught up.
 */
export function createScheduler({ db, store, clock }: { db: Database; store: Store; clock: Clock }): Scheduler {
  const deferInMadrugada = (): void => {
    const ids = store
      .pendientes()
      .filter((pendiente) => pendiente.diferidoAt === null)
      .map((pendiente) => pendiente.id);
    if (ids.length === 0) return;
    db.transaction(() => {
      store.deferPendientes(ids);
      store.recordDecision({ tipo: "diferir", motivo: "diferido por madrugada", datos: { pendienteIds: ids } });
    })();
  };

  const callar = (fecha: string, tipo: TipoCita, etapa: Etapa, motivo: string): void => {
    db.transaction(() => {
      const cita = store.addCita({ fecha, tipo, estado: "callada", etapa, motivo, pendienteIds: [] });
      if (!cita) return;
      store.recordDecision({ tipo: "callar", motivo, datos: { citaId: cita.id, tipo, fecha } });
    })();
  };

  const programar = (fecha: string, tipo: TipoCita, etapa: Etapa, motivo: string, pendientes: Pendiente[]): void => {
    const pendienteIds = pendientes.map((pendiente) => pendiente.id);
    db.transaction(() => {
      const cita = store.addCita({ fecha, tipo, estado: "programada", etapa, motivo, pendienteIds });
      if (!cita) return;
      store.recordDecision({
        tipo: "programar-cita",
        motivo,
        datos: { citaId: cita.id, tipo, fecha, pendienteIds },
      });
      if (cita.tipo === "jueves") proponerEnCita(store, cita);
    })();
  };

  return {
    tick() {
      const now = clock.now();
      const parts = santiagoParts(now);
      const minute = parts.hour * 60 + parts.minute;
      if (minute < MADRUGADA_END) {
        deferInMadrugada();
        return;
      }

      const slot = SLOTS[parts.weekday];
      if (!slot || minute < slot.minute) return;
      const fecha = santiagoDate(now);
      if (store.citaOn(fecha)) return;

      const { etapa, enPausa } = store.getPatricia();
      const citas = store.citas();

      // Graduada, Luna keeps one cita a month: the first lunes of it, even if
      // that one was missed or went callada.
      const graduada = etapa === "graduada";
      if (graduada && (slot.tipo !== "lunes" || parts.day > 7)) return;
      const slotTipo: TipoCita = graduada ? "graduada" : slot.tipo;

      if (enPausa) return callar(fecha, slotTipo, etapa, "en pausa: Luna no habla");

      const [lunes, domingo] = weekBounds(parts);
      const programadasThisWeek = citas.filter(
        (c) => c.estado === "programada" && c.fecha >= lunes && c.fecha <= domingo,
      ).length;
      if (programadasThisWeek >= MAX_CITAS_PER_WEEK) {
        return callar(fecha, slotTipo, etapa, "ya van tres citas esta semana");
      }

      const pendientes = store.pendientes();
      // The bienvenida goes out once: a second one waiting rides along with the slot's cita.
      const bienvenida =
        pendientes.some((p) => p.tipo === "bienvenida") && !citas.some((c) => c.tipo === "bienvenida");
      const tipo: TipoCita = graduada
        ? "graduada"
        : pendientes.some((p) => p.tipo === "bienvenida-de-vuelta")
          ? "bienvenida-de-vuelta"
          : bienvenida
            ? "bienvenida"
            : slot.tipo;
      programar(fecha, tipo, etapa, motivoFor(tipo, slot, etapa), pendientes);
    },
  };
}

function motivoFor(tipo: TipoCita, slot: Slot, etapa: Etapa): string {
  switch (tipo) {
    case "graduada":
      return "cita del mes, graduada";
    case "bienvenida":
      return "bienvenida";
    case "bienvenida-de-vuelta":
      return "bienvenida de vuelta";
    default:
      return `cita ${slot.label}, etapa ${etapa}`;
  }
}

/** The Monday and Sunday, `YYYY-MM-DD`, of the Santiago week of `parts`. */
function weekBounds(parts: { year: number; month: number; day: number; weekday: number }): [string, string] {
  const sinceMonday = (parts.weekday + 6) % 7;
  const day = (offset: number) =>
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset)).toISOString().slice(0, 10);
  return [day(-sinceMonday), day(6 - sinceMonday)];
}
