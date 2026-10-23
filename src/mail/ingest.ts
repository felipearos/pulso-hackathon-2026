import type { Senal } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail, Llm } from "../ports";
import { aporteDePedido, montoDePedido } from "../plata/apartado";
import { compraEnCuotas, esPlataDeCarino } from "../plata/cuotas";
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
  // An S5's monto tells whether she paid sobre el mínimo; the domingo reads it.
  const pago = classification.tipo === "S5" ? (montoDePedido(mail.subject) ?? montoDePedido(mail.text)) : null;
  // The señal goes first: a duplicate fails here and never reaches the decision log.
  const senal = store.addSenal({ tipo: classification.tipo, origen, monto: pedido?.monto ?? pago });
  // An S4 is only registered: no message goes out when it arrives; it may later end a buena noticia.
  const compra = classification.tipo === "S4" ? compraRegistrada(mail.subject, senal.receivedAt) : null;
  const extra = pedido?.motivo ?? compra?.motivo ?? null;
  store.recordDecision({
    tipo: "senal",
    motivo: extra === null ? classification.motivo : `${classification.motivo} ${extra}`,
    datos: {
      ...origen,
      tipo: classification.tipo,
      ...(pedido === null ? {} : { monto: pedido.monto, aporte: pedido.aporte }),
      ...(pago === null ? {} : { monto: pago }),
      ...(compra === null ? {} : compra.datos),
    },
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

/** What an S4 subject says about its compra en cuotas, for the decision log, and why. */
function compraRegistrada(
  subject: string,
  compradaEn: Date,
): { datos: { cuotas?: number; comercio?: string | null; plataDeCarino: boolean }; motivo: string } {
  const compra = compraEnCuotas(subject);
  const plataDeCarino = esPlataDeCarino(subject, compradaEn);
  const carino = plataDeCarino ? " Es diciembre y parece un regalo: queda como plata de cariño." : "";
  if (compra === null) {
    return {
      datos: { plataDeCarino },
      motivo: `El correo no dice en cuántas cuotas; Luna la anota igual y no le escribe por esto.${carino}`,
    };
  }
  const donde = compra.comercio === null ? "" : ` en ${compra.comercio}`;
  return {
    datos: { cuotas: compra.cuotas, comercio: compra.comercio, plataDeCarino },
    motivo: `Compra en ${compra.cuotas} ${compra.cuotas === 1 ? "cuota" : "cuotas"}${donde}; Luna la anota y no le escribe por esto.${carino}`,
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
