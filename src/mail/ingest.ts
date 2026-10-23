import type { Senal } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail } from "../ports";
import { aporteDePedido, montoDePedido } from "../plata/apartado";
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
  const monto = classification.tipo === "S3" ? (montoDePedido(mail.subject) ?? montoDePedido(mail.text)) : null;
  // The señal goes first: a duplicate fails here and never reaches the decision log.
  const senal = store.addSenal({ tipo: classification.tipo, origen, monto });
  store.recordDecision({
    tipo: "senal",
    motivo: classification.tipo === "S3" ? `${classification.motivo} ${motivoDelAporte(monto)}` : classification.motivo,
    datos: {
      ...origen,
      tipo: classification.tipo,
      ...(classification.tipo === "S3" ? { monto, aporte: monto === null ? 0 : aporteDePedido(monto) } : {}),
    },
  });
  return senal;
}

function motivoDelAporte(monto: number | null): string {
  if (monto === null) return "El correo no dice el monto del pedido, así que no suma a la plata apartada.";
  return `El pedido fue de ${monto} pesos; su 10 % (${aporteDePedido(monto)}) suma a la plata apartada de la semana.`;
}
