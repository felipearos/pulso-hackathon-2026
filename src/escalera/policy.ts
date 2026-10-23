/**
 * The política de etapa (ADR 0001): the LLM only classifies what Patricia
 * sends into intenciones; these rules turn them into a move on the escalera,
 * with a reason in Spanish the control room can show. Pure: no clock, no
 * database, so a move is repeatable in the live demo.
 */

export type Etapa = 1 | 2 | 3 | 4 | 5 | "graduada";

export type Angustia = 1 | 2 | 3 | 4 | 5;

/** The closed list of intenciones the LLM may classify a message into. */
export type Intencion =
  /** 👌 or she only listened: she stays, never a reason to move up. */
  | { kind: "listened" }
  /** 👍 or an equivalent answer to the cita. */
  | { kind: "accepted" }
  | { kind: "minimum" }
  | { kind: "angustia"; value: Angustia }
  | { kind: "doesNotWantToSee" }
  | { kind: "pause" }
  | { kind: "hello" }
  | { kind: "askWhy" }
  | { kind: "askWhatRead" }
  | { kind: "crisis" }
  | { kind: "other" };

export type Senal = {
  intencion: Intencion;
  /** Etapa of the cita she was answering; null if she wrote out of the blue. */
  citaEtapa: Etapa | null;
};

export type EtapaInput = {
  etapa: Etapa;
  /** Chronological, oldest first. */
  senales: Senal[];
  /** Newest angustia she reported before these senales; null if none. */
  lastAngustia: Angustia | null;
  /** A store estado de cuenta is available. */
  estadoDeCuentaTienda: boolean;
  /** A new bank estado de cuenta arrived. */
  estadoDeCuentaBancoNuevo: boolean;
};

export type EtapaMove = {
  kind: "up" | "down" | "stay" | "freeze" | "graduate";
  from: Etapa;
  to: Etapa;
  reason: string;
};

const ANGUSTIA_DOWN = 4;

function rank(etapa: Etapa): number {
  return etapa === "graduada" ? 6 : etapa;
}

function fromRank(n: number): Etapa {
  if (n >= 6) return "graduada";
  if (n <= 1) return 1;
  return n as Etapa;
}

function isAnswer(intencion: Intencion): boolean {
  return intencion.kind === "accepted" || intencion.kind === "minimum";
}

function stayReason(senal: Senal | undefined): string {
  if (!senal) return "se queda: sin señal";
  const { intencion, citaEtapa } = senal;
  switch (intencion.kind) {
    case "accepted":
    case "minimum":
      return citaEtapa === null
        ? "se queda: respondió sin una cita"
        : `se queda: respondió una cita de la etapa ${citaEtapa}`;
    case "listened":
      return "se queda: solo escuchó";
    case "angustia":
      return `se queda: angustia ${intencion.value}`;
    case "pause":
      return "se queda: pidió pausa";
    case "hello":
      return "se queda: solo saludó";
    case "askWhy":
      return "se queda: preguntó por qué";
    case "askWhatRead":
      return "se queda: preguntó qué leyó Luna";
    // doesNotWantToSee and crisis never get here: decideEtapa handles them first.
    case "doesNotWantToSee":
    case "crisis":
    case "other":
      return "se queda: sin señal de avance";
  }
}

/** Decides one move on the escalera from the senales of a conversation. */
export function decideEtapa(input: EtapaInput): EtapaMove {
  const { etapa: from, senales } = input;
  const stay = (reason: string): EtapaMove => ({ kind: "stay", from, to: from, reason });

  if (senales.some((s) => s.intencion.kind === "crisis")) {
    return { kind: "freeze", from, to: from, reason: "congelada: crisis" };
  }

  const downSignal = senales.find(
    (s) =>
      s.intencion.kind === "doesNotWantToSee" ||
      (s.intencion.kind === "angustia" && s.intencion.value >= ANGUSTIA_DOWN),
  );
  if (downSignal) {
    const why =
      downSignal.intencion.kind === "angustia"
        ? `angustia ${downSignal.intencion.value}`
        : "dijo que no quiere ver eso";
    if (from === 1) return stay(`se queda: ya está en la primera etapa (${why})`);
    return { kind: "down", from, to: fromRank(rank(from) - 1), reason: `bajó: ${why}` };
  }

  const answered = senales.some((s) => isAnswer(s.intencion) && s.citaEtapa === from);
  if (answered) {
    if (from === "graduada") return stay("se queda: ya está graduada");

    let latestAngustia = input.lastAngustia;
    for (const s of senales) {
      if (s.intencion.kind === "angustia") latestAngustia = s.intencion.value;
    }
    if (latestAngustia !== null && latestAngustia >= ANGUSTIA_DOWN) {
      return stay(`se queda: la última angustia fue ${latestAngustia}`);
    }

    const to = fromRank(rank(from) + 1);
    if (to === 4 && !input.estadoDeCuentaTienda) {
      return stay("se queda: falta un estado de cuenta de la tienda");
    }
    if (to === 5 && !input.estadoDeCuentaBancoNuevo) {
      return stay("se queda: falta un estado de cuenta nuevo del banco");
    }

    const angustiaPart = latestAngustia === null ? "sin angustia" : `angustia ${latestAngustia}`;
    const why = `respondió la cita de la etapa ${from}, ${angustiaPart}`;
    if (to === "graduada") return { kind: "graduate", from, to, reason: `se graduó: ${why}` };
    return { kind: "up", from, to, reason: `subió: ${why}` };
  }

  return stay(stayReason(senales.at(-1)));
}

/**
 * Recalculates the etapa for the bienvenida de vuelta, after a pausa or a
 * crisis: etapa 1 after a crisis, otherwise one etapa down per estado de
 * cuenta cycle she missed, never below etapa 1.
 */
export function etapaOnReturn({
  etapa,
  missedCycles,
  afterCrisis,
}: {
  etapa: Etapa;
  missedCycles: number;
  afterCrisis: boolean;
}): { etapa: Etapa; reason: string } {
  if (afterCrisis) return { etapa: 1, reason: "vuelve en la etapa 1: después de una crisis" };

  const missed = Math.max(0, Math.floor(missedCycles));
  const next = fromRank(rank(etapa) - missed);
  const where = next === "graduada" ? "vuelve graduada" : `vuelve en la etapa ${next}`;
  const why =
    missed === 0
      ? "no perdió ningún ciclo de estado de cuenta"
      : `perdió ${missed} ${missed === 1 ? "ciclo" : "ciclos"} de estado de cuenta`;
  return { etapa: next, reason: `${where}: ${why}` };
}
