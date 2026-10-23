import type { Database } from "bun:sqlite";
import { santiagoDate, santiagoParts } from "../clock/santiago";
import type { Store } from "../patricia/store";
import type { Clock, Llm, SpokenAudio, Voice, WhatsApp } from "../ports";
import type { ValidatorDecision } from "../validator/validator";
import { montoEnPalabras, montoEnPantalla } from "../voz/montos";
import { decisionDeCita, redactarGuion, type CifraPermitida } from "./redactor";

export type CitaSender = {
  /** Sends today's programada cita as a nota de voz, once; a failed send is retried on the next tick of the same day. */
  tick(): Promise<void>;
};

/** The madrugada ends at 05:30, exclusive, as in the scheduler. */
const MADRUGADA_END = 5 * 60 + 30;
/** An audio longer than this is rewritten shorter, once. */
const MAX_SECONDS = 45;

/** The guion as Luna says it: every peso amount of the cifra in words, not digits. */
export function guionHablado(guion: string, cifra: CifraPermitida | null): string {
  if (cifra === null) return guion;
  const monto = cifra.kind === "pago-minimo" ? cifra.monto : cifra.cuota;
  return guion.replaceAll(montoEnPantalla(monto), montoEnPalabras(monto));
}

/**
 * The cita sender. Each tick takes today's cita, and if it is programada and
 * not yet sent, renders its guion, speaks it and sends it on WhatsApp as a
 * nota de voz, stored as a mensaje saliente with its decision. Past days are
 * never caught up.
 */
export function createCitaSender({
  db,
  store,
  clock,
  llm,
  voice,
  whatsapp,
}: {
  db: Database;
  store: Store;
  clock: Clock;
  llm: Llm;
  voice: Voice;
  whatsapp: WhatsApp;
}): CitaSender {
  let sending = false;

  const send = async (): Promise<void> => {
    const now = clock.now();
    const parts = santiagoParts(now);
    if (parts.hour * 60 + parts.minute < MADRUGADA_END) return;
    const cita = store.citaOn(santiagoDate(now));
    if (!cita || cita.estado !== "programada" || cita.mensajeSalienteId !== null) return;

    const estadoDeCuenta = store.estadosDeCuenta().findLast((e) => e.cifras !== null) ?? null;
    const decision = decisionDeCita({ cita, estadoDeCuenta });
    const recordDecision = (d: ValidatorDecision) => {
      store.recordDecision({ tipo: "mensaje", motivo: d.reason, datos: { citaId: cita.id, ...d.input } });
    };

    let { guion, source } = await redactarGuion({ llm, decision, recordDecision });
    let acortado = false;
    let audio: SpokenAudio;
    let id: string;
    try {
      audio = await voice.synthesize(guionHablado(guion, decision.cifra));
      if (audio.durationSeconds > MAX_SECONDS) {
        ({ guion, source } = await redactarGuion({
          llm,
          decision,
          recordDecision,
          acortar: { guion, durationSeconds: audio.durationSeconds },
        }));
        acortado = true;
        audio = await voice.synthesize(guionHablado(guion, decision.cifra));
      }
      ({ id } = await whatsapp.send({
        kind: "audio",
        audio: audio.audio,
        mimeType: audio.mimeType,
        durationSeconds: audio.durationSeconds,
      }));
    } catch (error) {
      console.error(`cita ${cita.id}: send failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const { durationSeconds } = audio;
    db.transaction(() => {
      const mensaje = store.addMensajeSaliente({ kind: "audio", text: guion, durationSeconds, whatsappId: id });
      store.markCitaSent(cita.id, mensaje.id);
      store.recordDecision({
        tipo: "mensaje",
        motivo: `salió la ${cita.motivo}: nota de voz de ${Math.round(durationSeconds)} s`,
        datos: { citaId: cita.id, decision, guion, source, durationSeconds, acortado },
      });
    })();
  };

  return {
    async tick() {
      // A tick that lands while a send is running must not send the cita twice.
      if (sending) return;
      sending = true;
      try {
        await send();
      } finally {
        sending = false;
      }
    },
  };
}
