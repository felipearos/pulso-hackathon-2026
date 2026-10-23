import type { Database } from "bun:sqlite";
import { santiagoDate, santiagoParts } from "../clock/santiago";
import { estadoDeCuenta8Pdf } from "../figures/fixtures/estado-de-cuenta-8-pdf";
import { imagenDifuminada } from "../figures/imagen-difuminada";
import type { Cita } from "../patricia/entities";
import { pagoRecibidoEstaSemana } from "../plata/apartado";
import { aCompraEnCuotas, comprasEnCuotas as comprasRegistradas } from "../plata/cuotas";
import type { Store } from "../patricia/store";
import type { Clock, Llm, SpokenAudio, Voice, WhatsApp } from "../ports";
import { permitirUrl } from "../mail/permitir";
import type { ValidatedText, ValidatorDecision } from "../validator/validator";
import { vozDe } from "../voice/voces";
import { montoEnPalabras, montoEnPantalla } from "../voz/montos";
import {
  decisionDeCita,
  type DecisionDeCita,
  GUION_BIENVENIDA,
  MAX_AUDIO_SECONDS,
  redactarGuion,
  type CifraPermitida,
} from "./redactor";
import { MADRUGADA_END } from "./scheduler";

/** What Patricia reads under the imagen difuminada of an etapa 3 cita. */
export const CAPTION_IMAGEN = "Tu estado de cuenta, todo tapado menos lo que miramos hoy.";

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
 * never caught up. The bienvenida speaks the fixed guion de bienvenida and is
 * followed by a text with the «Permitir» link.
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
  const permitirFailureRecorded = new Set<number>();
  const imagenFailureRecorded = new Set<number>();
  // Citas whose cifra is not on the estado de cuenta: the image is withheld, recorded once.
  const imagenCallada = new Set<number>();

  // The bank's: a tienda estado de cuenta must not replace the figure Patricia hears on Monday.
  const decisionFor = (cita: Cita, now: Date): DecisionDeCita => {
    const estadoDeCuenta = store.estadosDeCuenta().findLast((e) => e.origen === "banco" && e.cifras !== null) ?? null;
    const pagoRecibido = pagoRecibidoEstaSemana(store.senales(), now);
    const comprasEnCuotas = comprasRegistradas(store.senales(), now).map(aCompraEnCuotas);
    return decisionDeCita({ cita, estadoDeCuenta, pagoRecibido, comprasEnCuotas });
  };

  // Read from the base, not memory, so a restart between the audio and the image still sends the image.
  const imagenOwed = (cita: Cita): boolean =>
    cita.etapa === 3 &&
    cita.mensajeSalienteId !== null &&
    !imagenCallada.has(cita.id) &&
    !store.mensajesSalientes().some((m) => m.kind === "image" && m.id > cita.mensajeSalienteId!);

  const sendImagen = async (cita: Cita, cifra: CifraPermitida | null): Promise<void> => {
    if (cita.etapa !== 3 || cifra?.kind !== "pago-minimo") return;
    const caption = CAPTION_IMAGEN;
    let imagen: Awaited<ReturnType<typeof imagenDifuminada>>;
    let id: string;
    try {
      imagen = await imagenDifuminada(estadoDeCuenta8Pdf(), montoEnPantalla(cifra.monto));
      if (imagen === null) {
        imagenCallada.add(cita.id);
        store.recordDecision({
          tipo: "mensaje",
          motivo: `callo la imagen del estado de cuenta de la ${cita.motivo}: la cifra no está en el estado de cuenta`,
          datos: { citaId: cita.id, cifra },
        });
        return;
      }
      ({ id } = await whatsapp.send({ kind: "image", image: imagen.png, mimeType: "image/png", caption }));
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      console.error(`cita ${cita.id}: image send failed: ${error}`);
      if (!imagenFailureRecorded.has(cita.id)) {
        imagenFailureRecorded.add(cita.id);
        store.recordDecision({
          tipo: "mensaje",
          motivo: `no salió la imagen del estado de cuenta de la ${cita.motivo}; se reintenta en el próximo tick del día`,
          datos: { citaId: cita.id, error },
        });
      }
      return;
    }
    const { recuadro } = imagen;
    db.transaction(() => {
      store.addMensajeSaliente({ kind: "image", text: caption, durationSeconds: null, whatsappId: id });
      store.recordDecision({
        tipo: "mensaje",
        motivo: `salió la imagen del estado de cuenta de la ${cita.motivo}`,
        datos: { citaId: cita.id, cifra, recuadro },
      });
    })();
  };

  // Read from the base, not memory, so a restart between the audio and the link still sends the link.
  const permitirOwed = (cita: Cita): boolean =>
    cita.tipo === "bienvenida" &&
    cita.mensajeSalienteId !== null &&
    !store
      .mensajesSalientes()
      .some((m) => m.kind === "text" && m.id > cita.mensajeSalienteId! && m.text?.includes(permitirUrl()));

  const sendPermitir = async (cita: { id: number; motivo: string }): Promise<void> => {
    const text = `Para que pueda leer los correos de tu banco y de tu tienda, toca aquí y dale «Permitir» (solo lectura): ${permitirUrl()}`;
    let id: string;
    try {
      ({ id } = await whatsapp.send({ kind: "text", text }));
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      console.error(`cita ${cita.id}: permitir link send failed: ${error}`);
      if (!permitirFailureRecorded.has(cita.id)) {
        permitirFailureRecorded.add(cita.id);
        store.recordDecision({
          tipo: "mensaje",
          motivo: `no salió el enlace «Permitir» de la ${cita.motivo}; se reintenta en el próximo tick del día`,
          datos: { citaId: cita.id, error },
        });
      }
      return;
    }
    db.transaction(() => {
      store.addMensajeSaliente({ kind: "text", text, durationSeconds: null, whatsappId: id });
      store.recordDecision({
        tipo: "mensaje",
        motivo: `salió el enlace «Permitir» de la ${cita.motivo}`,
        datos: { citaId: cita.id, text },
      });
    })();
  };

  const send = async (): Promise<void> => {
    const now = clock.now();
    const parts = santiagoParts(now);
    if (parts.hour * 60 + parts.minute < MADRUGADA_END) return;
    // Any bienvenida, not only today's: a link still failing at midnight goes out the next day.
    const owed = store.citas().find(permitirOwed);
    if (owed) await sendPermitir(owed);
    const cita = store.citaOn(santiagoDate(now));
    // Only today's: an image still failing at midnight is not caught up.
    if (cita && imagenOwed(cita) && !store.getPatricia().enPausa) {
      await sendImagen(cita, decisionFor(cita, now).cifra);
      return;
    }
    if (!cita || cita.estado !== "programada" || cita.mensajeSalienteId !== null) return;
    // A pausa that began after the cita was programada still silences it.
    if (store.getPatricia().enPausa) return;

    const decision = decisionFor(cita, now);
    const recordDecision = (d: ValidatorDecision) => {
      store.recordDecision({ tipo: "mensaje", motivo: d.reason, datos: { citaId: cita.id, ...d.input } });
    };

    const bienvenida = cita.tipo === "bienvenida";
    const voz = vozDe(store.getPatricia().voz);
    let { guion, source }: { guion: string; source: ValidatedText["source"] | "guion-fijo" } = bienvenida
      ? { guion: GUION_BIENVENIDA, source: "guion-fijo" }
      : await redactarGuion({ llm, decision, recordDecision });
    let acortado = false;
    let audio: SpokenAudio;
    let id: string;
    try {
      audio = await voice.synthesize(guionHablado(guion, decision.cifra), voz);
      // The guion de bienvenida is fixed: if it ever runs long it goes out as it is.
      if (!bienvenida && audio.durationSeconds > MAX_AUDIO_SECONDS) {
        ({ guion, source } = await redactarGuion({
          llm,
          decision,
          recordDecision,
          acortar: { guion, durationSeconds: audio.durationSeconds },
        }));
        acortado = true;
        audio = await voice.synthesize(guionHablado(guion, decision.cifra), voz);
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

    if (bienvenida) await sendPermitir(cita);
    else await sendImagen(cita, decision.cifra);
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
