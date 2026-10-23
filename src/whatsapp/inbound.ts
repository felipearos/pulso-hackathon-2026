import { classifyIntencion } from "../escalera/classify";
import type { Intencion } from "../escalera/policy";
import type { Store } from "../patricia/store";
import type { Llm } from "../ports";
import type { InboundMensaje } from "./webhook";

/**
 * What happens to a message Patricia sent once the webhook has taken it in. Her
 * writing back is the signal the escalera runs on, so every message is kept as
 * an entrante, with its intención when Luna can read it, and leaves a line in
 * the registro de decisiones that the team and the jury can follow.
 *
 * It does not move the etapa and does not answer: it records and returns.
 */

export type InboundDeps = {
  store: Store;
  llm: Llm;
  /**
   * Runs the writes of one message as a unit. The entrante and its line in the
   * registro de decisiones land together or not at all, as a señal and its
   * decision already do.
   */
  inTransaction<T>(write: () => T): T;
};

/**
 * How each intención reads in the registro de decisiones, in the words
 * GLOSSARY.md fixes for it: the operator and the jury read this log.
 */
const INTENCION_EN_PALABRAS: Record<Intencion["kind"], string> = {
  listened: "escuchó",
  accepted: "acepta",
  installmentPurchase: "compra en cuotas",
  minimum: "mínimo",
  angustia: "angustia",
  doesNotWantToSee: "no quiere ver",
  pause: "pausa",
  hello: "hola",
  askWhy: "pregunta por qué",
  askWhatRead: "qué leíste",
  crisis: "crisis",
  other: "otra",
};

/** Stands in for a nota de voz until transcribing one lands (#50). */
export const NOTA_DE_VOZ_SIN_TRANSCRIBIR = "[nota de voz, todavía no se transcribe]";

/** Stands in for a foto until reading one lands (#51). */
export const FOTO_SIN_LEER = "[foto, todavía no se lee]";

/** Stands in for any message kind Luna has no reading for. */
export const MENSAJE_NO_ENTENDIDO = "[mensaje que Luna todavía no entiende]";

/**
 * Takes in one message Patricia sent: classifies it and leaves it, with its
 * intención, in her entrantes plus the registro de decisiones.
 */
export async function receiveMensaje(deps: InboundDeps, mensaje: InboundMensaje): Promise<void> {
  const { whatsappId, from, body } = mensaje;

  /** Writes the entrante and its line in the registro as one unit. */
  const record = (text: string, intencion: Intencion | null, motivo: string, datos: object): void => {
    deps.inTransaction(() => {
      deps.store.addMensajeEntrante({ text, intencion, whatsappId });
      deps.store.recordDecision({ tipo: "mensaje", motivo, datos: { whatsappId, from, ...datos } });
    });
  };

  switch (body.kind) {
    // An emoji she types and an emoji she reacts with mean the same thing, so
    // both go through the clasificador de intención.
    case "text":
    case "reaction": {
      const text = body.kind === "text" ? body.text : body.emoji;
      const comoLlego = body.kind === "text" ? "escribió" : "reaccionó con";
      const intencion = await classifyIntencion(text, deps.llm);
      record(
        text,
        intencion,
        `entrante: ${comoLlego} «${text}», se leyó como ${INTENCION_EN_PALABRAS[intencion.kind]}`,
        body.kind === "text" ? { text, intencion } : { emoji: text, toWhatsappId: body.toWhatsappId, intencion },
      );
      return;
    }
    case "audio":
    case "image": {
      const text = body.kind === "audio" ? NOTA_DE_VOZ_SIN_TRANSCRIBIR : FOTO_SIN_LEER;
      record(text, null, `entrante: ${text}`, {
        kind: body.kind,
        mediaId: body.mediaId,
        mimeType: body.mimeType,
      });
      return;
    }
    case "other": {
      record(MENSAJE_NO_ENTENDIDO, null, `entrante: ${MENSAJE_NO_ENTENDIDO} (tipo ${body.type})`, {
        kind: body.kind,
        type: body.type,
      });
      return;
    }
  }
}
