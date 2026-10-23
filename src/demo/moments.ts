/**
 * The scripted demo week the control room shows until the real pipeline
 * feeds it. Every figure comes from the PRD's synthetic data (06), so the
 * panel already tells the story the pitch tells; each moment only adds to
 * what the previous ones left on screen.
 */

import { MADRUGADA_TEXT } from "../escalera/madrugada";

export const MOMENT_IDS = [
  "monday-email",
  "monday-night",
  "thursday-night",
  "sunday-early",
  "week-4",
  "week-5",
] as const;

export type MomentId = (typeof MOMENT_IDS)[number];

export function isMomentId(value: string): value is MomentId {
  return (MOMENT_IDS as readonly string[]).includes(value);
}

export const NIGHT_AUDIO_URL = "/demo/audio/night-audio-test.ogg";

export interface ChatMessage {
  from: "luna" | "patricia";
  at: string;
  kind: "voice" | "text" | "image";
  /** The transcript for a voice note, the body for text, the caption for an image. */
  text: string;
  duration?: string;
  audioUrl?: string;
}

export interface Figure {
  label: string;
  value: string;
  source: string;
}

export interface Nights {
  invited: number;
  listened: number;
  noPressure: number;
}

export interface Snapshot {
  moment: MomentId | "start";
  clock: string;
  stepsDone: number;
  figures: Figure[];
  metrics: { lookedByHer: string; aboveMinimum: string; anxiety: string };
  nights: Nights;
  before: { day: string; text: string; crossed: boolean }[];
  now: { at: string; text: string; lit: boolean }[];
  messages: ChatMessage[];
  decisions: { at: string; text: string }[];
}

interface Moment {
  id: MomentId;
  clock: string;
  stepsDone: number;
  figures?: Figure[];
  metrics?: Partial<Snapshot["metrics"]>;
  nights?: Nights;
  messages?: ChatMessage[];
  decisions?: { at: string; text: string }[];
}

const BEFORE = [
  { day: "Lun", text: "Llega el correo del banco. No lo abre.", crossedBy: "monday-night" },
  { day: "Mié", text: "Remedios de su mamá en tres cuotas" },
  { day: "Vie", text: "Paga el mínimo de la tarjeta", crossedBy: "thursday-night" },
  { day: "Sáb", text: "Ropa para el nieto, en seis cuotas" },
  { day: "Dom", text: "Se desvela pensando en la plata, 02:30" },
] as const satisfies readonly { day: string; text: string; crossedBy?: MomentId }[];

const NOW: { at: string; text: string; litBy: MomentId }[] = [
  { at: "Lun 09:10", text: "Luna abre el estado de cuenta por ella", litBy: "monday-email" },
  { at: "Lun 22:30", text: "Escucha una buena noticia: 7 meses al día", litBy: "monday-night" },
  { at: "Jue 22:30", text: "Decide pagar $50.000, no solo el mínimo", litBy: "thursday-night" },
  { at: "Dom 02:30", text: "Escribe y Luna la calma, sin cifras", litBy: "sunday-early" },
  { at: "Semana 4", text: "Abre ella el estado de La Estrella", litBy: "week-4" },
  { at: "Semana 5", text: "Abre sola su estado de cuenta 9", litBy: "week-5" },
];

const LIRCAY_8: Figure[] = [
  { label: "Pago mínimo", value: "$41.900", source: "del PDF" },
  { label: "Vence", value: "viernes 20 de noviembre", source: "del PDF" },
  { label: "Meses pagando a tiempo", value: "7 · no está en DICOM", source: "historial del PDF" },
  { label: "Deuda total", value: "$640.000", source: "del PDF, se dice en el peldaño 2" },
];

const THURSDAY: Figure[] = [
  { label: "Pedidos pagados esta semana", value: "$81.000", source: "3 correos de transferencia" },
  { label: "Tu puerta abierta (10 %)", value: "$8.100", source: "motor de cifras" },
  { label: "Pago propuesto", value: "$50.000 → libre en 17 meses", source: "motor de cifras" },
];

const MOMENTS: Moment[] = [
  {
    id: "monday-email",
    clock: "Semana 1 · lunes 16 de noviembre · 09:10",
    stepsDone: 0,
    figures: LIRCAY_8,
    decisions: [
      {
        at: "Lun 09:10",
        text: "Llegó el estado de cuenta 8 del Banco Lircay. Saqué las cifras y no le digo nada todavía: espero su rato libre, a las 22:30.",
      },
    ],
  },
  {
    id: "monday-night",
    clock: "Semana 1 · lunes 16 de noviembre · 22:30",
    stepsDone: 1,
    nights: { invited: 1, listened: 1, noPressure: 0 },
    messages: [
      {
        from: "luna",
        at: "Lun 16-nov · 22:30",
        kind: "voice",
        duration: "0:24",
        audioUrl: NIGHT_AUDIO_URL,
        text: "Hola, Patty. Soy Luna. Abrí tu estado de cuenta, y tengo una buena noticia: llevas siete meses pagando siempre a tiempo. No estás en DICOM. Una sola cifra para esta semana: el viernes vence tu pago, y el mínimo es cuarenta y un mil novecientos. El jueves en la noche lo vemos juntas, sin apuro. ¿Me mandas un pulgar si lo escuchaste? Que descanses.",
      },
      { from: "luna", at: "22:30", kind: "text", text: "Estás al día ✅ · Mínimo de este viernes: $41.900" },
      { from: "patricia", at: "22:33", kind: "text", text: "👍" },
    ],
    decisions: [
      {
        at: "Lun 22:30",
        text: "Elegí la buena noticia «7 meses al día» porque el historial muestra 7 pagos a tiempo.",
      },
      { at: "Lun 22:30", text: "Una sola cifra: el mínimo de $41.900. El total queda para el peldaño 2." },
      { at: "Lun 22:33", text: "Respondió 👍: miró su cuenta por primera vez en siete meses. Peldaño 1." },
    ],
  },
  {
    id: "thursday-night",
    clock: "Semana 1 · jueves 19 de noviembre · 22:30",
    stepsDone: 1,
    figures: [...LIRCAY_8, ...THURSDAY],
    metrics: { aboveMinimum: "1 de 1" },
    nights: { invited: 2, listened: 2, noPressure: 0 },
    messages: [
      {
        from: "luna",
        at: "Jue 19-nov · 22:30",
        kind: "voice",
        duration: "0:32",
        text: "Hola, Patty. Esta semana te pagaron tres pedidos, ¡qué buena semana! Apartando un poquito de cada uno, llevas ocho mil cien para bajar tu tarjeta: tu puerta abierta por si tu mamá te necesita. Si los sumas al mínimo, mañana pagas cincuenta mil. Pagando cincuenta mil al mes, en diecisiete meses no le debes nada a la tarjeta. ¿Pagamos cincuenta mil, con un pulgar, o el mínimo, con un ok? Las dos están bien.",
      },
      { from: "luna", at: "22:30", kind: "text", text: "👍 pagar $50.000 · 👌 pagar el mínimo ($41.900)" },
      { from: "patricia", at: "22:34", kind: "text", text: "👍" },
      {
        from: "luna",
        at: "22:34",
        kind: "text",
        text: "Anotado, Patty. Mañana pagas $50.000. Recuerda: yo nunca pago por ti ni te pido transferencias; lo pagas tú, como siempre.",
      },
    ],
    decisions: [
      {
        at: "Jue 16:00",
        text: "Descarté «URGENTE: tu tarjeta será bloqueada hoy»: el remitente imita al banco y no está en la lista.",
      },
      {
        at: "Jue 22:30",
        text: "Le pagaron 3 pedidos ($81.000). Propongo $50.000: el mínimo más el 10 % que apartó ($8.100).",
      },
      { at: "Jue 22:34", text: "Eligió pagar $50.000. La plata nunca sale de su cuenta: paga ella." },
    ],
  },
  {
    id: "sunday-early",
    clock: "Semana 1 · domingo 22 de noviembre · 02:30",
    stepsDone: 1,
    messages: [
      { from: "patricia", at: "Dom 22-nov · 02:30", kind: "text", text: "Luna, no puedo dormir pensando en la plata" },
      {
        from: "luna",
        at: "02:30",
        kind: "voice",
        duration: "0:15",
        text: MADRUGADA_TEXT,
      },
    ],
    decisions: [
      {
        at: "Dom 02:30",
        text: "Madrugada: sin cifras ni preguntas. Anoté su preocupación para la cita del lunes a las 22:30.",
      },
    ],
  },
  {
    id: "week-4",
    clock: "Semana 4 · lunes 7 de diciembre · 22:30",
    stepsDone: 4,
    figures: [
      { label: "Deuda Banco Lircay", value: "$640.000 → bajando $50.000 al mes", source: "motor de cifras" },
      { label: "La Estrella · pago mínimo", value: "$18.500", source: "del pantallazo que mandó ella" },
      { label: "La Estrella · saldo", value: "$185.000 · tarjeta cortada", source: "del pantallazo" },
    ],
    metrics: { lookedByHer: "1", anxiety: "3" },
    nights: { invited: 6, listened: 5, noPressure: 1 },
    messages: [
      {
        from: "luna",
        at: "Lun 7-dic · 22:30",
        kind: "voice",
        duration: "0:20",
        text: "Hola, Patty. Llegó el estado de cuenta de La Estrella, la tarjeta que cortaste. Ese no lo puedo abrir yo, porque viene con un link. ¿Lo abrimos juntas? Ábrelo, y mira solo la esquina donde dice pago mínimo. Nada más. Sácale una foto y me la mandas. Yo estoy aquí.",
      },
      { from: "luna", at: "22:30", kind: "text", text: "Ábrelo tú y mira solo el pago mínimo" },
      { from: "patricia", at: "22:40", kind: "image", text: "Pantallazo del portal de La Estrella" },
      {
        from: "luna",
        at: "22:40",
        kind: "text",
        text: "¡Lo abriste tú, Patty! El mínimo de La Estrella es $18.500, y ya te quedan solo $185.000. Como la cortaste, no crece más: va de bajada.",
      },
    ],
    decisions: [
      { at: "Jue 26-nov", text: "No escuchó el audio. Sin recordatorio ni reproche: la invitación vuelve el lunes." },
      { at: "Lun 7-dic", text: "La Estrella solo trae un link, así que lo abre ella. Le pido mirar solo el pago mínimo." },
      { at: "Lun 22:40", text: "Mandó el pantallazo: el mínimo es $18.500. Peldaño 4." },
    ],
  },
  {
    id: "week-5",
    clock: "Semana 5 · lunes 14 de diciembre · 22:30",
    stepsDone: 5,
    figures: [
      { label: "Estado de cuenta 9 · pago mínimo", value: "$40.100", source: "lo dijo ella" },
      { label: "Deuda total", value: "$618.300 · bajó $21.700", source: "del PDF" },
      { label: "Supermercado Don Pepe", value: "última cuota: $22.450", source: "del PDF" },
    ],
    metrics: { lookedByHer: "2", aboveMinimum: "2 de 2", anxiety: "de 3 a 2" },
    nights: { invited: 9, listened: 7, noPressure: 2 },
    messages: [
      {
        from: "luna",
        at: "Lun 14-dic · 22:30",
        kind: "voice",
        duration: "0:10",
        text: "Hola, Patty. Llegó tu estado de cuenta de diciembre. Esta vez, ¿lo abres tú? Yo estoy aquí al lado. Dime solo una cosa: el pago mínimo.",
      },
      { from: "patricia", at: "22:38", kind: "text", text: "el mínimo es 40.100" },
      {
        from: "luna",
        at: "22:38",
        kind: "voice",
        duration: "0:06",
        text: "¡Lo abriste tú! Siete meses sin abrirlo, y este lo abriste tú.",
      },
    ],
    decisions: [
      { at: "Jue 10-dic", text: "No escuchó. Sin presión: no son dos noches seguidas, la escalera no baja." },
      { at: "Lun 14-dic", text: "Llegó el estado de cuenta 9. Esta vez no lo abro yo: se lo pido a ella." },
      { at: "Lun 22:38", text: "Lo abrió ella: el mínimo es $40.100. Peldaño 5." },
    ],
  },
];

const START: Snapshot = {
  moment: "start",
  clock: "Semana 1 · lunes 16 de noviembre · 09:00",
  stepsDone: 0,
  figures: [],
  metrics: { lookedByHer: "0", aboveMinimum: "0 de 0", anxiety: "—" },
  nights: { invited: 0, listened: 0, noPressure: 0 },
  before: BEFORE.map(({ day, text }) => ({ day, text, crossed: false })),
  now: NOW.map(({ at, text }) => ({ at, text, lit: false })),
  messages: [],
  decisions: [],
};

/** What the control room shows once every moment up to `moment` has happened. */
export function snapshotAt(moment: MomentId | "start"): Snapshot {
  if (moment === "start") return START;
  const passed = MOMENTS.slice(0, MOMENT_IDS.indexOf(moment) + 1);
  const seen = new Set<MomentId>(passed.map((m) => m.id));
  return passed.reduce<Snapshot>(
    (snapshot, m) => ({
      moment: m.id,
      clock: m.clock,
      stepsDone: m.stepsDone,
      figures: m.figures ?? snapshot.figures,
      metrics: { ...snapshot.metrics, ...m.metrics },
      nights: m.nights ?? snapshot.nights,
      before: snapshot.before,
      now: snapshot.now,
      messages: [...snapshot.messages, ...(m.messages ?? [])],
      decisions: [...snapshot.decisions, ...(m.decisions ?? [])],
    }),
    {
      ...START,
      before: BEFORE.map((row) => ({
        day: row.day,
        text: row.text,
        crossed: "crossedBy" in row && seen.has(row.crossedBy),
      })),
      now: NOW.map(({ at, text, litBy }) => ({ at, text, lit: seen.has(litBy) })),
    },
  );
}
