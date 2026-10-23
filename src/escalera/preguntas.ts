/**
 * Patricia's questions about Luna herself: «¿por qué me dices esto?» and
 * «¿qué leíste?». Code builds the one-sentence answer from the store, never
 * the LLM; the validador checks it before it goes out by WhatsApp.
 */

import { senderDomain } from "../mail/senders";
import type { Decision } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";

export type Pregunta = "askWhy" | "askWhatRead";

export type DraftedAnswer = { text: string; sourceDecisionId: number | null };

const NOT_WRITTEN_YET = "Todavía no te he escrito por mi cuenta; solo te respondo cuando me hablas.";
const NOTHING_READ = "Todavía no he leído ningún correo tuyo.";

const CITA_REASONS: Readonly<Record<string, string>> = {
  lunes: "Te escribí porque tocaba nuestra cita del lunes, la que acordamos para mirar tus cuentas con calma.",
  jueves: "Te escribí porque tocaba nuestra cita del jueves, la que acordamos para mirar tus cuentas con calma.",
  domingo: "Te escribí porque tocaba nuestra cita del domingo, la que acordamos para mirar tus cuentas con calma.",
  bienvenida: "Te escribí para darte la bienvenida, nada más.",
  "bienvenida-de-vuelta": "Te escribí para darte la bienvenida de vuelta, nada más.",
  graduada: "Te escribí porque es nuestra cita del mes, para ver cómo sigues.",
};

const PLATA_APARTADA_REASON = "Te escribí para proponerte dejar un poquito de plata apartada.";

/** The `tipo` field of a decision's datos, when it is a string. */
function citaTipoOf(datos: unknown): string | null {
  if (typeof datos !== "object" || datos === null || !("tipo" in datos)) return null;
  return typeof datos.tipo === "string" ? datos.tipo : null;
}

function reasonFor(decision: Decision): string | null {
  if (decision.tipo === "proponer-plata-apartada") return PLATA_APARTADA_REASON;
  const tipo = citaTipoOf(decision.datos);
  return tipo !== null && Object.hasOwn(CITA_REASONS, tipo) ? CITA_REASONS[tipo]! : null;
}

function draftWhy(store: Store): DraftedAnswer {
  const latest = store
    .decisions()
    .filter((decision) => decision.tipo === "programar-cita" || decision.tipo === "proponer-plata-apartada")
    .at(-1);
  const text = latest ? reasonFor(latest) : null;
  if (!latest || text === null) return { text: NOT_WRITTEN_YET, sourceDecisionId: null };
  return { text, sourceDecisionId: latest.id };
}

function listDomains(domains: readonly string[]): string {
  if (domains.length === 1) return domains[0]!;
  return `${domains.slice(0, -1).join(", ")} y ${domains.at(-1)!}`;
}

/** Only sender domains: never a subject or anything else from the mail. */
function draftWhatRead(store: Store): DraftedAnswer {
  const domains: string[] = [];
  for (const senal of store.senales()) {
    const domain = senderDomain(senal.origen.from);
    if (domain !== null && !domains.includes(domain)) domains.push(domain);
  }
  if (domains.length === 0) return { text: NOTHING_READ, sourceDecisionId: null };
  return { text: `Leí solo correos de ${listDomains(domains)}. Nada más.`, sourceDecisionId: null };
}

export function draftAnswer(store: Store, pregunta: Pregunta): DraftedAnswer {
  return pregunta === "askWhy" ? draftWhy(store) : draftWhatRead(store);
}

const MOTIVOS: Readonly<Record<Pregunta, string>> = {
  askWhy: "respondió por qué le habló",
  askWhatRead: "respondió qué leyó",
};

/**
 * Answers one question by WhatsApp text and logs it. Not stored as a
 * MensajeSaliente: that list holds the citas, and a 👍 to this answer must not
 * count as answering one.
 */
export async function answerPregunta(
  deps: { store: Store; llm: Llm; whatsapp: WhatsApp },
  pregunta: Pregunta,
): Promise<void> {
  const { store, llm, whatsapp } = deps;
  const { text: draft, sourceDecisionId } = draftAnswer(store, pregunta);
  const validated = await validateText({
    draft,
    allowedFigures: [],
    llm,
    // The answer is fixed by code; there is no other wording to try.
    redraft: async () => draft,
    safeTemplate: SAFE_TEMPLATE,
    recordDecision: (decision) => store.recordDecision({ tipo: "mensaje", motivo: decision.reason, datos: decision.input }),
  });

  let whatsappId: string;
  try {
    ({ id: whatsappId } = await whatsapp.send({ kind: "text", text: validated.text }));
  } catch (cause) {
    console.error("Could not send the answer to Patricia's question", cause);
    return;
  }

  store.recordDecision({
    tipo: "mensaje",
    motivo: MOTIVOS[pregunta],
    datos: { pregunta, text: validated.text, source: validated.source, sourceDecisionId, whatsappId },
  });
}
