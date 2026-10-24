import type { Database } from "bun:sqlite";
import { nextCiclo, storeEstadoDeCuenta } from "../mail/estado-de-cuenta";
import type { EstadoDeCuenta } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm, WhatsApp } from "../ports";
import { SAFE_TEMPLATE, validateText } from "../validator/validator";
import { montoEnPantalla } from "../voz/montos";
import type { CifrasExtraidas } from "./extractor";

/**
 * The pago mínimo Patricia brings Luna herself: in etapa 4 the tienda's, in a
 * foto of its estado de cuenta; in etapa 5 the bank's, said in a text or shown
 * in a foto. Luna compares it with the estado de cuenta she has and celebrates
 * that Patricia opened it; when the figures differ she says hers gently, never
 * that Patricia was wrong.
 */

type Origen = EstadoDeCuenta["origen"];

const DE_LA_TIENDA: Record<Origen, string> = { banco: "", tienda: " de la tienda" };

/**
 * What Luna says when the mínimo Patricia brought is the one she has, or Luna
 * has none to compare it with (`comparado` false): then it is only celebrated.
 */
export function textoMinimoCoincide(origen: Origen, minimo: number, nombre: string, comparado = true): string {
  // Worded so the tone review passes it: «Lo leímos igual» read as a threat.
  const celebracion = `¡Qué lindo, ${nombre}, lo abriste tú! El mínimo${DE_LA_TIENDA[origen]} es ${montoEnPantalla(minimo)}`;
  const comparacion = comparado ? ", igual al que yo tenía anotado" : "";
  return `${celebracion}${comparacion}. Gracias por compartirlo conmigo.`;
}

/** What Luna says when the mínimo Patricia brought is not the one she has: only hers is shown. */
export function textoMinimoDistinto(origen: Origen, guardado: number): string {
  return `¡Lo abriste tú, y eso es lo importante! En el estado de cuenta${DE_LA_TIENDA[origen]} que tengo, el mínimo es ${montoEnPantalla(guardado)}.`;
}

/**
 * Stores the figures read on a foto as the next estado de cuenta of that
 * origen, as an estado de cuenta read from a mail is stored. Its extracción is
 * kept under `whatsapp:<whatsappId>`.
 */
export function guardarFotoComoEstadoDeCuenta(
  deps: { store: Store; db: Database },
  input: { origen: Origen; cifras: CifrasExtraidas; whatsappId: string | null },
): EstadoDeCuenta {
  const { store, db } = deps;
  const { origen, cifras, whatsappId } = input;
  return db.transaction(() => {
    // Without a Meta id the ciclo keeps the key unique: each foto stored takes the next one.
    const mailId = `whatsapp:${whatsappId ?? `foto-${origen}-${nextCiclo(store, origen)}`}`;
    const { estado } = storeEstadoDeCuenta(store, { origen, cifras, mailId });
    const estadoLabel = origen === "banco" ? "el estado de cuenta" : "el estado de cuenta de la tienda";
    store.recordDecision({
      tipo: "mensaje",
      motivo: `Guardé ${estadoLabel} que me mandó en foto (ciclo ${estado.ciclo}).`,
      datos: { origen, mailId, whatsappId, estadoDeCuentaId: estado.id },
    });
    return estado;
  })();
}

/** The latest estado de cuenta of that origen with a pago mínimo, by ciclo then id; null when there is none. */
function guardadoDe(store: Store, origen: Origen): (EstadoDeCuenta & { pagoMinimo: number }) | null {
  let latest: (EstadoDeCuenta & { pagoMinimo: number }) | null = null;
  for (const estado of store.estadosDeCuenta()) {
    if (estado.origen !== origen || estado.pagoMinimo === null) continue;
    if (latest === null || estado.ciclo > latest.ciclo || (estado.ciclo === latest.ciclo && estado.id > latest.id)) {
      latest = { ...estado, pagoMinimo: estado.pagoMinimo };
    }
  }
  return latest;
}

/**
 * Answers the pago mínimo Patricia showed or said by WhatsApp text. Not stored
 * as a MensajeSaliente: that list holds the citas. During a pausa Luna sends
 * nothing.
 */
export async function answerMinimoContado(
  deps: { store: Store; llm: Llm; whatsapp: WhatsApp },
  input: {
    origen: Origen;
    contado: number;
    fuente: "foto" | "texto";
    /** The foto was just stored as a new estado de cuenta: there was nothing to compare it with. */
    guardadaRecien?: boolean;
  },
): Promise<void> {
  const { store, llm, whatsapp } = deps;
  const { origen, contado, fuente } = input;
  const patricia = store.getPatricia();
  if (patricia.enPausa) return;

  const guardado = input.guardadaRecien ? null : guardadoDe(store, origen);
  const coincide = guardado === null || guardado.pagoMinimo === contado;
  const figure = guardado?.pagoMinimo ?? contado;
  const draft = coincide
    ? textoMinimoCoincide(origen, figure, patricia.nombre, guardado !== null)
    : textoMinimoDistinto(origen, figure);
  const validated = await validateText({
    draft,
    allowedFigures: [figure],
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
    console.error("Could not send the answer to the mínimo Patricia brought", cause);
    return;
  }

  store.recordDecision({
    tipo: "mensaje",
    motivo: guardado === null
      ? "celebró el mínimo que contó: no hay un estado de cuenta con que compararlo"
      : coincide
        ? "celebró el mínimo que contó: coincide con el estado de cuenta"
        : "corrigió con suavidad el mínimo que contó: no coincide con el estado de cuenta",
    datos: {
      origen,
      contado,
      guardado: guardado?.pagoMinimo ?? null,
      fuente,
      estadoDeCuentaId: guardado?.id ?? null,
      text: validated.text,
      source: validated.source,
      whatsappId,
    },
  });
}
