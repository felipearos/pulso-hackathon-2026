import { classifyIntencion } from "../escalera/classify";
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

export type InboundDeps = { store: Store; llm: Llm };

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
export async function recibirMensaje(deps: InboundDeps, mensaje: InboundMensaje): Promise<void> {
  const { whatsappId, from, body } = mensaje;
  switch (body.kind) {
    case "text": {
      const intencion = await classifyIntencion(body.text, deps.llm);
      deps.store.addMensajeEntrante({ text: body.text, intencion, whatsappId });
      deps.store.recordDecision({
        tipo: "mensaje",
        motivo: `entrante: «${body.text}» leído como ${intencion.kind}`,
        datos: { whatsappId, from, text: body.text, intencion },
      });
      return;
    }
    case "audio":
    case "image": {
      const text = body.kind === "audio" ? NOTA_DE_VOZ_SIN_TRANSCRIBIR : FOTO_SIN_LEER;
      deps.store.addMensajeEntrante({ text, intencion: null, whatsappId });
      deps.store.recordDecision({
        tipo: "mensaje",
        motivo: `entrante: ${text}`,
        datos: { whatsappId, from, kind: body.kind, mediaId: body.mediaId, mimeType: body.mimeType },
      });
      return;
    }
    case "other": {
      deps.store.addMensajeEntrante({ text: MENSAJE_NO_ENTENDIDO, intencion: null, whatsappId });
      deps.store.recordDecision({
        tipo: "mensaje",
        motivo: `entrante: ${MENSAJE_NO_ENTENDIDO} (tipo ${body.type})`,
        datos: { whatsappId, from, kind: body.kind, type: body.type },
      });
      return;
    }
  }
}
