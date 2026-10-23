import type { MensajeInput } from "../escalera/respuesta";
import type { EtapaMove } from "../escalera/policy";
import { answerMadrugada } from "../escalera/respuesta-madrugada";
import { type CifrasExtraidas, extractCifrasDeFoto } from "../figures/extractor";
import type { Store } from "../patricia/store";
import type { Llm, Voice, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";
import { montoEnPantalla } from "../voz/montos";
import { isMadrugada } from "../whatsapp-cloud";
import type { InboundMensaje } from "./webhook";

/**
 * What happens to a message Patricia sent once the webhook has taken it in.
 *
 * A text and an emoji follow the flujo normal: the clasificador de intención
 * reads them and the política de etapa decides, which is `receiveMensaje` in
 * `src/escalera/respuesta.ts`. A nota de voz is transcribed and its transcript
 * takes the same flujo normal. A foto is read with Claude's vision and its
 * cifras go into the flujo normal with a stand-in text, where Luna compares its
 * pago mínimo with the estado de cuenta she has.
 *
 * It answers nothing, except when a nota de voz cannot be transcribed or a foto
 * cannot be read: then it is kept unread, with no intención but with its line
 * in the registro de decisiones, and Luna answers calmly with an easier way.
 * In the madrugada any unread message gets the madrugada note instead.
 */

export type InboundDeps = {
  store: Store;
  /** The flujo normal for anything Luna can read. */
  mensaje(input: MensajeInput): Promise<EtapaMove>;
  /**
   * Runs the writes of one message as a unit. The entrante and its line in the
   * registro de decisiones land together or not at all, as a señal and its
   * decision already do.
   */
  inTransaction<T>(write: () => T): T;
  /** Downloads a nota de voz or a foto and sends the answer when it cannot be heard or read. */
  whatsapp: WhatsApp;
  voice: Voice;
  /** Reads a foto, and the validador's tone review of that answer. */
  llm: Llm;
};

/** Stands in for a nota de voz Luna could not transcribe. */
export const NOTA_DE_VOZ_SIN_TRANSCRIBIR = "[nota de voz que no se pudo escuchar]";

/** What Luna answers when she could not hear a nota de voz: no reproach, just an easier way to answer. */
export const NOTA_DE_VOZ_NO_ESCUCHADA =
  "No alcancé a escuchar bien tu nota de voz. Si quieres, respóndeme con un emoji: 👍 si te parece, 👌 si solo la escuchaste.";

/** Stands in for a foto Luna could not read. */
export const FOTO_SIN_LEER = "[foto que no se pudo leer]";

/** What Luna answers when she could not read a foto, or found no pago mínimo on it. */
export const FOTO_NO_LEIDA = "No alcancé a ver bien tu foto. Si quieres, mándamela de nuevo, con más luz y mostrando el pago mínimo.";

/** Stands in, as the entrante, for a foto Luna read. */
export function textoFotoLeida(cifras: CifrasExtraidas): string {
  return cifras.pagoMinimo === null
    ? "[foto del estado de cuenta, sin pago mínimo legible]"
    : `[foto del estado de cuenta: pago mínimo ${montoEnPantalla(cifras.pagoMinimo)}]`;
}

/** Stands in for any message kind Luna has no reading for. */
export const MENSAJE_NO_ENTENDIDO = "[mensaje que Luna todavía no entiende]";

/**
 * Takes in one message Patricia sent: what Luna can read goes through the
 * flujo normal, and what she cannot is kept unread.
 */
export async function receiveInbound(deps: InboundDeps, mensaje: InboundMensaje): Promise<void> {
  const { whatsappId, from, body } = mensaje;

  /** Keeps an unread entrante and its line in the registro as one unit; returns when it arrived. */
  const recordUnread = (text: string, motivo: string, datos: object): Date =>
    deps.inTransaction(() => {
      const entrante = deps.store.addMensajeEntrante({ text, intencion: null, whatsappId });
      deps.store.recordDecision({ tipo: "mensaje", motivo, datos: { whatsappId, from, ...datos } });
      return entrante.receivedAt;
    });

  /** In the madrugada the madrugada note replaces the daytime answer; nothing during a pausa. */
  const answerUnread = async (text: string, now: Date, daytime?: () => Promise<void>): Promise<void> => {
    if (!isMadrugada(now)) {
      await daytime?.();
      return;
    }
    if (deps.store.getPatricia().enPausa) return;
    await answerMadrugada(deps, { text, whatsappId, now });
  };

  switch (body.kind) {
    // An emoji she types and an emoji she reacts with mean the same thing, so
    // both take the same way in as a text.
    case "text":
    case "reaction": {
      const text = body.kind === "text" ? body.text : body.emoji;
      const arrival =
        body.kind === "text"
          ? { from, kind: body.kind }
          : { from, kind: body.kind, toWhatsappId: body.toWhatsappId };
      await deps.mensaje({ text, whatsappId, arrival });
      return;
    }
    case "audio": {
      let transcript: string;
      try {
        const { whatsapp, voice } = deps;
        if (!whatsapp.downloadMedia || !voice.transcribe) throw new Error("the ports cannot download or transcribe a nota de voz");
        const media = await whatsapp.downloadMedia(body.mediaId);
        // Meta's own type on the webhook first: the download's may be a generic fallback.
        transcript = (await voice.transcribe(media.bytes, body.mimeType ?? media.mimeType)).trim();
        if (transcript === "") throw new Error("the transcript is empty");
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        console.error(`whatsapp: nota de voz ${body.mediaId} could not be transcribed: ${error}`);
        const now = recordUnread(
          NOTA_DE_VOZ_SIN_TRANSCRIBIR,
          `entrante: ${NOTA_DE_VOZ_SIN_TRANSCRIBIR} (no se pudo transcribir: ${error})`,
          { kind: body.kind, mediaId: body.mediaId, mimeType: body.mimeType, error },
        );
        await answerUnread(NOTA_DE_VOZ_SIN_TRANSCRIBIR, now, () => answerNotaNoEscuchada(deps));
        return;
      }
      await deps.mensaje({ text: transcript, whatsappId, arrival: { from, kind: body.kind } });
      return;
    }
    case "image": {
      let cifras: CifrasExtraidas;
      try {
        const { whatsapp, llm } = deps;
        if (!whatsapp.downloadMedia) throw new Error("the whatsapp port cannot download a foto");
        const media = await whatsapp.downloadMedia(body.mediaId);
        const read = await extractCifrasDeFoto({ bytes: media.bytes, mimeType: body.mimeType ?? media.mimeType }, llm);
        if (read === null) throw new Error("the extractor could not read it");
        cifras = read;
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        console.error(`whatsapp: foto ${body.mediaId} could not be read: ${error}`);
        const now = recordUnread(FOTO_SIN_LEER, `entrante: ${FOTO_SIN_LEER} (no se pudo leer: ${error})`, {
          kind: body.kind,
          mediaId: body.mediaId,
          mimeType: body.mimeType,
          error,
        });
        await answerUnread(FOTO_SIN_LEER, now, () => answerFotoNoLeida(deps));
        return;
      }
      await deps.mensaje({ text: textoFotoLeida(cifras), whatsappId, arrival: { from, kind: body.kind }, foto: { cifras } });
      return;
    }
    case "other": {
      const now = recordUnread(MENSAJE_NO_ENTENDIDO, `entrante: ${MENSAJE_NO_ENTENDIDO} (tipo ${body.type})`, {
        kind: body.kind,
        type: body.type,
      });
      await answerUnread(MENSAJE_NO_ENTENDIDO, now);
      return;
    }
  }
}

type AnswerDeps = { store: Store; llm: Llm; whatsapp: WhatsApp };

/**
 * Asks for an emoji by WhatsApp text and logs it. Not stored as a
 * MensajeSaliente: that list holds the citas, so the emoji she sends next
 * answers the latest cita, as the nota de voz would have. During a pausa Luna
 * sends nothing: she cannot tell whether the nota de voz ended it.
 */
async function answerNotaNoEscuchada(deps: AnswerDeps): Promise<void> {
  await answerCalmly(deps, {
    draft: NOTA_DE_VOZ_NO_ESCUCHADA,
    motivo: "pidió un emoji porque no pudo escuchar la nota de voz",
    what: "nota de voz",
  });
}

/**
 * Asks for the foto again when Luna could not read it, or found no pago
 * mínimo on it. Like the nota de voz answer, not a cita, and silent during
 * a pausa.
 */
export async function answerFotoNoLeida(deps: AnswerDeps): Promise<void> {
  await answerCalmly(deps, {
    draft: FOTO_NO_LEIDA,
    motivo: "pidió el pago mínimo por escrito porque no pudo leer la foto",
    what: "foto",
  });
}

/** Validates, sends and logs one answer whose wording is fixed by code; nothing during a pausa. */
async function answerCalmly(deps: AnswerDeps, answer: { draft: string; motivo: string; what: string }): Promise<void> {
  const { store, llm, whatsapp } = deps;
  if (store.getPatricia().enPausa) return;
  const { draft } = answer;
  const validated = await validateText({
    draft,
    allowedFigures: [],
    llm,
    // The answer is fixed by code; there is no other wording to try.
    redraft: async () => draft,
    safeTemplate: SAFE_TEMPLATE,
    recordDecision: (decision) => store.recordDecision({ tipo: "mensaje", motivo: decision.reason, datos: decision.input }),
  });

  let whatsappId: string;
  try {
    ({ id: whatsappId } = await whatsapp.send({ kind: "text", text: validated.text }));
  } catch (cause) {
    console.error(`Could not send the answer to Patricia's ${answer.what}`, cause);
    return;
  }

  store.recordDecision({
    tipo: "mensaje",
    motivo: answer.motivo,
    datos: { text: validated.text, source: validated.source, whatsappId },
  });
}
