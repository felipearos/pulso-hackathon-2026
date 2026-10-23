import type { Database } from "bun:sqlite";
import type { Clock } from "../ports";
import type {
  Decision,
  EstadoDeCuenta,
  Etapa,
  EtapaCambio,
  MensajeEntrante,
  MensajeSaliente,
  Patricia,
  Senal,
  TipoDecision,
} from "./entities";

/**
 * Patricia's state over SQLite. There is one Patricia, so no call takes a user
 * id. Every timestamp written comes from the demo clock (ADR 0002); the
 * decision log only ever grows.
 */
export type Store = {
  getPatricia(): Patricia;
  updatePatricia(patch: Partial<Omit<Patricia, "etapa">>): Patricia;
  /** Moves her to `to` and appends the change to her etapa history. */
  setEtapa(to: Etapa, motivo: string): void;
  /** Oldest first. */
  etapaHistory(): EtapaCambio[];
  addEstadoDeCuenta(input: Omit<EstadoDeCuenta, "id" | "receivedAt">): EstadoDeCuenta;
  estadosDeCuenta(): EstadoDeCuenta[];
  addSenal(input: Omit<Senal, "id" | "receivedAt">): Senal;
  senales(): Senal[];
  addMensajeSaliente(input: Omit<MensajeSaliente, "id" | "sentAt">): MensajeSaliente;
  mensajesSalientes(): MensajeSaliente[];
  addMensajeEntrante(input: Omit<MensajeEntrante, "id" | "receivedAt">): MensajeEntrante;
  mensajesEntrantes(): MensajeEntrante[];
  /** Appends to the decision log; there is no way to edit or remove an entry. */
  recordDecision(input: { tipo: TipoDecision; motivo: string; datos: unknown }): Decision;
  /** Oldest first. */
  decisions(): Decision[];
};

type PatriciaRow = {
  nombre: string;
  voz: string | null;
  gmail_permitido: number;
  etapa: string;
  bolsillo: string | null;
  en_pausa: number;
};

type EtapaCambioRow = { at: string; from_etapa: string | null; to_etapa: string; motivo: string };

type EstadoDeCuentaRow = {
  id: number;
  origen: EstadoDeCuenta["origen"];
  ciclo: number;
  fecha_cierre: string | null;
  fecha_vencimiento: string | null;
  cifras: string | null;
  pago_minimo: number | null;
  received_at: string;
};

type SenalRow = {
  id: number;
  tipo: Senal["tipo"];
  mail_id: string;
  mail_from: string;
  subject: string;
  received_at: string;
};

type MensajeSalienteRow = {
  id: number;
  kind: MensajeSaliente["kind"];
  text: string | null;
  duration_seconds: number | null;
  whatsapp_id: string | null;
  sent_at: string;
};

type MensajeEntranteRow = {
  id: number;
  text: string;
  intencion: string | null;
  whatsapp_id: string | null;
  received_at: string;
};

type DecisionRow = { id: number; at: string; tipo: TipoDecision; motivo: string; datos: string };

// Etapas are stored as text so "graduada" and the numbered ones share a column.
function etapaToText(etapa: Etapa): string {
  return String(etapa);
}

function etapaFromText(text: string): Etapa {
  return text === "graduada" ? "graduada" : (Number(text) as Etapa);
}

function toPatricia(row: PatriciaRow): Patricia {
  return {
    nombre: row.nombre,
    voz: row.voz,
    gmailPermitido: row.gmail_permitido === 1,
    etapa: etapaFromText(row.etapa),
    bolsillo: row.bolsillo,
    enPausa: row.en_pausa === 1,
  };
}

function toEstadoDeCuenta(row: EstadoDeCuentaRow): EstadoDeCuenta {
  return {
    id: row.id,
    origen: row.origen,
    ciclo: row.ciclo,
    fechaCierre: row.fecha_cierre,
    fechaVencimiento: row.fecha_vencimiento,
    cifras: row.cifras === null ? null : JSON.parse(row.cifras),
    pagoMinimo: row.pago_minimo,
    receivedAt: new Date(row.received_at),
  };
}

function toSenal(row: SenalRow): Senal {
  return {
    id: row.id,
    tipo: row.tipo,
    origen: { mailId: row.mail_id, from: row.mail_from, subject: row.subject },
    receivedAt: new Date(row.received_at),
  };
}

function toMensajeSaliente(row: MensajeSalienteRow): MensajeSaliente {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    durationSeconds: row.duration_seconds,
    whatsappId: row.whatsapp_id,
    sentAt: new Date(row.sent_at),
  };
}

function toMensajeEntrante(row: MensajeEntranteRow): MensajeEntrante {
  return {
    id: row.id,
    text: row.text,
    intencion: row.intencion === null ? null : JSON.parse(row.intencion),
    whatsappId: row.whatsapp_id,
    receivedAt: new Date(row.received_at),
  };
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    at: new Date(row.at),
    tipo: row.tipo,
    motivo: row.motivo,
    datos: JSON.parse(row.datos),
  };
}

/** Builds the store over a migrated database. */
export function createStore(db: Database, clock: Clock): Store {
  const now = () => clock.now().toISOString();

  const selectPatricia = db.query<PatriciaRow, []>(
    "SELECT nombre, voz, gmail_permitido, etapa, bolsillo, en_pausa FROM patricia WHERE id = 1",
  );
  const updatePatriciaRow = db.query(
    `UPDATE patricia SET nombre = $nombre, voz = $voz, gmail_permitido = $gmailPermitido,
       bolsillo = $bolsillo, en_pausa = $enPausa WHERE id = 1`,
  );
  const updateEtapa = db.query("UPDATE patricia SET etapa = $etapa WHERE id = 1");
  const insertEtapaCambio = db.query(
    "INSERT INTO etapa_cambios (at, from_etapa, to_etapa, motivo) VALUES ($at, $from, $to, $motivo)",
  );
  const selectEtapaCambios = db.query<EtapaCambioRow, []>(
    "SELECT at, from_etapa, to_etapa, motivo FROM etapa_cambios ORDER BY id",
  );
  const insertEstadoDeCuenta = db.query<EstadoDeCuentaRow, Record<string, string | number | null>>(
    `INSERT INTO estados_de_cuenta
       (origen, ciclo, fecha_cierre, fecha_vencimiento, cifras, pago_minimo, received_at)
     VALUES ($origen, $ciclo, $fechaCierre, $fechaVencimiento, $cifras, $pagoMinimo, $receivedAt)
     RETURNING *`,
  );
  const selectEstadosDeCuenta = db.query<EstadoDeCuentaRow, []>("SELECT * FROM estados_de_cuenta ORDER BY id");
  const insertSenal = db.query<SenalRow, Record<string, string>>(
    `INSERT INTO senales (tipo, mail_id, mail_from, subject, received_at)
     VALUES ($tipo, $mailId, $from, $subject, $receivedAt) RETURNING *`,
  );
  const selectSenales = db.query<SenalRow, []>("SELECT * FROM senales ORDER BY id");
  const insertMensajeSaliente = db.query<MensajeSalienteRow, Record<string, string | number | null>>(
    `INSERT INTO mensajes_salientes (kind, text, duration_seconds, whatsapp_id, sent_at)
     VALUES ($kind, $text, $durationSeconds, $whatsappId, $sentAt) RETURNING *`,
  );
  const selectMensajesSalientes = db.query<MensajeSalienteRow, []>("SELECT * FROM mensajes_salientes ORDER BY id");
  const insertMensajeEntrante = db.query<MensajeEntranteRow, Record<string, string | null>>(
    `INSERT INTO mensajes_entrantes (text, intencion, whatsapp_id, received_at)
     VALUES ($text, $intencion, $whatsappId, $receivedAt) RETURNING *`,
  );
  const selectMensajesEntrantes = db.query<MensajeEntranteRow, []>("SELECT * FROM mensajes_entrantes ORDER BY id");
  const insertDecision = db.query<DecisionRow, Record<string, string>>(
    "INSERT INTO decisions (at, tipo, motivo, datos) VALUES ($at, $tipo, $motivo, $datos) RETURNING *",
  );
  const selectDecisions = db.query<DecisionRow, []>("SELECT * FROM decisions ORDER BY id");

  const getPatricia = (): Patricia => {
    const row = selectPatricia.get();
    if (!row) throw new Error("patricia row missing: was the database migrated?");
    return toPatricia(row);
  };

  return {
    getPatricia,

    updatePatricia(patch) {
      const next = { ...getPatricia(), ...patch };
      updatePatriciaRow.run({
        nombre: next.nombre,
        voz: next.voz,
        gmailPermitido: next.gmailPermitido ? 1 : 0,
        bolsillo: next.bolsillo,
        enPausa: next.enPausa ? 1 : 0,
      });
      return getPatricia();
    },

    setEtapa(to, motivo) {
      db.transaction(() => {
        const from = getPatricia().etapa;
        updateEtapa.run({ etapa: etapaToText(to) });
        insertEtapaCambio.run({ at: now(), from: etapaToText(from), to: etapaToText(to), motivo });
      })();
    },

    etapaHistory() {
      return selectEtapaCambios.all().map((row) => ({
        at: new Date(row.at),
        from: row.from_etapa === null ? null : etapaFromText(row.from_etapa),
        to: etapaFromText(row.to_etapa),
        motivo: row.motivo,
      }));
    },

    addEstadoDeCuenta(input) {
      const row = insertEstadoDeCuenta.get({
        origen: input.origen,
        ciclo: input.ciclo,
        fechaCierre: input.fechaCierre,
        fechaVencimiento: input.fechaVencimiento,
        cifras: input.cifras === null ? null : JSON.stringify(input.cifras),
        pagoMinimo: input.pagoMinimo,
        receivedAt: now(),
      });
      return toEstadoDeCuenta(row!);
    },

    estadosDeCuenta() {
      return selectEstadosDeCuenta.all().map(toEstadoDeCuenta);
    },

    addSenal(input) {
      const row = insertSenal.get({
        tipo: input.tipo,
        mailId: input.origen.mailId,
        from: input.origen.from,
        subject: input.origen.subject,
        receivedAt: now(),
      });
      return toSenal(row!);
    },

    senales() {
      return selectSenales.all().map(toSenal);
    },

    addMensajeSaliente(input) {
      const row = insertMensajeSaliente.get({
        kind: input.kind,
        text: input.text,
        durationSeconds: input.durationSeconds,
        whatsappId: input.whatsappId,
        sentAt: now(),
      });
      return toMensajeSaliente(row!);
    },

    mensajesSalientes() {
      return selectMensajesSalientes.all().map(toMensajeSaliente);
    },

    addMensajeEntrante(input) {
      const row = insertMensajeEntrante.get({
        text: input.text,
        intencion: input.intencion === null ? null : JSON.stringify(input.intencion),
        whatsappId: input.whatsappId,
        receivedAt: now(),
      });
      return toMensajeEntrante(row!);
    },

    mensajesEntrantes() {
      return selectMensajesEntrantes.all().map(toMensajeEntrante);
    },

    recordDecision({ tipo, motivo, datos }) {
      const row = insertDecision.get({ at: now(), tipo, motivo, datos: JSON.stringify(datos ?? null) });
      return toDecision(row!);
    },

    decisions() {
      return selectDecisions.all().map(toDecision);
    },
  };
}
