import type { MensajeInput } from "../escalera/respuesta";
import type { EtapaMove } from "../escalera/policy";
import type { Store } from "../patricia/store";
import type { InboundMensaje } from "./webhook";

/**
 * What happens to a message Patricia sent once the webhook has taken it in.
 *
 * A text and an emoji follow the flujo normal: the clasificador de intención
 * reads them and the política de etapa decides, which is `receiveMensaje` in
 * `src/escalera/respuesta.ts`. A nota de voz and a foto have no reading yet
 * (#50, #51), so they are kept unread: the entrante is still there, with no
 * intención, and so is its line in the registro de decisiones.
 *
 * It answers nothing: it records and returns.
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
};

/** Stands in for a nota de voz until transcribing one lands (#50). */
export const NOTA_DE_VOZ_SIN_TRANSCRIBIR = "[nota de voz, todavía no se transcribe]";

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
    case "audio":
    case "image": {
      const text = body.kind === "audio" ? NOTA_DE_VOZ_SIN_TRANSCRIBIR : FOTO_SIN_LEER;
      recordUnread(text, `entrante: ${text}`, {
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
