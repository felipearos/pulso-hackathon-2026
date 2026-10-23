/** A warm, one-time proposal when Patricia mentions a compra en cuotas. */

import type { Intencion } from "../escalera/policy";
import { santiagoDate } from "../clock/santiago";
import type { MensajeEntrante } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText, type ValidatedText } from "../validator/validator";
import { isMadrugada } from "../whatsapp-cloud";

export const PROPUESTA_VERLO_MANANA =
  "Te escucho, Patricia. ¿Y si lo vemos mañana en la noche, con calma? Si mañana lo sigues queriendo, lo decides tú.";
export const RESPUESTA_CUIDADO = "Claro, Patricia, eso va primero. Aquí estoy si me necesitas.";

type PurchaseReplyDeps = { store: Store; llm: Llm; whatsapp: WhatsApp };
type SentText = ValidatedText & { whatsappId: string };

/** A pending proposal stays open through the next Santiago calendar day. */
function nextSantiagoDay(day: string): string {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function proposalIsOpen(store: Store, receivedAt: Date): boolean {
  const proposal = store.decisions().filter((decision) => decision.tipo === "proponer-verlo-manana").at(-1);
  if (proposal === undefined) return false;
  const proposalDay = santiagoDate(proposal.at);
  const receivedDay = santiagoDate(receivedAt);
  return receivedDay >= proposalDay && receivedDay <= nextSantiagoDay(proposalDay);
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function mentionsCare(text: string): boolean {
  return /(?:^|[^\p{L}\p{N}])(?:remedios?|medicamentos?|farmacia|mama|mami)(?=$|[^\p{L}\p{N}])/u.test(
    normalize(text),
  );
}

async function sendFixedText(
  deps: PurchaseReplyDeps,
  draft: string,
  errorMessage: string,
): Promise<SentText | null> {
  const { store, llm, whatsapp } = deps;
  const validated = await validateText({
    draft,
    allowedFigures: [],
    llm,
    redraft: async () => draft,
    safeTemplate: SAFE_TEMPLATE,
    recordDecision: (decision) =>
      store.recordDecision({ tipo: "mensaje", motivo: decision.reason, datos: decision.input }),
  });

  try {
    const { id: whatsappId } = await whatsapp.send({ kind: "text", text: validated.text });
    return { ...validated, whatsappId };
  } catch (error) {
    console.error(errorMessage, error);
    return null;
  }
}

/** Stores a propuesta is being sent for, so a second cuotas message meanwhile proposes nothing. */
const proposing = new WeakSet<Store>();

/** Handles a cuotas purchase, or leaves it to the other reply paths. */
export async function answerCompraEnCuotas(
  deps: PurchaseReplyDeps,
  mensaje: MensajeEntrante,
  intencion: Intencion,
): Promise<boolean> {
  if (intencion.kind !== "installmentPurchase") return false;
  if (isMadrugada(mensaje.receivedAt) || deps.store.getPatricia().enPausa) return false;

  const { store } = deps;
  if (mentionsCare(mensaje.text)) {
    const sent = await sendFixedText(deps, RESPUESTA_CUIDADO, "could not send the care reply about a cuotas purchase");
    if (sent !== null) {
      store.recordDecision({
        tipo: "acompanar-compra",
        motivo: "compra para un remedio o su mamá: sin propuesta",
        datos: {
          text: sent.text,
          whatsappId: sent.whatsappId,
          source: sent.source,
          mensajeId: mensaje.id,
        },
      });
    }
    return true;
  }

  if (proposalIsOpen(store, mensaje.receivedAt)) return true;

  if (proposing.has(store)) return true;
  proposing.add(store);
  try {
    const sent = await sendFixedText(
      deps,
      PROPUESTA_VERLO_MANANA,
      "could not send the proposal to see a cuotas purchase tomorrow",
    );
    if (sent !== null) {
      store.recordDecision({
        tipo: "proponer-verlo-manana",
        motivo: "propone ver la compra en cuotas mañana en la noche",
        datos: {
          text: sent.text,
          whatsappId: sent.whatsappId,
          source: sent.source,
          mensajeId: mensaje.id,
        },
      });
    }
  } finally {
    proposing.delete(store);
  }
  return true;
}
