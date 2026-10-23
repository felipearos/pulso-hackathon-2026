import type { Senal } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail, Llm } from "../ports";
import { aporteDePedido, montoDePedido } from "../plata/apartado";
import { montoEnPantalla } from "../voz/montos";
import { classifyByLlm } from "./llm-classify";
import { classifyByRules, type Classification } from "./rules";
import { allowedSender } from "./senders";
import { suspiciousReason } from "./suspicious";

/** Classifies a mail safely, using the LLM only when the rules cannot tell. */
export async function classifyMail(mail: IncomingMail, llm: Llm): Promise<Classification> {
  const suspicious = suspiciousReason(mail);
  if (suspicious !== null) return { tipo: "S7", motivo: suspicious };

  const byRules = classifyByRules(mail);
  if (byRules !== null) return byRules;

  const byLlm = await classifyByLlm(mail, llm);
  return byLlm ?? {
    tipo: "ignorado",
    motivo: "Las reglas no alcanzaron y Claude no supo clasificarlo con confianza.",
  };
}

/** Stores one mail as a señal and records why. */
export function storeMail(store: Store, mail: IncomingMail, classification: Classification): Senal {
  const existing = store.senalForMail(mail.id);
  if (existing !== null) return existing;

  const origen = { mailId: mail.id, from: mail.from, subject: mail.subject };
  // An S3 quietly puts aside 10 % of its pedido; Luna says nothing about it.
  const pedido = classification.tipo === "S3" ? pedidoPagado(mail) : null;
  // The señal goes first: a duplicate fails here and never reaches the decision log.
  const senal = store.addSenal({ tipo: classification.tipo, origen, monto: pedido?.monto ?? null });
  store.recordDecision({
    tipo: "senal",
    motivo: pedido === null ? classification.motivo : `${classification.motivo} ${pedido.motivo}`,
    datos: { ...origen, tipo: classification.tipo, ...(pedido === null ? {} : { monto: pedido.monto, aporte: pedido.aporte }) },
  });
  return senal;
}

/** The monto of a paid pedido, from the subject or else the body, with its aporte and why. */
function pedidoPagado(mail: IncomingMail): { monto: number | null; aporte: number; motivo: string } {
  const monto = montoDePedido(mail.subject) ?? montoDePedido(mail.text);
  if (monto === null) {
    return { monto, aporte: 0, motivo: "El correo no dice el monto del pedido, así que no suma a la plata apartada." };
  }
  const aporte = aporteDePedido(monto);
  return {
    monto,
    aporte,
    motivo: `El pedido fue de ${montoEnPantalla(monto)}; su 10 % (${montoEnPantalla(aporte)}) suma a la plata apartada de la semana.`,
  };
}

/**
 * The single entry every mail source ends in: Gmail, the fake and the /demo
 * injection. Turns a mail into at most one señal and records why. Null when
 * the sender is not allowed; the señal already stored when the mail was seen.
 */
export async function receiveMail(
  store: Store,
  llm: Llm,
  mail: IncomingMail,
  transaction: <T>(fn: () => T) => T,
): Promise<Senal | null> {
  if (allowedSender(mail.from) === null) return null;
  const existing = store.senalForMail(mail.id);
  if (existing !== null) return existing;

  const classification = await classifyMail(mail, llm);
  return transaction(() => storeMail(store, mail, classification));
}
