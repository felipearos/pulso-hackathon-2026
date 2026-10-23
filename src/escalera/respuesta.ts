import type { Database } from "bun:sqlite";
import type { CifrasExtraidas } from "../figures/extractor";
import { answerMinimoContado, guardarFotoComoEstadoDeCuenta } from "../figures/minimo-contado";
import type { MensajeEntrante } from "../patricia/entities";
import type { Store } from "../patricia/store";
import { answerBolsillo } from "../plata/bolsillo";
import { answerEleccion } from "../plata/jueves";
import { answerCompraEnCuotas } from "../plata/verlo-manana";
import type { Llm, Voice, WhatsApp } from "../ports";
import { findFigures } from "../validator/validator";
import { answerFotoNoLeida } from "../whatsapp/inbound";
import { isMadrugada } from "../whatsapp-cloud";
import { classifyIntencion } from "./classify";
import { sendCrisisText } from "./crisis";
import { returnFromPausa } from "./pausa";
import { answerPregunta, lastAnswerAt } from "./preguntas";
import { answerMadrugada } from "./respuesta-madrugada";
import { decideEtapa, type Angustia, type Etapa, type EtapaInput, type EtapaMove, type Intencion } from "./policy";

/**
 * `db` lets a pausa or a return land with its decision in one transaction.
 * `voice` speaks the madrugada answer; without it that answer is logged as not sent.
 */
export type RespuestaDeps = { store: Store; llm: Llm; whatsapp: WhatsApp; voice?: Voice; db: Database };

export type MensajeInput = {
  text: string;
  whatsappId: string | null;
  /**
   * How it reached Luna, when it came in over WhatsApp. The registro de
   * decisiones keeps it, so the control room can tell a message Patricia typed
   * from an emoji she reacted with, a nota de voz she spoke (its transcript
   * is the text) or a foto she sent, and from whose number any of them arrived.
   */
  arrival?: { from: string; kind: "text" | "reaction" | "audio" | "image"; toWhatsappId?: string | null };
  /** The cifras read on a foto of an estado de cuenta; the text then only stands in for it. */
  foto?: { cifras: CifrasExtraidas };
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
  // The estado de cuenta image follows its cita's audio: the pregunta is still the audio's.
  const audio = store.mensajesSalientes().findLast((m) => m.kind !== "image");
  return store.citas().find((cita) => cita.mensajeSalienteId === audio?.id)?.tipo === "domingo";
}

/**
 * Whether Luna's latest message is the lunes cita, which asks her in etapa 5 to
 * open the bank's estado de cuenta and tell its pago mínimo.
 */
function answersLunes(store: Store): boolean {
  // An image follows its cita's audio: the cita is still the audio's.
  const mensaje = store.mensajesSalientes().findLast((m) => m.kind !== "image");
  if (mensaje === undefined) return false;
  return store.citas().find((cita) => cita.mensajeSalienteId === mensaje.id)?.tipo === "lunes";
}

/** The first figure in a text that can be a pago mínimo: «el mínimo es 40.100» is 40100. */
function minimoEn(text: string): number | null {
  return findFigures(text).find((figure) => figure >= 1000) ?? null;
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

function isDown(intencion: Intencion): boolean {
  return (
    intencion.kind === "doesNotWantToSee" ||
    (intencion.kind === "angustia" && intencion.value >= 4)
  );
}

/**
 * Takes one message from Patricia (text, voice-note transcript or the cifras
 * of a foto), classifies it, lets the política de etapa decide and stores the
 * move with its decision. A foto of her estado de cuenta is not classified: it
 * does what the cita asked, so it is accepted.
 * Luna replies only to «¿por qué?» and «¿qué leíste?», to her choice on the
 * jueves propuesta (src/plata/jueves.ts), the bolsillo question, a compra en
 * cuotas (src/plata/verlo-manana.ts), and to the
 * pago mínimo she brings: a foto's (the tienda's in etapa 4, the bank's
 * otherwise), or the one she tells in etapa 5 answering the lunes cita. All of
 * them after the move is stored.
 * In the madrugada none of those answers go out: Luna answers each message
 * with one fixed nota de voz, with no figure, and keeps it as a pendiente for
 * the next cita (src/escalera/respuesta-madrugada.ts). The move and a foto's
 * estado de cuenta are still stored.
 * «Pausa» silences Luna; any other message during a pausa ends it with a
 * bienvenida de vuelta, one etapa down per estado de cuenta cycle she missed.
 * A crisis puts her in pausa and Luna sends the crisis text at once, at any
 * hour; her next message brings her back in etapa 1.
 */
export async function receiveMensaje(deps: RespuestaDeps, input: MensajeInput): Promise<EtapaMove> {
  const { store, llm, db } = deps;
  const intencion: Intencion = input.foto
    ? { kind: "accepted" }
    : await classifyIntencion(input.text, llm, { angustiaEsperada: answersDomingo(store) });
  const atomically = (fn: () => void) => db.transaction(fn)();

  const { enPausa, etapa } = store.getPatricia();
  // The bank's mínimo she tells in etapa 5, answering the lunes cita.
  const minimoContado = !enPausa && !input.foto && etapa === 5 && answersLunes(store) ? minimoEn(input.text) : null;
  // Read before the message is stored; a return reads it again after the etapa is recalculated.
  const inputBefore = enPausa ? null : buildInput(store, intencion);
  const mensaje = store.addMensajeEntrante({ text: input.text, intencion, whatsappId: input.whatsappId });
  const now = mensaje.receivedAt;
  const madrugada = isMadrugada(now);
  const answerAtNight = () => answerMadrugada(deps, { text: input.text, whatsappId: input.whatsappId, now });

  if (intencion.kind === "crisis") {
    const reason = "congelada: crisis";
    // Stored before sending, so a failed send still leaves her in pausa. A crisis during a pausa keeps it.
    atomically(() => {
      store.updatePatricia({ enPausa: true });
      store.recordDecision({
        tipo: "crisis",
        motivo: "congelada: crisis, en pausa",
        datos: { desde: now.toISOString(), text: input.text },
      });
    });
    await sendCrisisText(deps);
    return { kind: "freeze", from: etapa, to: etapa, reason };
  }

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
    // A high angustia or «no quiero ver» still go through the política, from the etapa she returns to.
    if (!isDown(intencion)) {
      if (madrugada) {
        await answerAtNight();
      } else if (intencion.kind === "askWhy" || intencion.kind === "askWhatRead") {
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

  if (madrugada) {
    // A foto is stored at any hour; its answer is replaced by the madrugada note.
    if (input.foto) await answerFoto(deps, mensaje, input.foto.cifras, etapa === 4 ? "tienda" : "banco", false);
    await answerAtNight();
    return move;
  }

  // Luna answers the question only once the move is stored: her reply says what
  // the registro already holds.
  if (intencion.kind === "askWhy" || intencion.kind === "askWhatRead") {
    await answerPregunta(deps, intencion.kind);
  }
  if (input.foto) {
    await answerFoto(deps, mensaje, input.foto.cifras, etapa === 4 ? "tienda" : "banco", true);
    return move;
  }
  if (minimoContado !== null) {
    await answerMinimoContado(deps, { origen: "banco", contado: minimoContado, fuente: "texto" });
    return move;
  }
  const purchaseHandled = await answerCompraEnCuotas(deps, mensaje, intencion);
  if (!purchaseHandled && !(await answerBolsillo(deps, mensaje, intencion))) {
    await answerEleccion(deps, mensaje, intencion);
  }
  return move;
}

/**
 * Answers a foto of an estado de cuenta of that origen: the tienda's in etapa
 * 4, the bank's otherwise (a paper one, or the one etapa 5 asks her to open).
 * With no stored estado de cuenta of that origen to compare it with, the foto
 * becomes one, even when Luna does not `answer` (the madrugada).
 */
async function answerFoto(
  deps: RespuestaDeps,
  mensaje: MensajeEntrante,
  cifras: CifrasExtraidas,
  origen: "banco" | "tienda",
  answer: boolean,
): Promise<void> {
  const { store } = deps;
  const contado = cifras.pagoMinimo;
  if (contado === null) {
    if (answer) await answerFotoNoLeida(deps);
    return;
  }
  const guardado = store.estadosDeCuenta().some((estado) => estado.origen === origen && estado.pagoMinimo !== null);
  if (!guardado) guardarFotoComoEstadoDeCuenta(deps, { origen, cifras, whatsappId: mensaje.whatsappId });
  if (answer) await answerMinimoContado(deps, { origen, contado, fuente: "foto", guardadaRecien: !guardado });
}
