import type { Database } from "bun:sqlite";
import type { Store } from "../patricia/store";
import { answerEleccion } from "../plata/jueves";
import type { Llm, WhatsApp } from "../ports";
import { classifyIntencion } from "./classify";
import { returnFromPausa } from "./pausa";
import { answerPregunta, lastAnswerAt } from "./preguntas";
import { decideEtapa, type Angustia, type Etapa, type EtapaInput, type EtapaMove, type Intencion } from "./policy";

/** `db` lets a pausa or a return land with its decision in one transaction. */
export type RespuestaDeps = { store: Store; llm: Llm; whatsapp: WhatsApp; db: Database };

export type MensajeInput = {
  text: string;
  whatsappId: string | null;
  /**
   * How it reached Luna, when it came in over WhatsApp. The registro de
   * decisiones keeps it, so the control room can tell a message Patricia typed
   * from an emoji she reacted with, and from whose number either arrived.
   */
  arrival?: { from: string; kind: "text" | "reaction"; toWhatsappId?: string | null };
};

function rank(etapa: Etapa): number {
  return etapa === "graduada" ? 6 : etapa;
}

/**
 * The etapa of the cita she is answering: the one in effect when Luna's latest
 * message went out. Null when there is none, or when that cita already moved
 * her up once: one cita never moves her up twice, even after she moved down.
 * Also null when Luna answered a question after the cita: she is answering that.
 */
function citaEtapaOf(store: Store): Etapa | null {
  const cita = store.mensajesSalientes().at(-1);
  if (cita === undefined) return null;
  const answeredAt = lastAnswerAt(store);
  if (answeredAt !== null && answeredAt.getTime() >= cita.sentAt.getTime()) return null;

  const history = store.etapaHistory();
  const sentAt = cita.sentAt.getTime();
  const after = history.filter((cambio) => cambio.at.getTime() > sentAt);
  if (after.some((cambio) => rank(cambio.to) > rank(cambio.from))) return null;

  const before = history.filter((cambio) => cambio.at.getTime() <= sentAt).at(-1);
  if (before) return before.to;
  if (after[0]) return after[0].from;
  return store.getPatricia().etapa;
}

/**
 * Whether Luna's latest message is the domingo cita, whose pregunta she answers
 * on the angustia scale. False once Luna answered a question after it: she is
 * reacting to that answer.
 */
function answersDomingo(store: Store): boolean {
  const mensaje = store.mensajesSalientes().at(-1);
  if (mensaje === undefined) return false;
  const answeredAt = lastAnswerAt(store);
  if (answeredAt !== null && answeredAt.getTime() >= mensaje.sentAt.getTime()) return false;
  return store.citas().find((cita) => cita.mensajeSalienteId === mensaje.id)?.tipo === "domingo";
}

function buildInput(store: Store, intencion: Intencion): EtapaInput {
  let lastAngustia: Angustia | null = null;
  for (const mensaje of store.mensajesEntrantes()) {
    if (mensaje.intencion?.kind === "angustia") lastAngustia = mensaje.intencion.value;
  }

  const estados = store.estadosDeCuenta();
  const lastCambio = store.etapaHistory().at(-1);
  const estadoDeCuentaBancoNuevo = estados.some(
    (estado) =>
      estado.origen === "banco" && (lastCambio === undefined || estado.receivedAt.getTime() > lastCambio.at.getTime()),
  );

  return {
    etapa: store.getPatricia().etapa,
    senales: [{ intencion, citaEtapa: citaEtapaOf(store) }],
    lastAngustia,
    estadoDeCuentaTienda: estados.some((estado) => estado.origen === "tienda"),
    estadoDeCuentaBancoNuevo,
  };
}

function isDownOrCrisis(intencion: Intencion): boolean {
  return (
    intencion.kind === "crisis" ||
    intencion.kind === "doesNotWantToSee" ||
    (intencion.kind === "angustia" && intencion.value >= 4)
  );
}

/**
 * Takes one message from Patricia (text or voice-note transcript), classifies
 * it, lets the política de etapa decide and stores the move with its decision.
 * Luna replies only to «¿por qué?» and «¿qué leíste?», and to her choice on the
 * jueves propuesta (src/plata/jueves.ts), after the move is stored.
 * «Pausa» silences Luna; any other message during a pausa ends it with a
 * bienvenida de vuelta, one etapa down per estado de cuenta cycle she missed.
 */
export async function receiveMensaje(deps: RespuestaDeps, input: MensajeInput): Promise<EtapaMove> {
  const { store, llm, db } = deps;
  const intencion = await classifyIntencion(input.text, llm, { angustiaEsperada: answersDomingo(store) });
  const atomically = (fn: () => void) => db.transaction(fn)();

  const { enPausa, etapa } = store.getPatricia();
  // Read before the message is stored; a return reads it again after the etapa is recalculated.
  const inputBefore = enPausa ? null : buildInput(store, intencion);
  const mensaje = store.addMensajeEntrante({ text: input.text, intencion, whatsappId: input.whatsappId });
  const now = mensaje.receivedAt;

  if (intencion.kind === "pause") {
    // Already in pausa: she stays, and there is nothing new to log.
    if (enPausa) return { kind: "stay", from: etapa, to: etapa, reason: "en pausa: ya estaba en pausa" };
    const reason = "en pausa: pidió pausa";
    // Luna goes silent without a goodbye.
    atomically(() => {
      store.updatePatricia({ enPausa: true });
      store.recordDecision({ tipo: "pausa", motivo: reason, datos: { desde: now.toISOString(), text: input.text } });
    });
    return { kind: "stay", from: etapa, to: etapa, reason };
  }

  if (enPausa) {
    const { from, to, reason, desde, missedCycles } = returnFromPausa(store, now);
    atomically(() => {
      if (to !== from) store.setEtapa(to, reason);
      store.recordDecision({
        tipo: "vuelta",
        motivo: reason,
        datos: { text: input.text, desde: desde.toISOString(), missedCycles, from, to },
      });
      store.updatePatricia({ enPausa: false });
      // The scheduler turns it into the next cita, a bienvenida de vuelta.
      store.addPendiente({
        tipo: "bienvenida-de-vuelta",
        motivo: "bienvenida de vuelta",
        datos: { desde: desde.toISOString(), missedCycles, from, to },
      });
    });
    // A crisis, a high angustia or «no quiero ver» still go through the política, from the etapa she returns to.
    if (!isDownOrCrisis(intencion)) {
      if (intencion.kind === "askWhy" || intencion.kind === "askWhatRead") {
        await answerPregunta(deps, intencion.kind);
      }
      return { kind: rank(to) < rank(from) ? "down" : "stay", from, to, reason };
    }
  }

  const etapaInput = inputBefore ?? buildInput(store, intencion);
  const move = decideEtapa(etapaInput);
  // The whole input the política read, so the control room can show why.
  const datos = {
    text: input.text,
    whatsappId: input.whatsappId,
    ...(input.arrival ? { arrival: input.arrival } : {}),
    input: etapaInput,
    move,
  };

  // Everything the move writes, as one unit. Classifying it is a network call,
  // so it stays outside.
  atomically(() => {
    switch (move.kind) {
      case "up":
      case "graduate":
        store.setEtapa(move.to, move.reason);
        store.recordDecision({ tipo: "subir-etapa", motivo: move.reason, datos });
        break;
      case "down":
        store.setEtapa(move.to, move.reason);
        store.recordDecision({ tipo: "bajar-etapa", motivo: move.reason, datos });
        break;
      case "stay":
      case "freeze":
        store.recordDecision({ tipo: "quedarse", motivo: move.reason, datos });
        break;
    }
  });

  // Luna answers the question only once the move is stored: her reply says what
  // the registro already holds.
  if (intencion.kind === "askWhy" || intencion.kind === "askWhatRead") {
    await answerPregunta(deps, intencion.kind);
  }
  await answerEleccion(deps, mensaje, intencion);
  return move;
}
