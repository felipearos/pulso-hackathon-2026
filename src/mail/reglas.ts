import type { IncomingMail } from "../ports";
import type { TipoSenal } from "../patricia/entities";
import { remitentePermitido, type TipoRemitente } from "./remitentes";

export type Clasificacion = { tipo: TipoSenal; motivo: string };

type Regla = {
  remitentes: TipoRemitente[];
  /** Phrases looked for in the subject, lowercase and without accents. */
  frases: string[];
  tipo: TipoSenal;
};

// First match wins.
const REGLAS: Regla[] = [
  { remitentes: ["banco", "tienda"], frases: ["recibimos tu pago"], tipo: "S5" },
  { remitentes: ["banco"], frases: ["estado de cuenta"], tipo: "S1" },
  { remitentes: ["tienda"], frases: ["estado de cuenta"], tipo: "S2" },
  { remitentes: ["banco", "tienda"], frases: ["cuotas"], tipo: "S4" },
  { remitentes: ["banco", "tienda"], frases: ["vencimiento", "vence"], tipo: "S6" },
  { remitentes: ["catalogo"], frases: ["pagamos tu pedido", "pago de tu pedido", "pedido pagado"], tipo: "S3" },
];

const NOMBRE: Record<TipoRemitente, string> = {
  banco: "del banco",
  tienda: "de la tienda",
  catalogo: "del catálogo",
};

function normalizar(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function contiene(asunto: string, frase: string): boolean {
  return new RegExp(`\\b${frase}\\b`).test(asunto);
}

/**
 * Classifies a mail from an allowed sender by its subject alone. Null when the
 * sender is not allowed or the rules cannot tell.
 */
export function clasificarPorReglas(mail: Pick<IncomingMail, "from" | "subject">): Clasificacion | null {
  const remitente = remitentePermitido(mail.from);
  if (remitente === null) return null;
  const asunto = normalizar(mail.subject);
  for (const regla of REGLAS) {
    if (!regla.remitentes.includes(remitente.tipo)) continue;
    const frase = regla.frases.find((f) => contiene(asunto, f));
    if (frase === undefined) continue;
    return {
      tipo: regla.tipo,
      motivo: `Remitente ${NOMBRE[remitente.tipo]} y el asunto dice «${frase}».`,
    };
  }
  if (remitente.tipo === "catalogo") {
    return {
      tipo: "ignorado",
      motivo: "Remitente del catálogo y el asunto no habla de un pedido pagado.",
    };
  }
  return null;
}
