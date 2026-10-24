import type { Database } from "bun:sqlite";
import type { DemoClock } from "../clock/demo-clock";
import { parseSantiago } from "../clock/santiago";
import { addMonths, minimumPayment, type MinimumRule, type Statement } from "../figures/payoff";
import { montoEnPantalla } from "../voz/montos";
import type { Patricia } from "./entities";
import { createStore, type EstadoDeCuentaInput, type SenalInput } from "./store";

/**
 * Patricia's fictional history: seven estados de cuenta del banco she never
 * opened, the eighth that just arrived, and the señales of her mail. Every
 * name, address and amount is invented; mail domains use `.example` (RFC 2606).
 */

/** Monday 19 October 2026, 09:00 in Santiago: where the demo starts. */
export const PATRICIA_START = new Date("2026-10-19T09:00:00-03:00");

/**
 * Patricia's fictional RUT, the one the operator types in the «Permitir»
 * during the demo. Invented, in a range not assigned to people, and its
 * digits never appear in the estados de cuenta's figures.
 */
export const PATRICIA_RUT_FICTICIO = "33457982-4";

/** Patricia at the starting point: etapa 1, Gmail allowed, nothing named yet. */
export const PATRICIA_AT_START: Patricia = {
  nombre: "Patricia",
  voz: null,
  hora: null,
  gmailPermitido: true,
  rut: null,
  etapa: 1,
  bolsillo: null,
  enPausa: false,
};

const BANK = "Banco Ficticio";
const BANK_STATEMENTS_FROM = "estados@bancoficticio.example";
const BANK_PAYMENTS_FROM = "pagos@bancoficticio.example";
const BANK_NOTICES_FROM = "avisos@bancoficticio.example";
const CATALOGUE_FROM = "pagos@catalogoejemplo.example";

/** The bank's rate and pago mínimo rule, the same every cycle. */
const MONTHLY_RATE = 0.031;
const MINIMUM_RULE: MinimumRule = { percent: 0.0645, floor: 10_500, roundTo: 100 };

/** Total facturado per ciclo, 1 to 8: it creeps up while she pays only the minimum and buys in cuotas. */
const TOTAL_BILLED = [574_300, 585_100, 596_800, 608_200, 619_700, 631_500, 640_800, 650_000];

const MONTHS = ["marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre"];

/** Something that happened in her mail, at the time it arrived. */
export type StoryEvent<T> = { at: Date; input: T };

// Ciclo 1 closes on 15 March 2026; each estado de cuenta arrives four days
// after its cierre, early in the morning, and falls due on the 5th of the next month.
function cierre(ciclo: number): string {
  return addMonths("2026-03-15", ciclo - 1);
}

function vencimiento(ciclo: number): string {
  return addMonths("2026-04-05", ciclo - 1);
}

function arrival(ciclo: number): Date {
  return parseSantiago(`${addMonths("2026-03-19", ciclo - 1)}T06:12`);
}

/** Two days before the vencimiento, at night once her mamá is asleep: she pays the minimum on time. */
function payment(ciclo: number): Date {
  return parseSantiago(`${addMonths("2026-04-03", ciclo - 1)}T21:40`);
}

function cifras(ciclo: number): Statement {
  return { totalBilled: TOTAL_BILLED[ciclo - 1]!, monthlyRate: MONTHLY_RATE, minimumRule: MINIMUM_RULE, overdue: 0 };
}

const CICLOS = [1, 2, 3, 4, 5, 6, 7, 8];

/** The eight estados de cuenta del banco, oldest first; the eighth arrives the morning the demo starts. */
export const ESTADOS_DE_CUENTA: StoryEvent<EstadoDeCuentaInput>[] = CICLOS.map((ciclo) => ({
  at: arrival(ciclo),
  input: {
    origen: "banco",
    ciclo,
    fechaCierre: cierre(ciclo),
    fechaVencimiento: vencimiento(ciclo),
    cifras: cifras(ciclo),
    pagoMinimo: minimumPayment(cifras(ciclo).totalBilled, MINIMUM_RULE),
  },
}));

/** S1: the mail behind each estado de cuenta del banco, received with it. */
const S1: StoryEvent<SenalInput>[] = CICLOS.map((ciclo) => ({
  at: arrival(ciclo),
  input: {
    tipo: "S1",
    origen: {
      mailId: `mail-banco-estado-ciclo-${ciclo}`,
      from: BANK_STATEMENTS_FROM,
      subject: `${BANK}: tu estado de cuenta de ${MONTHS[ciclo - 1]} ya está disponible`,
    },
  },
}));

/** S5: «recibimos tu pago» for ciclos 1 to 7, the pago mínimo paid before each vencimiento. */
const S5: StoryEvent<SenalInput>[] = CICLOS.slice(0, 7).map((ciclo) => ({
  at: payment(ciclo),
  input: {
    tipo: "S5",
    origen: {
      mailId: `mail-banco-pago-ciclo-${ciclo}`,
      from: BANK_PAYMENTS_FROM,
      subject: `${BANK}: recibimos tu pago de ${montoEnPantalla(ESTADOS_DE_CUENTA[ciclo - 1]!.input.pagoMinimo!)}`,
    },
  },
}));

/** S3: the pedidos del catálogo paid the week before the start. */
const S3: StoryEvent<SenalInput>[] = [
  { at: parseSantiago("2026-10-13T11:05"), amount: 18_500, mailId: "mail-catalogo-pedido-a" },
  { at: parseSantiago("2026-10-15T16:30"), amount: 27_000, mailId: "mail-catalogo-pedido-b" },
  { at: parseSantiago("2026-10-17T10:20"), amount: 12_900, mailId: "mail-catalogo-pedido-c" },
].map(({ at, amount, mailId }) => ({
  at,
  input: {
    tipo: "S3",
    origen: { mailId, from: CATALOGUE_FROM, subject: `Te pagaron tu pedido del catálogo: ${montoEnPantalla(amount)}` },
    monto: amount,
  },
}));

/**
 * S4: the two compras en cuotas of the case's week (Wednesday and Saturday), at
 * night. Placed in the week before the start, since the story holds nothing after it.
 */
const S4: StoryEvent<SenalInput>[] = [
  {
    at: parseSantiago("2026-10-14T23:10"),
    input: {
      tipo: "S4",
      origen: {
        mailId: "mail-banco-cuotas-remedios",
        from: BANK_NOTICES_FROM,
        subject: `${BANK}: compra de ${montoEnPantalla(45_000)} en 3 cuotas en Farmacia Ejemplo`,
      },
    },
  },
  {
    at: parseSantiago("2026-10-17T22:45"),
    input: {
      tipo: "S4",
      origen: {
        mailId: "mail-banco-cuotas-ropa",
        from: BANK_NOTICES_FROM,
        subject: `${BANK}: compra de ${montoEnPantalla(36_000)} en 6 cuotas en Tienda Ejemplo`,
      },
    },
  },
];

/** Every señal of the story, oldest first. */
export const SENALES: StoryEvent<SenalInput>[] = [...S1, ...S5, ...S3, ...S4].sort(
  (a, b) => a.at.getTime() - b.at.getTime(),
);

/** Tables holding Patricia's history: a reset empties them and restarts their ids. */
export const RESET_TABLES = [
  // pendientes.cita_id references citas, so pendientes empties first.
  "pendientes",
  "citas",
  "etapa_cambios",
  // extracciones references estados_de_cuenta, so it empties first.
  "extracciones",
  "estados_de_cuenta",
  "senales",
  "mensajes_salientes",
  "mensajes_entrantes",
  "decisions",
] as const;

/**
 * Tables a reset keeps: rewritten in place (`patricia`, `reloj_demo`) or not
 * Patricia's history (`gmail_cuenta`: a reset must not cost her «Permitir»).
 */
export const KEPT_TABLES = [
  "patricia",
  "reloj_demo",
  "gmail_cuenta",
  "schema_migrations",
  "sqlite_sequence",
  // Which Meta deliveries were already taken in is about Meta, not about
  // Patricia: a reset that forgot them would let Meta's retry of a message
  // from before the reset be processed again, into the fresh story.
  "mensajes_procesados",
] as const;


/**
 * Loads the story into an empty history. Each row is written through a store
 * whose clock stands still at the event's time, so the stamps are exact on
 * any clock source, and the demo clock is left at the start.
 */
function loadPatriciaStory(db: Database, clock: DemoClock): void {
  let at = PATRICIA_START;
  const stamped = createStore(db, { now: () => at });
  const events = [
    ...ESTADOS_DE_CUENTA.map((event) => ({ at: event.at, add: () => stamped.addEstadoDeCuenta(event.input) })),
    ...SENALES.map((event) => ({ at: event.at, add: () => stamped.addSenal(event.input) })),
  ];
  // Stable sort: an estado de cuenta goes in before the S1 that arrived with it.
  for (const event of events.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    at = event.at;
    event.add();
  }
  // Her story starts before Luna has ever spoken: the first cita owes her the bienvenida.
  at = PATRICIA_START;
  stamped.addPendiente({ tipo: "bienvenida", motivo: "su primera cita", datos: null });
  clock.set(PATRICIA_START);
}

/**
 * Brings the whole base back to the starting point of her story, in one
 * transaction: empties her history, restarts its ids, puts her back at etapa 1
 * without writing an etapa change, and loads the story again.
 */
export function resetPatricia(db: Database, clock: DemoClock): void {
  db.transaction(() => {
    // The reset is the one exception to the append-only decision log: lift the
    // trigger, empty the log and put back the trigger exactly as the schema has it.
    const noDelete = db
      .query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'decisions_no_delete'")
      .get();
    if (!noDelete) throw new Error("the decisions_no_delete trigger is missing");
    db.run("DROP TRIGGER decisions_no_delete");
    for (const table of RESET_TABLES) db.run(`DELETE FROM ${table}`);
    db.run(noDelete.sql);
    db.run(`DELETE FROM sqlite_sequence WHERE name IN (${RESET_TABLES.map(() => "?").join(", ")})`, [
      ...RESET_TABLES,
    ]);
    db.run(
      `UPDATE patricia SET nombre = ?, voz = ?, hora_cita = ?, gmail_permitido = ?, rut = ?, etapa = ?, bolsillo = ?, en_pausa = ?
       WHERE id = 1`,
      [
        PATRICIA_AT_START.nombre,
        PATRICIA_AT_START.voz,
        PATRICIA_AT_START.hora ?? null,
        PATRICIA_AT_START.gmailPermitido ? 1 : 0,
        PATRICIA_AT_START.rut ?? null,
        String(PATRICIA_AT_START.etapa),
        PATRICIA_AT_START.bolsillo,
        PATRICIA_AT_START.enPausa ? 1 : 0,
      ],
    );
    loadPatriciaStory(db, clock);
  })();
}
