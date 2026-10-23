import type { MensajeInput } from "../escalera/respuesta";
import type { EtapaMove } from "../escalera/policy";
import type { Store } from "../patricia/store";
import type { Llm, Voice, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";
import type { InboundMensaje } from "./webhook";

/**
 * What happens to a message Patricia sent once the webhook has taken it in.
 *
 * A text and an emoji follow the flujo normal: the clasificador de intención
 * reads them and the política de etapa decides, which is `receiveMensaje` in
 * `src/escalera/respuesta.ts`. A nota de voz is transcribed and its transcript
 * takes the same flujo normal. A foto has no reading yet (#51), so it is kept
 * unread: the entrante is still there, with no intención, and so is its line
 * in the registro de decisiones.
 *
 * It answers nothing, except when a nota de voz cannot be transcribed: then it
 * is kept unread too, and Luna asks calmly for an emoji instead.
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
  /** Downloads a nota de voz and sends the answer when it cannot be heard. */
  whatsapp: WhatsApp;
  voice: Voice;
  /** The validador's tone review of that answer. */
  llm: Llm;
};

/** Stands in for a nota de voz Luna could not transcribe. */
export const NOTA_DE_VOZ_SIN_TRANSCRIBIR = "[nota de voz, todavía no se transcribe]";

/** What Luna answers when she could not hear a nota de voz: no reproach, just an easier way to answer. */
export const NOTA_DE_VOZ_NO_ESCUCHADA =
  "No alcancé a escuchar bien tu nota de voz. Si quieres, respóndeme con un emoji: 👍 si vas bien, 👎 si hoy no.";

/** Stands in for a foto until reading one lands (#51). */
export const FOTO_SIN_LEER = "[foto, todavía no se lee]";

/** Stands in for any message kind Luna has no reading for. */
export const MENSAJE_NO_ENTENDIDO = "[mensaje que Luna todavía no entiende]";

/**
 * Takes in one message Patricia sent: what Luna can read goes through the
 * flujo normal, and what she cannot is kept unread.
 */
export async function receiveInbound(deps: InboundDeps, mensaje: InboundMensaje): Promise<void> {
  const { whatsappId, from, body } = mensaje;

  /** Keeps an unread entrante and its line in the registro as one unit. */
  const recordUnread = (text: string, motivo: string, datos: object): void => {
    deps.inTransaction(() => {
      deps.store.addMensajeEntrante({ text, intencion: null, whatsappId });
      deps.store.recordDecision({ tipo: "mensaje", motivo, datos: { whatsappId, from, ...datos } });
    });
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
        const media = await deps.whatsapp.downloadMedia(body.mediaId);
        transcript = (await deps.voice.transcribe(media.bytes, media.mimeType || body.mimeType || "audio/ogg")).trim();
        if (transcript === "") throw new Error("the transcript is empty");
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        console.error(`whatsapp: nota de voz ${body.mediaId} could not be transcribed: ${error}`);
        recordUnread(
          NOTA_DE_VOZ_SIN_TRANSCRIBIR,
          `entrante: ${NOTA_DE_VOZ_SIN_TRANSCRIBIR} (no se pudo transcribir: ${error})`,
          { kind: body.kind, mediaId: body.mediaId, mimeType: body.mimeType, error },
        );
        await answerNotaNoEscuchada(deps);
        return;
      }
      await deps.mensaje({ text: transcript, whatsappId, arrival: { from, kind: body.kind } });
      return;
    }
    case "image": {
      recordUnread(FOTO_SIN_LEER, `entrante: ${FOTO_SIN_LEER}`, {
        kind: body.kind,
        mediaId: body.mediaId,
        mimeType: body.mimeType,
      });
      return;
    }
    case "other": {
      recordUnread(MENSAJE_NO_ENTENDIDO, `entrante: ${MENSAJE_NO_ENTENDIDO} (tipo ${body.type})`, {
        kind: body.kind,
        type: body.type,
      });
      return;
    }
  }
}

/**
 * Asks for an emoji by WhatsApp text and logs it. Not stored as a
 * MensajeSaliente: that list holds the citas, and a 👍 to this answer must not
 * count as answering one.
 */
async function answerNotaNoEscuchada(deps: InboundDeps): Promise<void> {
  const { store, llm, whatsapp } = deps;
  const draft = NOTA_DE_VOZ_NO_ESCUCHADA;
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
    console.error("Could not send the answer to Patricia's nota de voz", cause);
    return;
  }

  store.recordDecision({
    tipo: "mensaje",
    motivo: "pidió un emoji porque no pudo escuchar la nota de voz",
    datos: { text: validated.text, source: validated.source, whatsappId },
  });
}
