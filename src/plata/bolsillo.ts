/** Bolsillo replies and texts. Luna never moves money or asks whether Patricia moved it. */

import { santiagoParts } from "../clock/santiago";
import type { Intencion } from "../escalera/policy";
import type { MensajeEntrante } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";

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

/** Returns a short name Patricia gave her bolsillo, or null when it is not usable. */
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
  if (!/[\p{L}\p{N}]/u.test(nombre)) return null;
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

/** The madrugada ends at 05:30, exclusive. */
const MADRUGADA_END = 5 * 60 + 30;

export function isMadrugada(at: Date): boolean {
  const { hour, minute } = santiagoParts(at);
  return hour * 60 + minute < MADRUGADA_END;
}

function citaProgramadaMasReciente(store: Store) {
  return store.citas().filter((cita) => cita.estado === "programada").at(-1);
}

function citaIdDe(decision: { datos: unknown }): number | null {
  const citaId = (decision.datos as RespuestaDatos | null)?.citaId;
  return typeof citaId === "number" ? citaId : null;
}

/** Citas whose bolsillo reply is being processed, so concurrent messages cannot handle it twice. */
const answeringBolsillo = new WeakMap<Store, Set<number>>();

function reserveBolsillo(store: Store, citaId: number): (() => void) | null {
  const reserved = answeringBolsillo.get(store) ?? new Set<number>();
  answeringBolsillo.set(store, reserved);
  if (reserved.has(citaId)) return null;
  reserved.add(citaId);
  return () => reserved.delete(citaId);
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

function nombreNoPermitido(intencion: Intencion): boolean {
  return (
    intencion.kind === "crisis" ||
    intencion.kind === "pause" ||
    intencion.kind === "doesNotWantToSee" ||
    intencion.kind === "askWhy" ||
    intencion.kind === "askWhatRead" ||
    intencion.kind === "angustia"
  );
}

/** Reads the one open bolsillo question or its name, without starting a cita. */
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
  const citaId = citaIdDe(pregunta);
  if (citaId === null || citaProgramadaMasReciente(store)?.id !== citaId) return false;

  const respuesta = decisions
    .filter((decision) => decision.tipo === "respuesta-bolsillo" && citaIdDe(decision) === citaId)
    .at(-1);
  if (respuesta === undefined) {
    const eleccion = respuestaBolsilloDe(mensaje.text);
    if (eleccion === null) return false;
    const release = reserveBolsillo(store, citaId);
    if (release === null) return false;
    try {
      const motivo =
        eleccion === "si" ? "tiene bolsillo" : eleccion === "no" ? "no tiene bolsillo" : "no sabe si tiene bolsillo";
      store.recordDecision({
        tipo: "respuesta-bolsillo",
        motivo,
        datos: { citaId, respuesta: eleccion, text: mensaje.text },
      });
      await sendBolsilloText(
        deps,
        eleccion === "si" ? PEDIR_NOMBRE : SIN_BOLSILLO,
        "could not send the reply to the bolsillo question",
      );
      return true;
    } finally {
      release();
    }
  }

  if (
    (respuesta.datos as RespuestaDatos | null)?.respuesta !== "si" ||
    store.getPatricia().bolsillo !== null ||
    decisions.some((decision) => decision.tipo === "nombrar-bolsillo") ||
    nombreNoPermitido(intencion)
  ) {
    return false;
  }

  const nombre = nombreDeBolsillo(mensaje.text);
  if (nombre === null) return false;
  const release = reserveBolsillo(store, citaId);
  if (release === null) return false;
  try {
    store.updatePatricia({ bolsillo: nombre });
    store.recordDecision({
      tipo: "nombrar-bolsillo",
      motivo: `le puso «${nombre}» a su bolsillo`,
      datos: { citaId, nombre },
    });
    await sendBolsilloText(
      deps,
      bolsilloNombrado(nombre),
      "could not send the bolsillo name confirmation",
    );
    return true;
  } finally {
    release();
  }
}
