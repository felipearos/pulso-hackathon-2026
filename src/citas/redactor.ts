/**
 * The redactor: turns a programada cita into the guion Luna will say. It
 * decides what the cita carries (the buena noticia, at most one cifra from the
 * motor de cifras, the closing pregunta), asks Claude for the body and passes
 * the full guion through the validador. It never synthesizes, sends or stores.
 */

import { ANGUSTIA_EMOJIS, SUENO_EMOJIS } from "../escalera/policy";
import { buenaNoticia, PAGO_RECIBIDO, type BuenaNoticia, type CompraEnCuotas } from "../figures/buena-noticia";
import { payoff } from "../figures/payoff";
import type { Cita, Etapa, EstadoDeCuenta, TipoCita } from "../patricia/entities";
import type { Llm } from "../ports";
import {
  SAFE_TEMPLATE,
  validateText,
  type Rejection,
  type ValidatedText,
  type ValidatorDecision,
} from "../validator/validator";
import { montoEnPantalla } from "../voz/montos";

export const REDACTOR_MODEL = "claude-opus-5-5";

/** Step between the cuotas tried for la salida. */
const CUOTA_STEP = 10_000;
/** Most cuotas tried above the pago mínimo before la salida gives up. */
const MAX_CUOTA_STEPS = 50;
/** A cita's audio lasts this many seconds or less. */
export const MAX_AUDIO_SECONDS = 45;

/** The one figure a cita may carry, computed by the motor de cifras. */
export type CifraPermitida =
  | { kind: "pago-minimo"; monto: number }
  | { kind: "salida"; meses: number; cuota: number }
  /** Paying like she did this week: the ISO date she is free of the card, and how many months before only the mínimo. */
  | { kind: "fecha-libre"; freeOn: string; mesesAdelantados: number };

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export type DecisionDeCita = {
  tipo: TipoCita;
  etapa: Etapa;
  buenaNoticia: BuenaNoticia;
  cifra: CifraPermitida | null;
  /** Closing question she answers with an emoji; no digits. */
  pregunta: string;
  motivo: string;
};

/**
 * The guion de bienvenida, fixed: no LLM writes it. It has no digits, so the
 * hours are in words, and it stays well under MAX_AUDIO_SECONDS; if it were
 * ever longer it goes out as it is, never shortened by the LLM.
 */
export const GUION_BIENVENIDA =
  "Hola, soy Luna. Estoy aquí para mirar tus cuentas contigo, con calma. " +
  "¿Cómo te gusta que te llamen? " +
  "Te voy a hablar los lunes y jueves a las diez y media de la noche, y el domingo a las nueve y media. " +
  "¿Te acomoda esa hora, o prefieres otra? " +
  "Esta es una de mis dos voces; si prefieres la otra, escríbeme «otra voz». " +
  "Justo después te llega un mensaje con el enlace para darme «Permitir». " +
  "Respóndeme escribiendo, cuando quieras.";

const PREGUNTA_BIENVENIDA = "¿Te parece si seguimos conversando así? Respóndeme con un 💛 o un 🤔";
const PREGUNTA = "¿Cómo te cayó escuchar esto? Respóndeme con un 💛 o un 🤔";
export const PREGUNTA_GRADUADA =
  "¿Lo abres tú o te lo cuento yo? Si lo abres tú, respóndeme con un 👍; si te lo cuento yo, con un 👌";
/**
 * Sunday asks how the plata feels and, optionally, how she slept this week, in words and emoji only: a digit
 * would spend the cita's one figure.
 */
const PREGUNTA_ANGUSTIA =
  `¿Cómo te sientes con la plata esta semana, del uno al cinco? Respóndeme con un emoji, de tranquila a muy angustiada: ${ANGUSTIA_EMOJIS.join(" ")}. ` +
  `Y si quieres, cuéntame cómo dormiste esta semana, de bien a mal: ${SUENO_EMOJIS.join(" ")}`;

/** La salida: the smallest round cuota above the pago mínimo that ends the balance. */
function salida(cifras: NonNullable<EstadoDeCuenta["cifras"]>, fecha: string): CifraPermitida | null {
  const { firstMinimum } = payoff(cifras, 0, fecha);
  const first = (Math.floor(firstMinimum / CUOTA_STEP) + 1) * CUOTA_STEP;
  for (let step = 0; step < MAX_CUOTA_STEPS; step++) {
    const cuota = first + step * CUOTA_STEP;
    const { fixedPayment } = payoff(cifras, cuota, fecha);
    if (fixedPayment.ends) return { kind: "salida", meses: fixedPayment.months, cuota };
  }
  return null;
}

/** La fecha en que queda libre paying `monto` every month, when it comes before paying only the mínimo. */
function fechaLibre(
  cifras: NonNullable<EstadoDeCuenta["cifras"]>,
  monto: number,
  fecha: string,
): CifraPermitida | null {
  const { fixedPayment, versusMinimum } = payoff(cifras, monto, fecha);
  if (!fixedPayment.ends || !versusMinimum.comparable || versusMinimum.monthsSaved <= 0) return null;
  return { kind: "fecha-libre", freeOn: fixedPayment.freeOn, mesesAdelantados: versusMinimum.monthsSaved };
}

/**
 * What tonight's cita says, decided from the cita and her latest estado de
 * cuenta. The domingo cita carries the same cifra as any other, asks the
 * angustia and celebrates when a «recibimos tu pago» arrived this week
 * (`pagoRecibido`). Her registered compras en cuotas (`comprasEnCuotas`) can
 * give the buena noticia when one is about to end. When she made a pago sobre
 * el mínimo this week (`pagoSobreElMinimo`, its monto), the domingo's cifra is
 * the fecha en que queda libre paying that much each month, if it comes earlier
 * than paying only the mínimo; otherwise the usual cifra.
 */
export function decisionDeCita(input: {
  cita: Cita;
  estadoDeCuenta: EstadoDeCuenta | null;
  pagoRecibido?: boolean;
  comprasEnCuotas?: CompraEnCuotas[];
  pagoSobreElMinimo?: number | null;
}): DecisionDeCita {
  const { cita, estadoDeCuenta, pagoRecibido = false, comprasEnCuotas = null, pagoSobreElMinimo = null } = input;
  const cifras = estadoDeCuenta?.cifras ?? null;
  const bienvenida = cita.tipo === "bienvenida" || cita.tipo === "bienvenida-de-vuelta";
  const domingo = cita.tipo === "domingo";
  const graduada = cita.tipo === "graduada";

  let cifra: CifraPermitida | null = null;
  if (cifras !== null && domingo && pagoSobreElMinimo !== null && pagoSobreElMinimo > 0) {
    cifra = fechaLibre(cifras, pagoSobreElMinimo, cita.fecha);
  }
  if (cifra === null && cifras !== null && !bienvenida && !graduada) {
    cifra =
      cita.etapa === 2
        ? salida(cifras, cita.fecha)
        : { kind: "pago-minimo", monto: payoff(cifras, 0, cita.fecha).firstMinimum };
  }

  return {
    tipo: cita.tipo,
    etapa: cita.etapa,
    buenaNoticia:
      domingo && pagoRecibido
        ? PAGO_RECIBIDO
        : buenaNoticia({ mora: cifras?.overdue ?? null, pagosAnteriores: null, comprasEnCuotas }),
    cifra,
    pregunta: domingo
      ? PREGUNTA_ANGUSTIA
      : bienvenida
        ? PREGUNTA_BIENVENIDA
        : graduada
          ? PREGUNTA_GRADUADA
          : PREGUNTA,
    motivo: cita.motivo,
  };
}

/** The figures the validador lets through for this cifra, and how many distinct ones. */
export function allowedFigures(cifra: CifraPermitida | null): { allowedFigures: number[]; maxFigures: number } {
  if (cifra === null) return { allowedFigures: [], maxFigures: 1 };
  if (cifra.kind === "pago-minimo") return { allowedFigures: [cifra.monto], maxFigures: 1 };
  if (cifra.kind === "fecha-libre")
    return { allowedFigures: [Number(cifra.freeOn.slice(0, 4)), cifra.mesesAdelantados], maxFigures: 2 };
  return { allowedFigures: [cifra.meses, cifra.cuota], maxFigures: 2 };
}

/** How the cifra must be written in the guion, word for word. */
export function cifraEscrita(cifra: CifraPermitida): string {
  if (cifra.kind === "pago-minimo") return montoEnPantalla(cifra.monto);
  if (cifra.kind === "fecha-libre") {
    const mes = MESES[Number(cifra.freeOn.slice(5, 7)) - 1];
    const antes = cifra.mesesAdelantados === 1 ? "1 mes antes" : `${cifra.mesesAdelantados} meses antes`;
    return `en ${mes} de ${cifra.freeOn.slice(0, 4)}, ${antes}`;
  }
  return `${cifra.meses} meses pagando ${montoEnPantalla(cifra.cuota)}`;
}

const SYSTEM = [
  "Eres Luna y escribes el guion de una nota de voz para Patricia, una persona que dejó de mirar sus cuentas por miedo.",
  "Hablas en español de Chile, neutro, de tú, con calidez y calma.",
  "Nunca reprochas, nunca apuras, nunca culpas.",
  "Respondes solo con el guion, sin comillas ni títulos.",
].join(" ");

function cifraInstruccion(cifra: CifraPermitida | null): string {
  if (cifra === null) return "No escribas ninguna cifra ni ningún número con dígitos.";
  if (cifra.kind === "fecha-libre") return `Luego ${fechaLibreInstruccion(cifra)}`;
  return `Luego menciona una sola cifra, escrita exactamente así: «${cifraEscrita(cifra)}». No escribas ningún otro número con dígitos.`;
}

/** La fecha en que queda libre: said warmly, as what paying like this week gives her. */
function fechaLibreInstruccion(cifra: Extract<CifraPermitida, { kind: "fecha-libre" }>): string {
  const escrita = cifraEscrita(cifra);
  return `cuéntale con calma que, pagando como pagó esta semana, queda libre de la tarjeta ${escrita} que pagando solo el mínimo. Escribe la fecha exactamente así: «${escrita}». No escribas ningún otro número con dígitos.`;
}

function draftPrompt(decision: DecisionDeCita): string {
  return [
    "Escribe el guion de la cita de esta noche.",
    `Parte con esta buena noticia, que es verdad: «${decision.buenaNoticia.texto}». Dila sin dígitos.`,
    cifraInstruccion(decision.cifra),
    "Que sea cálido, sin reproche ni urgencia.",
    "Máximo unas ochenta palabras, para que el audio dure menos de cuarenta y cinco segundos.",
    "No termines con una pregunta: la pregunta final se agrega después.",
  ].join("\n");
}

function shortenPrompt(decision: DecisionDeCita, acortar: { guion: string; durationSeconds: number }): string {
  return [
    `Acorta este guion: duró ${acortar.durationSeconds} segundos y debe durar menos de ${MAX_AUDIO_SECONDS}.`,
    `Mantén la buena noticia: «${decision.buenaNoticia.texto}».`,
    decision.cifra === null
      ? "No escribas ninguna cifra ni ningún número con dígitos."
      : decision.cifra.kind === "fecha-libre"
        ? `Mantén la fecha en que queda libre: ${fechaLibreInstruccion(decision.cifra)}`
        : `Mantén la cifra escrita exactamente así: «${cifraEscrita(decision.cifra)}». No escribas ningún otro número con dígitos.`,
    "No termines con una pregunta.",
    "",
    acortar.guion,
  ].join("\n");
}

function describeForRedraft(rejection: Rejection): string {
  switch (rejection.kind) {
    case "figure-not-allowed":
      return `la cifra ${rejection.figure} no está permitida`;
    case "too-many-figures":
      return "tiene más cifras de las permitidas";
    case "forbidden-word":
      return `usa la palabra prohibida «${rejection.word}»`;
    case "tone":
      return `el tono no sirve: ${rejection.reason}`;
  }
}

function redraftPrompt(decision: DecisionDeCita, body: string, rejections: Rejection[]): string {
  return [
    "Reescribe este guion corrigiendo lo que se rechazó:",
    ...rejections.map((r) => `- ${describeForRedraft(r)}`),
    `Parte con esta buena noticia: «${decision.buenaNoticia.texto}». Dila sin dígitos.`,
    cifraInstruccion(decision.cifra),
    "Máximo unas ochenta palabras. No termines con una pregunta.",
    "",
    body,
  ].join("\n");
}

/** Writes the guion for a decisión de cita; it always ends with the pregunta and has passed the validador. */
export async function redactarGuion(input: {
  llm: Llm;
  decision: DecisionDeCita;
  recordDecision: (d: ValidatorDecision) => void;
  acortar?: { guion: string; durationSeconds: number };
}): Promise<{ guion: string; source: ValidatedText["source"] }> {
  const { llm, decision, recordDecision, acortar } = input;
  const withPregunta = (body: string) => `${body.trim()} ${decision.pregunta}`;
  const safeTemplate = withPregunta(SAFE_TEMPLATE);

  let body: string;
  try {
    const prompt = acortar === undefined ? draftPrompt(decision) : shortenPrompt(decision, acortar);
    body = await llm.complete({ model: REDACTOR_MODEL, system: SYSTEM, prompt });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    recordDecision({
      kind: "safe-template",
      reason: `No se pudo escribir el guion (${error}); salió la plantilla segura sin cifra.`,
      input: { draft: "", redraft: null, rejections: [], error },
    });
    return { guion: safeTemplate, source: "safe-template" };
  }

  const figures = allowedFigures(decision.cifra);
  const validated = await validateText({
    draft: withPregunta(body),
    allowedFigures: figures.allowedFigures,
    maxFigures: figures.maxFigures,
    llm,
    redraft: async (rejections) =>
      withPregunta(
        await llm.complete({ model: REDACTOR_MODEL, system: SYSTEM, prompt: redraftPrompt(decision, body, rejections) }),
      ),
    safeTemplate,
    recordDecision,
  });
  return { guion: validated.text, source: validated.source };
}
