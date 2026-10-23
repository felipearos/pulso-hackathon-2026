/**
 * Patricia's entities: the contracts every ticket programs against. The store
 * persists them in SQLite; every timestamp in them comes from the demo clock
 * (ADR 0002).
 */

import type { Etapa, Intencion } from "../escalera/policy";
import type { CifrasExtraidas } from "../figures/extractor";
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
  /** What an S3's pedido del catálogo was paid, in pesos; null when unknown or not an S3. */
  monto: number | null;
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

/** What the extractor read from the mail an estado de cuenta came in. */
export type Extraccion = {
  id: number;
  estadoDeCuentaId: number;
  mailId: string;
  cifras: CifrasExtraidas;
  extractedAt: Date;
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
  /** The voz she chose in the bienvenida (`src/voice/voces.ts`); null for the principal one. */
  voz: string | null;
  /** The hora de la cita she answered in the bienvenida, `HH:MM`; null until she answers. */
  hora?: string | null;
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
  from: Etapa;
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
  /** A figure the extractor did not find or doubted: Luna keeps it to herself. */
  | "callar-cifra"
  /** Luna moved a cita, or the pendientes the madrugada holds back, to later. */
  | "diferir"
  /** Luna proposed setting plata apartada. */
  | "proponer-plata-apartada"
  /** A mail was classified into a señal. */
  | "senal"
  /** A message was sent or received. */
  | "mensaje"
  /** Luna set a cita for tonight. */
  | "programar-cita"
  /** Patricia chose between the propuesta and the mínimo, and Luna answered. */
  | "respuesta-propuesta"
  /** Luna asked once whether her bank lets Patricia have a bolsillo. */
  | "preguntar-bolsillo"
  /** Patricia answered whether her bank lets her have a bolsillo. */
  | "respuesta-bolsillo"
  /** Patricia named her bolsillo, which is how Luna calls the plata apartada. */
  | "nombrar-bolsillo"
  /** She went into pausa: she asked for it, or 14 days passed without a reply. */
  | "pausa"
  /** She came back from a pausa: the etapa she returns to and why. */
  | "vuelta"
  /** Patricia gave her «Permitir» and Luna may read her Gmail. */
  | "permitir-correo"
  /** Reading Gmail failed; one entry per run of failed polls, not per poll. */
  | "error-correo"
  /** She wrote something that reads as a crisis: Luna sent the crisis text and she went into pausa. */
  | "crisis";

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

/** Which cita it is: the three of the week, or one that takes a slot's place. */
export type TipoCita = "lunes" | "jueves" | "domingo" | "bienvenida" | "bienvenida-de-vuelta" | "graduada";

/** What waits for the next cita. */
export type TipoPendiente =
  /** Her first cita has not happened yet. */
  | "bienvenida"
  /** She came back from a pausa or a crisis. */
  | "bienvenida-de-vuelta"
  /** Something she said, kept for the next cita. */
  | "preocupacion"
  /** A señal worth telling her. */
  | "senal";

/** Something Luna will bring up at the next cita, never before. */
export type Pendiente = {
  id: number;
  tipo: TipoPendiente;
  /** In Spanish, readable by the team and the jury. */
  motivo: string;
  datos: unknown;
  createdAt: Date;
  /** When the madrugada deferred it; null if it never had to wait. */
  diferidoAt: Date | null;
  /** The cita that carried it; null while it still waits. */
  citaId: number | null;
};

/**
 * One slot of the week, decided. A `programada` cita is a decisión de cita for
 * the redactor; a `callada` one is a slot in which Luna chose silence.
 */
export type Cita = {
  id: number;
  /** The Santiago calendar day, `YYYY-MM-DD`. */
  fecha: string;
  tipo: TipoCita;
  estado: "programada" | "callada";
  etapa: Etapa;
  motivo: string;
  /** What it carries, oldest first. */
  pendientes: Pendiente[];
  programadaAt: Date;
  /** The mensaje saliente it went out as; null while it has not been sent. */
  mensajeSalienteId: number | null;
};
