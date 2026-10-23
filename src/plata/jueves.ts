/**
 * The jueves: the cita proposes paying the plata apartada sobre el mínimo,
 * and Patricia's 👍 or 👌 gets one warm reply. Every cifra comes from the
 * motor; every time read goes through the store's clock (ADR 0002).
 */
import { isOnlyEmoji } from "../escalera/classify";
import type { Intencion } from "../escalera/policy";
import { santiagoDate, santiagoParts } from "../clock/santiago";
import type { Cita, MensajeEntrante } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";
import { montoEnPantalla } from "../voz/montos";
import { inicioDeSemana } from "./apartado";
import {
  propuestaDelJueves,
  respuestaAEleccion,
  textoPropuesta,
  type EleccionDePago,
  type Propuesta,
} from "./propuesta";

type PropuestaDatos = Propuesta & { citaId: number; texto: string };

/**
 * Records the propuesta for a jueves cita that was just programada. Nothing at
 * all when there is no plata apartada or no pago mínimo to build it on.
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

  const { pagoMinimo, monto } = propuesta;
  store.recordDecision({
    tipo: "proponer-plata-apartada",
    motivo: `propone pagar ${montoEnPantalla(monto)}: mínimo ${montoEnPantalla(pagoMinimo)} + ${montoEnPantalla(apartado)} apartado`,
    datos: { citaId: cita.id, apartado, aportes, pagoMinimo, monto, texto: textoPropuesta(propuesta) },
  });
}

/** The madrugada ends at 05:30, exclusive. */
const MADRUGADA_END = 5 * 60 + 30;

function isMadrugada(at: Date): boolean {
  const { hour, minute } = santiagoParts(at);
  return hour * 60 + minute < MADRUGADA_END;
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
  if (forCita("respuesta-propuesta").length > 0) return null;
  const propuesta = forCita("proponer-plata-apartada").at(-1);
  return propuesta ? (propuesta.datos as PropuestaDatos) : null;
}

function eleccionOf(text: string, intencion: Intencion): EleccionDePago | null {
  if (isOnlyEmoji(text, "👍") || intencion.kind === "accepted") return "propuesta";
  if (isOnlyEmoji(text, "👌") || intencion.kind === "minimum") return "minimo";
  return null;
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
  if (eleccion === null) return;

  // Reserve before the first await; a failed send releases it so the next emoji retries.
  const reserved = answering.get(store) ?? new Set<number>();
  answering.set(store, reserved);
  if (reserved.has(propuesta.citaId)) return;
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
  const draft = respuestaAEleccion(eleccion, propuesta);
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
      eleccion,
      monto: propuesta.monto,
      text: validated.text,
      source: validated.source,
      whatsappId,
    },
  });
}
