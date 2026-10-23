import type { MensajeSaliente } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { Llm } from "../ports";
import { classifyIntencion } from "./classify";
import { decideEtapa, type Angustia, type Etapa, type EtapaInput, type EtapaMove, type Intencion } from "./policy";

export type RespuestaDeps = { store: Store; llm: Llm };

export type MensajeInput = { text: string; whatsappId: string | null };

function latestSaliente(mensajes: MensajeSaliente[]): MensajeSaliente | null {
  let latest: MensajeSaliente | null = null;
  for (const mensaje of mensajes) {
    if (
      latest === null ||
      mensaje.sentAt.getTime() > latest.sentAt.getTime() ||
      (mensaje.sentAt.getTime() === latest.sentAt.getTime() && mensaje.id > latest.id)
    ) {
      latest = mensaje;
    }
  }
  return latest;
}

/**
 * The etapa of the cita she is answering: the one in effect when Luna's latest
 * message went out. Once she moves up, an old cita keeps its old etapa, so it
 * never moves her twice.
 */
function citaEtapaOf(store: Store): Etapa | null {
  const cita = latestSaliente(store.mensajesSalientes());
  if (cita === null) return null;

  const history = store.etapaHistory();
  const sentAt = cita.sentAt.getTime();
  const before = history.filter((cambio) => cambio.at.getTime() <= sentAt).at(-1);
  if (before) return before.to;
  const after = history.find((cambio) => cambio.at.getTime() > sentAt);
  if (after) return after.from;
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
 * Luna sends no reply here.
 */
export async function receiveMensaje(deps: RespuestaDeps, input: MensajeInput): Promise<EtapaMove> {
  const { store, llm } = deps;
  const intencion = await classifyIntencion(input.text, llm);
  const etapaInput = buildInput(store, intencion);

  store.addMensajeEntrante({ text: input.text, intencion, whatsappId: input.whatsappId });

  const move = decideEtapa(etapaInput);
  const datos = {
    from: move.from,
    to: move.to,
    kind: move.kind,
    intencion,
    citaEtapa: etapaInput.senales[0]!.citaEtapa,
  };
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
  return move;
}
