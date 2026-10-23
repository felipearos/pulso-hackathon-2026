/** Bolsillo replies and texts. Luna never moves money or asks whether Patricia moved it. */

import type { Intencion } from "../escalera/policy";
import type { MensajeEntrante } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm, WhatsApp } from "../ports";
import { checkText, SAFE_TEMPLATE, validateText } from "../validator/validator";
import { isMadrugada } from "../whatsapp-cloud";

export type RespuestaBolsillo = "si" | "no" | "no-sabe";

const SKIN_TONE = "[\\u{1F3FB}-\\u{1F3FF}]";
const THUMBS_UP = new RegExp(`^(?:👍\\uFE0F?${SKIN_TONE}?)+$`, "u");
const THUMBS_DOWN = new RegExp(`^(?:👎\\uFE0F?${SKIN_TONE}?)+$`, "u");
const SHRUG = new RegExp(`^(?:🤷\\uFE0F?${SKIN_TONE}?(?:\\u200D[♀♂]\\uFE0F?)?)+$`, "u");

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Reads a direct answer about whether Patricia's bank offers her a bolsillo. */
export function respuestaBolsilloDe(text: string): RespuestaBolsillo | null {
  const trimmed = text.trim();
  if (THUMBS_UP.test(trimmed)) return "si";
  if (THUMBS_DOWN.test(trimmed)) return "no";
  if (SHRUG.test(trimmed)) return "no-sabe";

  const words = normalize(text).replace(/[.,!¡¿?]+$/u, "").trim();
  switch (words) {
    case "si":
      return "si";
    case "no":
      return "no";
    case "no se":
    case "nose":
    case "ni idea":
      return "no-sabe";
    default:
      return null;
  }
}

/**
 * Returns a short name Patricia gave her bolsillo, or null when it is not
 * usable. A name with a digit or a word the validador forbids is refused:
 * every text that carries it would fall to the plantilla segura.
 */
export function nombreDeBolsillo(text: string): string | null {
  let nombre = text.trim();
  const quotePairs = [["«", "»"], ["\"", "\""], ["'", "'"]] as const;

  while (nombre.length >= 2) {
    const pair = quotePairs.find(([opening, closing]) => nombre.startsWith(opening) && nombre.endsWith(closing));
    if (!pair) break;
    nombre = nombre.slice(pair[0].length, -pair[1].length).trim();
  }

  nombre = nombre.replace(/\s+/gu, " ");
  if (nombre.length === 0 || [...nombre.normalize("NFC")].length > 40) return null;
  if (!/\p{L}/u.test(nombre)) return null;
  if (checkText(nombre, []).length > 0) return null;
  return nombre;
}

export const PREGUNTA_BOLSILLO = "Una pregunta, una sola vez: ¿tu banco te deja tener un bolsillo o una cuenta de ahorro? 👍 sí · 👎 no · 🤷 no sé";
export const PEDIR_NOMBRE = "¡Qué bueno! ¿Qué nombre le pones? Así voy a llamar a lo que apartas.";
export const SIN_BOLSILLO = "Gracias por contarme. No te vuelvo a preguntar.";

/** Confirms the name Luna will use for Patricia's plata apartada. */
export function bolsilloNombrado(nombre: string): string {
  return `Listo: desde ahora lo que apartas se llama «${nombre}».`;
}

type BolsilloDeps = { store: Store; llm: Llm; whatsapp: WhatsApp };
type RespuestaDatos = { citaId?: unknown; respuesta?: unknown };

/** How long after her «sí» Luna still reads a message as the bolsillo's name. */
const NAMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function citaProgramadaMasReciente(store: Store) {
  return store.citas().filter((cita) => cita.estado === "programada").at(-1);
}

function citaIdDe(decision: { datos: unknown }): number | null {
  const citaId = (decision.datos as RespuestaDatos | null)?.citaId;
  return typeof citaId === "number" ? citaId : null;
}

/** Steps of the bolsillo being answered, so two messages arriving together are taken once. */
const answeringBolsillo = new WeakMap<Store, Set<string>>();

/** Runs `answer` unless the same step is already being answered; true either way, the message was the bolsillo's. */
async function withReserved(store: Store, step: string, answer: () => Promise<void>): Promise<boolean> {
  const reserved = answeringBolsillo.get(store) ?? new Set<string>();
  answeringBolsillo.set(store, reserved);
  if (reserved.has(step)) return true;
  reserved.add(step);
  try {
    await answer();
  } finally {
    reserved.delete(step);
  }
  return true;
}

async function sendBolsilloText(
  deps: BolsilloDeps,
  draft: string,
  errorMessage: string,
): Promise<{ text: string; source: "draft" | "redraft" | "safe-template"; whatsappId: string } | null> {
  const { store, llm, whatsapp } = deps;
  const validated = await validateText({
    draft,
    allowedFigures: [],
    llm,
    redraft: async () => draft,
    safeTemplate: SAFE_TEMPLATE,
    recordDecision: (decision) =>
      store.recordDecision({ tipo: "mensaje", motivo: decision.reason, datos: decision.input }),
  });

  try {
    const { id: whatsappId } = await whatsapp.send({ kind: "text", text: validated.text });
    return { ...validated, whatsappId };
  } catch (error) {
    console.error(errorMessage, error);
    return null;
  }
}

/**
 * Asks the bolsillo question after Luna answered a propuesta, unless it was
 * ever asked. A failed send records nothing, so a later propuesta asks again.
 */
export async function preguntarBolsillo(deps: BolsilloDeps, citaId: number): Promise<void> {
  const { store } = deps;
  if (store.decisions().some((decision) => decision.tipo === "preguntar-bolsillo")) return;
  const sent = await sendBolsilloText(deps, PREGUNTA_BOLSILLO, "could not send the bolsillo question");
  if (sent === null) return;
  store.recordDecision({
    tipo: "preguntar-bolsillo",
    motivo: "preguntó si su banco le deja tener un bolsillo",
    datos: { citaId, text: sent.text, source: sent.source, whatsappId: sent.whatsappId },
  });
}

/**
 * Reads Patricia's answer to the open bolsillo question, then the name after
 * her «sí». Returns whether the message was hers to take, so the same 👍 is
 * never also read as a choice on the propuesta. No cita, no MensajeSaliente.
 */
export async function answerBolsillo(
  deps: BolsilloDeps,
  mensaje: MensajeEntrante,
  intencion: Intencion,
): Promise<boolean> {
  const { store } = deps;
  if (isMadrugada(mensaje.receivedAt)) return false;
  if (store.getPatricia().enPausa) return false;

  const decisions = store.decisions();
  const pregunta = decisions.filter((decision) => decision.tipo === "preguntar-bolsillo").at(-1);
  if (pregunta === undefined) return false;
  const respuesta = decisions.filter((decision) => decision.tipo === "respuesta-bolsillo").at(-1);

  if (respuesta === undefined) {
    // Open only while its cita is the latest; once a later one is programada it is never asked again.
    const citaId = citaIdDe(pregunta);
    if (citaId === null || citaProgramadaMasReciente(store)?.id !== citaId) return false;
    const eleccion = respuestaBolsilloDe(mensaje.text);
    if (eleccion === null) return false;
    return withReserved(store, "respuesta", async () => {
      const sent = await sendBolsilloText(
        deps,
        eleccion === "si" ? PEDIR_NOMBRE : SIN_BOLSILLO,
        "could not send the reply to the bolsillo question",
      );
      // Unsent, she was never asked for a name: her next answer tries again.
      if (sent === null) return;
      store.recordDecision({
        tipo: "respuesta-bolsillo",
        motivo: MOTIVOS[eleccion],
        datos: { citaId, respuesta: eleccion, text: mensaje.text, whatsappId: sent.whatsappId },
      });
    });
  }

  const naming =
    (respuesta.datos as RespuestaDatos | null)?.respuesta === "si" &&
    mensaje.receivedAt.getTime() - respuesta.at.getTime() <= NAMING_WINDOW_MS &&
    store.getPatricia().bolsillo === null &&
    !decisions.some((decision) => decision.tipo === "nombrar-bolsillo");
  // Only a plain message is a name: not a 👍, a «sí», a question, a crisis or an angustia.
  if (!naming || intencion.kind !== "other" || respuestaBolsilloDe(mensaje.text) !== null) return false;
  const nombre = nombreDeBolsillo(mensaje.text);
  if (nombre === null) return false;
  return withReserved(store, "nombre", async () => {
    store.updatePatricia({ bolsillo: nombre });
    store.recordDecision({
      tipo: "nombrar-bolsillo",
      motivo: `le puso «${nombre}» a su bolsillo`,
      datos: { citaId: citaIdDe(respuesta), nombre },
    });
    await sendBolsilloText(deps, bolsilloNombrado(nombre), "could not send the bolsillo name confirmation");
  });
}

const MOTIVOS: Readonly<Record<RespuestaBolsillo, string>> = {
  si: "tiene bolsillo",
  no: "no tiene bolsillo",
  "no-sabe": "no sabe si tiene bolsillo",
};
