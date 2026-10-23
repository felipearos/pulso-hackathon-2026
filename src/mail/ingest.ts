import type { Senal } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail } from "../ports";
import { aporteDePedido, montoDePedido } from "../plata/apartado";
import { montoEnPantalla } from "../voz/montos";
import { classifyByRules } from "./rules";
import { allowedSender } from "./senders";

/**
 * The single entry every mail source ends in: Gmail, the fake and the /demo
 * injection. Turns a mail into at most one señal and records why. Null when
 * the sender is not allowed; the señal already stored when the mail was seen.
 */
export function receiveMail(store: Store, mail: IncomingMail): Senal | null {
  if (allowedSender(mail.from) === null) return null;
  const existing = store.senalForMail(mail.id);
  if (existing !== null) return existing;

  // Ticket #26 asks the LLM when the rules cannot tell.
  const classification = classifyByRules(mail) ?? {
    tipo: "ignorado" as const,
    motivo: "Las reglas no supieron clasificar el correo por su remitente y asunto.",
  };
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
