/**
 * The jueves: the cita proposes paying the plata apartada sobre el mínimo,
 * and Patricia's 👍 or 👌 gets one warm reply. Every cifra comes from the
 * motor; every time read goes through the store's clock (ADR 0002).
 */
import { isOnlyEmoji } from "../escalera/classify";
import type { Intencion } from "../escalera/policy";
import { santiagoDate } from "../clock/santiago";
import type { Cita, Decision, MensajeEntrante } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";
import { isMadrugada } from "../whatsapp-cloud";
import { montoEnPantalla } from "../voz/montos";
import { inicioDeSemana } from "./apartado";
import { preguntarBolsillo } from "./bolsillo";
import {
  propuestaDelJueves,
  respuestaAEleccion,
  textoPropuesta,
  type EleccionDePago,
  type Propuesta,
} from "./propuesta";

/** What a propuesta proposes; the jueves has one tipo today. */
export type TipoPropuesta = "plata-apartada";

type PropuestaDatos = Propuesta & { citaId: number; texto: string; tipoPropuesta?: TipoPropuesta };

/** Two «no» since the last estado de cuenta del banco and Luna stops proposing it. */
const NOES_PARA_CALLAR = 2;

type NoesDatos = { tipoPropuesta?: TipoPropuesta; eleccion?: unknown } | null;

/** Whether a decision is a «no» to a propuesta of `tipo`: 👌 (the mínimo) or a bare no. */
function isNo(decision: Decision, tipo: TipoPropuesta): boolean {
  const datos = decision.datos as NoesDatos;
  // Decisions older than the field are all of the only tipo there was.
  if ((datos?.tipoPropuesta ?? "plata-apartada") !== tipo) return false;
  if (decision.tipo === "rechazar-propuesta") return true;
  return decision.tipo === "respuesta-propuesta" && datos?.eleccion === "minimo";
}

/**
 * The «no» to `tipo` since the latest estado de cuenta del banco arrived: a
 * new one (señal S1) starts the count again. Null when there is no such estado.
 */
function noesDesdeEstado(store: Store, tipo: TipoPropuesta): { noes: number; desde: Date } | null {
  const estado = store
    .estadosDeCuenta()
    .filter((e) => e.origen === "banco")
    .at(-1);
  if (estado === undefined) return null;
  const desde = estado.receivedAt;
  const noes = store
    .decisions()
    .filter((d) => d.at.getTime() > desde.getTime() && isNo(d, tipo)).length;
  return { noes, desde };
}

/**
 * Records the propuesta for a jueves cita that was just programada. Nothing at
 * all when there is no plata apartada or no pago mínimo to build it on. After
 * two «no» since the last estado de cuenta del banco, it records the silence
 * instead.
 */
export function proponerEnCita(store: Store, cita: Cita): void {
  if (cita.tipo !== "jueves") return;
  const { total: apartado, aportes } = store.plataApartada();
  const estado = store
    .estadosDeCuenta()
    .filter((e) => e.origen === "banco" && e.pagoMinimo !== null)
    .at(-1);
  const propuesta = propuestaDelJueves({ apartado, pagoMinimo: estado?.pagoMinimo ?? null });
  if (propuesta === null) return;

  const tipoPropuesta: TipoPropuesta = "plata-apartada";
  const silencio = noesDesdeEstado(store, tipoPropuesta);
  if (silencio !== null && silencio.noes >= NOES_PARA_CALLAR) {
    store.recordDecision({
      tipo: "callar-propuesta",
      motivo: "dos no a la plata apartada: no la repite hasta el próximo estado de cuenta",
      datos: { citaId: cita.id, tipoPropuesta, noes: silencio.noes, desde: silencio.desde.toISOString() },
    });
    return;
  }

  const { pagoMinimo, monto } = propuesta;
  store.recordDecision({
    tipo: "proponer-plata-apartada",
    motivo: `propone pagar ${montoEnPantalla(monto)}: mínimo ${montoEnPantalla(pagoMinimo)} + ${montoEnPantalla(apartado)} apartado`,
    datos: {
      citaId: cita.id,
      tipoPropuesta,
      apartado,
      aportes,
      pagoMinimo,
      monto,
      texto: textoPropuesta(propuesta, store.getPatricia().bolsillo),
    },
  });
}

/**
 * The propuesta of the latest programada cita, while Patricia has not answered
 * it and it is still this week's: a 👍 the next week answers nothing.
 */
function openPropuesta(store: Store, at: Date): PropuestaDatos | null {
  const cita = store
    .citas()
    .filter((c) => c.estado === "programada")
    .at(-1);
  if (cita === undefined || cita.fecha < santiagoDate(inicioDeSemana(at))) return null;
  const decisions = store.decisions();
  const forCita = (tipo: string) =>
    decisions.filter((d) => d.tipo === tipo && (d.datos as { citaId?: unknown } | null)?.citaId === cita.id);
  if (forCita("respuesta-propuesta").length > 0 || forCita("rechazar-propuesta").length > 0) return null;
  const propuesta = forCita("proponer-plata-apartada").at(-1);
  return propuesta ? (propuesta.datos as PropuestaDatos) : null;
}

function eleccionOf(text: string, intencion: Intencion): EleccionDePago | null {
  if (isOnlyEmoji(text, "👍") || intencion.kind === "accepted") return "propuesta";
  if (isOnlyEmoji(text, "👌") || intencion.kind === "minimum") return "minimo";
  return null;
}

/** What a bare refusal reads as, once normalized by `normalizeRechazo`. */
const RECHAZOS = new Set(["no", "no gracias", "nop", "no quiero", "mejor no", "👎"]);

/** Lowercase, no skin tone or variation selector, no punctuation around or between the words. */
function normalizeRechazo(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, "")
    .replace(/[.,;:!¡?¿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRechazo(text: string, intencion: Intencion): boolean {
  return intencion.kind === "doesNotWantToSee" || RECHAZOS.has(normalizeRechazo(text));
}

/** Citas whose propuesta a reply is being sent for, so a second emoji meanwhile answers nothing. */
const answering = new WeakMap<Store, Set<number>>();

/**
 * Answers Patricia's choice on the open propuesta, once. The reply is fixed
 * by code, equally warm either way; it is not a cita, so it adds no
 * MensajeSaliente.
 */
export async function answerEleccion(
  deps: { store: Store; llm: Llm; whatsapp: WhatsApp },
  mensaje: MensajeEntrante,
  intencion: Intencion,
): Promise<void> {
  const { store } = deps;
  // In the madrugada Luna says no figures and proposes nothing; the propuesta waits for her next answer.
  if (isMadrugada(mensaje.receivedAt)) return;
  // In pausa Luna does not talk, the same as the scheduler.
  if (store.getPatricia().enPausa) return;
  const propuesta = openPropuesta(store, mensaje.receivedAt);
  if (propuesta === null) return;
  const eleccion = eleccionOf(mensaje.text, intencion);
  const reserved = answering.get(store) ?? new Set<number>();
  answering.set(store, reserved);
  if (reserved.has(propuesta.citaId)) return;
  if (eleccion === null) {
    // A bare no closes the propuesta without a reply; it counts toward «dos no y se calla».
    if (isRechazo(mensaje.text, intencion)) {
      store.recordDecision({
        tipo: "rechazar-propuesta",
        motivo: "dijo que no a la propuesta de plata apartada",
        datos: { citaId: propuesta.citaId, tipoPropuesta: propuesta.tipoPropuesta ?? "plata-apartada", text: mensaje.text },
      });
    }
    return;
  }

  // Reserve before the first await; a failed send releases it so the next emoji retries.
  reserved.add(propuesta.citaId);
  try {
    await reply(deps, propuesta, eleccion);
  } finally {
    reserved.delete(propuesta.citaId);
  }
}

async function reply(
  deps: { store: Store; llm: Llm; whatsapp: WhatsApp },
  propuesta: PropuestaDatos,
  eleccion: EleccionDePago,
): Promise<void> {
  const { store, llm, whatsapp } = deps;
  const bolsillo = store.getPatricia().bolsillo;
  const draft = respuestaAEleccion(eleccion, propuesta, bolsillo);
  const validated = await validateText({
    draft,
    allowedFigures: [propuesta.monto],
    llm,
    redraft: async () => draft,
    safeTemplate: SAFE_TEMPLATE,
    recordDecision: (decision) =>
      store.recordDecision({ tipo: "mensaje", motivo: decision.reason, datos: decision.input }),
  });

  let whatsappId: string;
  try {
    ({ id: whatsappId } = await whatsapp.send({ kind: "text", text: validated.text }));
  } catch (error) {
    console.error("could not send the reply to the propuesta", error);
    return;
  }

  store.recordDecision({
    tipo: "respuesta-propuesta",
    motivo: eleccion === "propuesta" ? `eligió pagar ${montoEnPantalla(propuesta.monto)}` : "eligió el mínimo",
    datos: {
      citaId: propuesta.citaId,
      tipoPropuesta: propuesta.tipoPropuesta ?? "plata-apartada",
      eleccion,
      monto: propuesta.monto,
      text: validated.text,
      source: validated.source,
      whatsappId,
    },
  });

  await preguntarBolsillo(deps, propuesta.citaId);
}
