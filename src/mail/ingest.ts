import type { Senal } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail } from "../ports";
import { clasificarPorReglas } from "./reglas";
import { remitentePermitido } from "./remitentes";

/**
 * The single entry every mail source ends in: Gmail, the fake and the /demo
 * injection. Turns a mail into at most one señal and records why. Null when
 * the sender is not allowed; the señal already stored when the mail was seen.
 */
export function recibirCorreo(store: Store, mail: IncomingMail): Senal | null {
  if (remitentePermitido(mail.from) === null) return null;
  const existente = store.senalForMail(mail.id);
  if (existente !== null) return existente;

  // Ticket #26 asks the LLM when the rules cannot tell.
  const clasificacion = clasificarPorReglas(mail) ?? {
    tipo: "ignorado" as const,
    motivo: "Las reglas no supieron clasificar el correo por su remitente y asunto.",
  };
  const origen = { mailId: mail.id, from: mail.from, subject: mail.subject };
  // The señal goes first: a duplicate fails here and never reaches the decision log.
  const senal = store.addSenal({ tipo: clasificacion.tipo, origen });
  store.recordDecision({
    tipo: "senal",
    motivo: clasificacion.motivo,
    datos: { ...origen, tipo: clasificacion.tipo },
  });
  return senal;
}
