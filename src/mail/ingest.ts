import type { Senal } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail } from "../ports";
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
  // The señal goes first: a duplicate fails here and never reaches the decision log.
  const senal = store.addSenal({ tipo: classification.tipo, origen });
  store.recordDecision({
    tipo: "senal",
    motivo: classification.motivo,
    datos: { ...origen, tipo: classification.tipo },
  });
  return senal;
}
