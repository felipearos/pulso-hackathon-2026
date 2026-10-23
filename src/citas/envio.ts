import type { Database } from "bun:sqlite";
import { santiagoDate, santiagoParts } from "../clock/santiago";
import type { Store } from "../patricia/store";
import type { Clock, Llm, SpokenAudio, Voice, WhatsApp } from "../ports";
import type { ValidatorDecision } from "../validator/validator";
import { montoEnPalabras, montoEnPantalla } from "../voz/montos";
import { decisionDeCita, MAX_AUDIO_SECONDS, redactarGuion, type CifraPermitida } from "./redactor";
import { MADRUGADA_END } from "./scheduler";

export type CitaSender = {
  /** Sends today's programada cita as a nota de voz, once; a failed send is retried on the next tick of the same day. */
  tick(): Promise<void>;
};

/** The guion as Luna says it: every peso amount of the cifra in words, not digits. */
export function guionHablado(guion: string, cifra: CifraPermitida | null): string {
  if (cifra === null) return guion;
  const monto = cifra.kind === "pago-minimo" ? cifra.monto : cifra.cuota;
  // «$41.900», «41.900», «41900» and «41.900 pesos» all become words; the validator lets each through.
  const digits = [montoEnPantalla(monto).slice(1), String(monto)].map((form) => form.replaceAll(".", "\\."));
  const pattern = new RegExp(`(?:\\$\\s?)?(?<![\\d.])(?:${digits.join("|")})(?!\\d|[.,]\\d)(?:\\s+pesos)?`, "g");
  return guion.replace(pattern, montoEnPalabras(monto));
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
  // Citas whose failed send is already in the registro: retries every tick must not flood it.
  const failureRecorded = new Set<number>();

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
      if (audio.durationSeconds > MAX_AUDIO_SECONDS) {
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
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      console.error(`cita ${cita.id}: send failed: ${error}`);
      if (!failureRecorded.has(cita.id)) {
        failureRecorded.add(cita.id);
        store.recordDecision({
          tipo: "mensaje",
          motivo: `no salió la ${cita.motivo}: falló la voz o el envío; se reintenta en el próximo tick del día`,
          datos: { citaId: cita.id, error },
        });
      }
      return;
    }

    const { durationSeconds } = audio;
    db.transaction(() => {
      const mensaje = store.addMensajeSaliente({ kind: "audio", text: guion, durationSeconds, whatsappId: id });
      // Another sender got there first: roll the mensaje and its decision back.
      if (!store.markCitaSent(cita.id, mensaje.id)) throw new Error(`cita ${cita.id} was already sent`);
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
