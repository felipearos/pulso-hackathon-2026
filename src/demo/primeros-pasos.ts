import { MOTIVO_RESPUESTA_BIENVENIDA } from "../citas/bienvenida-respuestas";
import type { Store } from "../patricia/store";
import { vozDe } from "../voice/voces";

export type PrimerPaso = {
  id: "saludo" | "bienvenida" | "respuesta" | "permitir" | "rut" | "contexto";
  titulo: string;
  hecho: boolean;
  at: string | null;
  detalle: string | null;
};

export type PrimerosPasosOptions = {
  permitirUrl: string;
  gmailLoginHint: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function responsesFrom(decision: { datos: unknown }): Record<string, unknown> | null {
  if (!isObject(decision.datos) || !isObject(decision.datos.respuestas)) return null;
  return decision.datos.respuestas;
}

/** Builds the sala's ordered first steps from Patricia's stored story. */
export function primerosPasos(store: Store, opts: PrimerosPasosOptions): PrimerPaso[] {
  const initialInbound = store.mensajesEntrantes()[0];
  const welcomeCita = store.citas().find((cita) => cita.tipo === "bienvenida" && cita.mensajeSalienteId !== null);
  const welcomeMessage = welcomeCita === undefined
    ? undefined
    : store.mensajesSalientes().find((message) => message.id === welcomeCita.mensajeSalienteId);
  const decisions = store.decisions();
  const isWelcomeResponse = (decision: (typeof decisions)[number]) =>
    decision.motivo.startsWith(`${MOTIVO_RESPUESTA_BIENVENIDA}:`);
  const firstWelcomeResponse = decisions.find(isWelcomeResponse);
  const saysNameInResponse = decisions.some(
    (decision) => isWelcomeResponse(decision) && typeof responsesFrom(decision)?.nombre === "string",
  );
  const nameSource = saysNameInResponse
    ? "lo dijo ella"
    : decisions.some((decision) => decision.motivo.startsWith("tomó el nombre de su perfil de WhatsApp"))
      ? "perfil de WhatsApp"
      : "sin dato";
  const patricia = store.getPatricia();
  const permitirDecision = decisions.find((decision) => decision.tipo === "permitir-correo");
  const rutDecision = decisions.toReversed().find((decision) => decision.tipo === "permitir-rut");
  const contextoDecision = decisions.toReversed().find((decision) => decision.tipo === "contar-contexto");
  const context = patricia.contexto ?? null;
  const contextAnswers: { label: string; answer: string }[] = [];
  if (context !== null) {
    for (const [label, answer] of [
      ["de qué vive", context.deQueVive],
      ["qué le preocupa", context.queLePreocupa],
      ["qué le pesa", context.queLePesa],
    ] as const) {
      if (answer !== null) contextAnswers.push({ label, answer });
    }
  }
  const contextDetail = context === null
    ? null
    : `${contextAnswers.length} de 3 preguntas${contextAnswers.map(({ label, answer }) => ` · ${label}: ${answer}`).join("")}`;

  return [
    {
      id: "saludo",
      titulo: "Patricia escribe por primera vez",
      hecho: initialInbound !== undefined,
      at: initialInbound?.receivedAt.toISOString() ?? null,
      detalle: null,
    },
    {
      id: "bienvenida",
      titulo: "Sale la bienvenida",
      hecho: welcomeCita !== undefined,
      at: welcomeMessage?.sentAt.toISOString() ?? null,
      detalle: welcomeCita === undefined
        ? null
        : welcomeMessage?.durationSeconds === null || welcomeMessage?.durationSeconds === undefined
          ? "nota de voz"
          : `nota de voz de ${Math.round(welcomeMessage.durationSeconds)} s`,
    },
    {
      id: "respuesta",
      titulo: "Responde a la bienvenida",
      hecho: firstWelcomeResponse !== undefined,
      at: firstWelcomeResponse?.at.toISOString() ?? null,
      detalle: `nombre ${patricia.nombre} (${nameSource}) · hora ${patricia.hora ?? "sin responder"} · voz ${vozDe(patricia.voz)}`,
    },
    {
      id: "permitir",
      titulo: "Da el «Permitir» de Gmail",
      hecho: permitirDecision !== undefined,
      at: permitirDecision?.at.toISOString() ?? null,
      detalle: `${opts.permitirUrl} · ${opts.gmailLoginHint
        ? "va directo a la cuenta de Patricia"
        : "Google mostrará el selector de cuentas"}`,
    },
    {
      id: "rut",
      titulo: "Da su RUT",
      hecho: patricia.rut !== null && patricia.rut !== undefined,
      at: rutDecision?.at.toISOString() ?? null,
      detalle: patricia.rut !== null && patricia.rut !== undefined ? "dado" : "pendiente",
    },
    {
      id: "contexto",
      titulo: "Cuenta su contexto",
      hecho: context !== null,
      at: contextoDecision?.at.toISOString() ?? null,
      detalle: contextDetail,
    },
  ];
}
