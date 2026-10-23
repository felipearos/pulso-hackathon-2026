import type { IncomingMail } from "../ports";
import type { TipoSenal } from "../patricia/entities";
import { allowedSender, type SenderKind } from "./senders";

export type Classification = { tipo: TipoSenal; motivo: string };

type Rule = {
  senders: SenderKind[];
  /** Phrases looked for in the subject, lowercase and without accents. */
  phrases: string[];
  tipo: TipoSenal;
};

// First match wins.
const RULES: Rule[] = [
  { senders: ["banco", "tienda"], phrases: ["recibimos tu pago"], tipo: "S5" },
  { senders: ["banco"], phrases: ["estado de cuenta"], tipo: "S1" },
  { senders: ["tienda"], phrases: ["estado de cuenta"], tipo: "S2" },
  { senders: ["banco", "tienda"], phrases: ["cuotas"], tipo: "S4" },
  { senders: ["banco", "tienda"], phrases: ["vencimiento", "vence"], tipo: "S6" },
  { senders: ["catalogo"], phrases: ["pagamos tu pedido", "pago de tu pedido", "pedido pagado"], tipo: "S3" },
];

const SENDER_NAME: Record<SenderKind, string> = {
  banco: "del banco",
  tienda: "de la tienda",
  catalogo: "del catálogo",
};

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function mentions(subject: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase}\\b`).test(subject);
}

/**
 * Classifies a mail from an allowed sender by its subject alone. Null when the
 * sender is not allowed or the rules cannot tell.
 */
export function classifyByRules(mail: Pick<IncomingMail, "from" | "subject">): Classification | null {
  const sender = allowedSender(mail.from);
  if (sender === null) return null;
  const subject = normalize(mail.subject);
  for (const rule of RULES) {
    if (!rule.senders.includes(sender.kind)) continue;
    const phrase = rule.phrases.find((f) => mentions(subject, f));
    if (phrase === undefined) continue;
    return {
      tipo: rule.tipo,
      motivo: `Remitente ${SENDER_NAME[sender.kind]} y el asunto dice «${phrase}».`,
    };
  }
  if (sender.kind === "catalogo") {
    return {
      tipo: "ignorado",
      motivo: "Remitente del catálogo y el asunto no habla de un pedido pagado.",
    };
  }
  return null;
}
