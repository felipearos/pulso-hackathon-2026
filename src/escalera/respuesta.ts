import type { Store } from "../patricia/store";
import { answerEleccion } from "../plata/jueves";
import type { Llm, WhatsApp } from "../ports";
import { classifyIntencion } from "./classify";
import { answerPregunta, lastAnswerAt } from "./preguntas";
import { decideEtapa, type Angustia, type Etapa, type EtapaInput, type EtapaMove, type Intencion } from "./policy";

export type RespuestaDeps = { store: Store; llm: Llm; whatsapp: WhatsApp };

export type MensajeInput = { text: string; whatsappId: string | null };

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

/**
 * Takes one message from Patricia (text or voice-note transcript), classifies
 * it, lets the política de etapa decide and stores the move with its decision.
 * Luna replies only to «¿por qué?» and «¿qué leíste?», and to her choice on the
 * jueves propuesta (src/plata/jueves.ts), after the move is stored.
 */
export async function receiveMensaje(deps: RespuestaDeps, input: MensajeInput): Promise<EtapaMove> {
  const { store, llm } = deps;
  const intencion = await classifyIntencion(input.text, llm);
  const etapaInput = buildInput(store, intencion);

  const mensaje = store.addMensajeEntrante({ text: input.text, intencion, whatsappId: input.whatsappId });

  const move = decideEtapa(etapaInput);
  // The whole input the política read, so the control room can show why.
  const datos = { text: input.text, input: etapaInput, move };
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
  if (intencion.kind === "askWhy" || intencion.kind === "askWhatRead") {
    await answerPregunta(deps, intencion.kind);
  }
  await answerEleccion(deps, mensaje, intencion);
  return move;
}
