/** Tells Patricia the pago mínimo when she asks Luna to read the estado de cuenta. */

import { payoff } from "../figures/payoff";
import type { Cita, Decision, MensajeEntrante } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Intencion } from "../escalera/policy";
import { lastAnswerAt } from "../escalera/preguntas";
import type { Llm, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";
import { montoEnPantalla } from "../voz/montos";
import { isMadrugada } from "../whatsapp-cloud";

type TeLoCuentoDeps = { store: Store; llm: Llm; whatsapp: WhatsApp };

function citaPendiente(store: Store): Cita | null {
  if (store.getPatricia().etapa !== "graduada") return null;

  const mensaje = store.mensajesSalientes().findLast((m) => m.kind !== "image");
  if (mensaje === undefined) return null;

  const cita = store.citas().find((candidate) => candidate.mensajeSalienteId === mensaje.id);
  if (cita?.tipo !== "graduada") return null;

  const answeredAt = lastAnswerAt(store);
  if (answeredAt !== null && answeredAt.getTime() >= mensaje.sentAt.getTime()) return null;
  if (store.decisions().some((decision) => decision.tipo === "contar-estado-de-cuenta" && citaIdOf(decision) === cita.id)) {
    return null;
  }

  return cita;
}

function citaIdOf(decision: Decision): number | null {
  const { datos } = decision;
  if (typeof datos !== "object" || datos === null || !("citaId" in datos)) return null;
  return typeof datos.citaId === "number" ? datos.citaId : null;
}

/** Whether Luna is waiting for Patricia's answer to the latest graduada cita. */
export function esperaQueLeCuente(store: Store): boolean {
  return citaPendiente(store) !== null;
}

/** Fixed message with the pago mínimo of the latest bank estado de cuenta. */
export function textoPagoMinimo(nombre: string, monto: number): string {
  return `Te lo cuento, ${nombre}: en tu último estado de cuenta, el pago mínimo es ${montoEnPantalla(monto)}. Lo que pongas sobre el mínimo lo decides tú, con calma.`;
}

/** Fixed message for when no bank estado de cuenta with figures has arrived yet. */
export function textoSinEstadoDeCuenta(nombre: string): string {
  return `Te lo cuento, ${nombre}: todavía no me llega tu estado de cuenta. Cuando llegue, te lo cuento.`;
}

/** Stores whose pago mínimo is being sent, so a second 👌 meanwhile sends nothing. */
const telling = new WeakSet<Store>();

/** Handles an answer to the graduada cita, using the pre-classification pending state. */
export async function answerTeLoCuento(
  deps: TeLoCuentoDeps,
  mensaje: MensajeEntrante,
  intencion: Intencion,
  esperaba: boolean,
): Promise<boolean> {
  const { store } = deps;
  if (intencion.kind !== "listened" || !esperaba || store.getPatricia().enPausa || isMadrugada(mensaje.receivedAt)) {
    return false;
  }

  const cita = citaPendiente(store);
  if (cita === null) return false;
  if (telling.has(store)) return true;
  telling.add(store);
  try {
    await tell(deps, mensaje, cita);
  } finally {
    telling.delete(store);
  }
  return true;
}

async function tell(deps: TeLoCuentoDeps, mensaje: MensajeEntrante, cita: Cita): Promise<void> {
  const { store, llm, whatsapp } = deps;

  const estado = store.estadosDeCuenta().findLast((candidate) => candidate.origen === "banco" && candidate.cifras !== null);
  const monto = estado?.cifras ? payoff(estado.cifras, 0, cita.fecha).firstMinimum : null;
  const draft = monto === null ? textoSinEstadoDeCuenta(store.getPatricia().nombre) : textoPagoMinimo(store.getPatricia().nombre, monto);
  const validated = await validateText({
    draft,
    allowedFigures: monto === null ? [] : [monto],
    llm,
    redraft: async () => draft,
    safeTemplate: SAFE_TEMPLATE,
    recordDecision: (decision) => store.recordDecision({ tipo: "mensaje", motivo: decision.reason, datos: decision.input }),
  });

  let whatsappId: string;
  try {
    ({ id: whatsappId } = await whatsapp.send({ kind: "text", text: validated.text }));
  } catch (error) {
    console.error("could not tell Patricia the pago mínimo", error);
    return;
  }

  // The plantilla segura tells her nothing, so the cita still waits for her answer.
  if (validated.source === "safe-template") return;
  store.recordDecision({
    tipo: "contar-estado-de-cuenta",
    motivo: "le contó el estado de cuenta del mes: graduada",
    datos: {
      citaId: cita.id,
      text: validated.text,
      whatsappId,
      source: validated.source,
      mensajeId: mensaje.id,
    },
  });
}
