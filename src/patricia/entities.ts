/**
 * Patricia's entities: the contracts every ticket programs against. The store
 * persists them in SQLite; every timestamp in them comes from the demo clock
 * (ADR 0002).
 */

import type { Etapa, Intencion } from "../escalera/policy";
import type { Statement } from "../figures/payoff";

export type { Etapa, Intencion };

/** What kind of mail a señal is. */
export type TipoSenal =
  /** Estado de cuenta del banco. */
  | "S1"
  /** Estado de cuenta de la tienda. */
  | "S2"
  /** Pago de un pedido del catálogo. */
  | "S3"
  /** Compra en cuotas. */
  | "S4"
  /** «Recibimos tu pago». */
  | "S5"
  /** Aviso de vencimiento. */
  | "S6"
  /** Correo sospechoso. */
  | "S7"
  /** A mail that says nothing about her accounts. */
  | "ignorado";

/** A señal read from her mail; not the policy's `Senal`, which is an intención answering a cita. */
export type Senal = {
  id: number;
  tipo: TipoSenal;
  /** The mail it came from. */
  origen: { mailId: string; from: string; subject: string };
  receivedAt: Date;
};

/** One estado de cuenta, from the bank or from a store. */
export type EstadoDeCuenta = {
  id: number;
  origen: "banco" | "tienda";
  /** Billing cycle number, as the issuer counts them. */
  ciclo: number;
  /** `YYYY-MM-DD`; null when the mail did not say. */
  fechaCierre: string | null;
  /** `YYYY-MM-DD`; null when the mail did not say. */
  fechaVencimiento: string | null;
  /** The figures the payoff engine needs; null until extracted. */
  cifras: Statement | null;
  pagoMinimo: number | null;
  receivedAt: Date;
};

/** A message sent to Patricia on WhatsApp. */
export type MensajeSaliente = {
  id: number;
  kind: "text" | "audio" | "image";
  /** The text, the script of an audio or the caption of an image. */
  text: string | null;
  /** Length of an audio; null for text and images. */
  durationSeconds: number | null;
  /** Meta's message id; null if it was never accepted. */
  whatsappId: string | null;
  sentAt: Date;
};

/** A message Patricia sent on WhatsApp. */
export type MensajeEntrante = {
  id: number;
  text: string;
  /** What the LLM classified it as; null until classified. */
  intencion: Intencion | null;
  whatsappId: string | null;
  receivedAt: Date;
};

/** Patricia herself. There is exactly one. */
export type Patricia = {
  nombre: string;
  /** The voice id she hears; null for the default. */
  voz: string | null;
  /** She allowed Luna to read her Gmail. */
  gmailPermitido: boolean;
  etapa: Etapa;
  /** The name she gave the bolsillo; null until she names it. */
  bolsillo: string | null;
  enPausa: boolean;
};

/** One row of her etapa history. */
export type EtapaCambio = {
  at: Date;
  /** Null for the first etapa she was placed in. */
  from: Etapa | null;
  to: Etapa;
  motivo: string;
};

/** What kind of decision Luna took. */
export type TipoDecision =
  /** She moved up the escalera. */
  | "subir-etapa"
  /** She moved back down the escalera. */
  | "bajar-etapa"
  /** She stays in her etapa. */
  | "quedarse"
  /** Luna chose not to speak tonight. */
  | "callar"
  /** Luna moved a cita to later. */
  | "diferir"
  /** Luna proposed setting plata apartada. */
  | "proponer-plata-apartada"
  /** A mail was classified into a señal. */
  | "senal"
  /** A message was sent or received. */
  | "mensaje";

/** One entry of the append-only decision log. */
export type Decision = {
  id: number;
  at: Date;
  tipo: TipoDecision;
  /** In Spanish, readable by the team and the jury. */
  motivo: string;
  /** The input the decision was taken on, stored as JSON. */
  datos: unknown;
};
