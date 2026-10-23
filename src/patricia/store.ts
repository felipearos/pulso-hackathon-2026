import type { Database } from "bun:sqlite";
import type { Clock } from "../ports";
import { plataApartada, type PlataApartada } from "../plata/apartado";
import { comprasEnCuotas, type CompraRegistrada } from "../plata/cuotas";
import type {
  Cita,
  Decision,
  EstadoDeCuenta,
  Extraccion,
  Etapa,
  EtapaCambio,
  MensajeEntrante,
  MensajeSaliente,
  Patricia,
  Pendiente,
  Senal,
  TipoDecision,
} from "./entities";

/** What `addEstadoDeCuenta` takes: every caller builds one through this type. */
export type EstadoDeCuentaInput = Omit<EstadoDeCuenta, "id" | "receivedAt">;

/** What `addSenal` takes. `monto` is what an S3's pedido or an S5's pago was; leave it out for every other señal. */
export type SenalInput = Omit<Senal, "id" | "receivedAt" | "monto"> & { monto?: number | null };

/**
 * Patricia's state over SQLite. There is one Patricia, so no call takes a user
 * id. Every timestamp written comes from the demo clock (ADR 0002); the
 * decision log only ever grows, except when the reset puts the whole base back
 * at the starting point (src/patricia/fixtures.ts).
 */
export type Store = {
  getPatricia(): Patricia;
  updatePatricia(patch: Partial<Omit<Patricia, "etapa">>): Patricia;
  /** Moves her to `to` and appends the change to her etapa history. */
  setEtapa(to: Etapa, motivo: string): void;
  /** Oldest first. */
  etapaHistory(): EtapaCambio[];
  addEstadoDeCuenta(input: EstadoDeCuentaInput): EstadoDeCuenta;
  estadosDeCuenta(): EstadoDeCuenta[];
  addSenal(input: SenalInput): Senal;
  senales(): Senal[];
  /** This week's plata apartada at the clock's current time. */
  plataApartada(): PlataApartada;
  /** The compras en cuotas that still have cuotas to bill at the clock's current time. */
  comprasEnCuotas(): CompraRegistrada[];
  /** The señal a mail already became; null if it never was seen. */
  senalForMail(mailId: string): Senal | null;
  addExtraccion(input: Omit<Extraccion, "id" | "extractedAt">): Extraccion;
  /** The extraction a mail already became; null if it never was extracted. */
  extraccionForMail(mailId: string): Extraccion | null;
  addMensajeSaliente(input: Omit<MensajeSaliente, "id" | "sentAt">): MensajeSaliente;
  mensajesSalientes(): MensajeSaliente[];
  addMensajeEntrante(input: Omit<MensajeEntrante, "id" | "receivedAt">): MensajeEntrante;
  mensajesEntrantes(): MensajeEntrante[];
  /**
   * Takes the Meta message id for processing, returning false if it was taken
   * before. Meta retries a delivery it believes failed, and the claim is what
   * makes the message arrive once: call it before processing, not after.
   */
  claimWhatsappId(whatsappId: string): boolean;
  /**
   * Gives the id back, so a later delivery of the same message is processed
   * instead of being discarded as a retry. Only for a claim whose processing
   * failed and wrote nothing: a claim kept after a failure loses the message
   * for good, because the webhook has already answered 200.
   */
  releaseWhatsappId(whatsappId: string): void;
  /** Appends to the decision log; there is no way to edit or remove an entry. */
  recordDecision(input: { tipo: TipoDecision; motivo: string; datos: unknown }): Decision;
  /** Oldest first. */
  decisions(): Decision[];
  /** Queues something for the next cita. */
  addPendiente(input: { tipo: Pendiente["tipo"]; motivo: string; datos: unknown }): Pendiente;
  /** What still waits for a cita, oldest first. */
  pendientes(): Pendiente[];
  /** Stamps the madrugada on the given pendientes; ones already deferred keep their first time. */
  deferPendientes(ids: readonly number[]): void;
  /**
   * Sets the cita of `fecha` and hands it the given pendientes, atomically.
   * Returns null, and changes nothing, when that day already has a cita.
   */
  addCita(
    input: Omit<Cita, "id" | "pendientes" | "programadaAt" | "mensajeSalienteId"> & { pendienteIds: readonly number[] },
  ): Cita | null;
  /** The cita of a Santiago day, or null. */
  citaOn(fecha: string): Cita | null;
  /** Oldest first. */
  citas(): Cita[];
  /** Stamps the mensaje saliente a cita went out as; false, and nothing changes, if it already had one. */
  markCitaSent(citaId: number, mensajeSalienteId: number): boolean;
};

type PatriciaRow = {
  nombre: string;
  voz: string | null;
  hora_cita: string | null;
  gmail_permitido: number;
  etapa: string;
  bolsillo: string | null;
  en_pausa: number;
};

type EtapaCambioRow = { at: string; from_etapa: string; to_etapa: string; motivo: string };

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

type ExtraccionRow = {
  id: number;
  estado_de_cuenta_id: number;
  mail_id: string;
  cifras: string;
  extracted_at: string;
};

type SenalRow = {
  id: number;
  tipo: Senal["tipo"];
  mail_id: string;
  mail_from: string;
  subject: string;
  monto: number | null;
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

type PendienteRow = {
  id: number;
  tipo: Pendiente["tipo"];
  motivo: string;
  datos: string;
  created_at: string;
  diferido_at: string | null;
  cita_id: number | null;
};

type CitaRow = {
  id: number;
  fecha: string;
  tipo: Cita["tipo"];
  estado: Cita["estado"];
  etapa: string;
  motivo: string;
  programada_at: string;
  mensaje_saliente_id: number | null;
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
    hora: row.hora_cita,
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

function toExtraccion(row: ExtraccionRow): Extraccion {
  return {
    id: row.id,
    estadoDeCuentaId: row.estado_de_cuenta_id,
    mailId: row.mail_id,
    cifras: JSON.parse(row.cifras),
    extractedAt: new Date(row.extracted_at),
  };
}

function toSenal(row: SenalRow): Senal {
  return {
    id: row.id,
    tipo: row.tipo,
    origen: { mailId: row.mail_id, from: row.mail_from, subject: row.subject },
    monto: row.monto,
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

function toPendiente(row: PendienteRow): Pendiente {
  return {
    id: row.id,
    tipo: row.tipo,
    motivo: row.motivo,
    datos: JSON.parse(row.datos),
    createdAt: new Date(row.created_at),
    diferidoAt: row.diferido_at === null ? null : new Date(row.diferido_at),
    citaId: row.cita_id,
  };
}

/** Builds the store over a migrated database. */
export function createStore(db: Database, clock: Clock): Store {
  const now = () => clock.now().toISOString();

  const selectPatricia = db.query<PatriciaRow, []>(
    "SELECT nombre, voz, hora_cita, gmail_permitido, etapa, bolsillo, en_pausa FROM patricia WHERE id = 1",
  );
  const updatePatriciaRow = db.query(
    `UPDATE patricia SET nombre = $nombre, voz = $voz, hora_cita = $hora, gmail_permitido = $gmailPermitido,
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
  const insertExtraccion = db.query<ExtraccionRow, Record<string, string | number>>(
    `INSERT INTO extracciones (estado_de_cuenta_id, mail_id, cifras, extracted_at)
     VALUES ($estadoDeCuentaId, $mailId, $cifras, $extractedAt) RETURNING *`,
  );
  const selectExtraccionForMail = db.query<ExtraccionRow, [string]>("SELECT * FROM extracciones WHERE mail_id = ?");
  const insertSenal = db.query<SenalRow, Record<string, string | number | null>>(
    `INSERT INTO senales (tipo, mail_id, mail_from, subject, monto, received_at)
     VALUES ($tipo, $mailId, $from, $subject, $monto, $receivedAt) RETURNING *`,
  );
  const selectSenales = db.query<SenalRow, []>("SELECT * FROM senales ORDER BY id");
  const selectSenalForMail = db.query<SenalRow, [string]>("SELECT * FROM senales WHERE mail_id = ?");
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
  const claimMensajeProcesado = db.query<null, Record<string, string>>(
    "INSERT OR IGNORE INTO mensajes_procesados (whatsapp_id, claimed_at) VALUES ($whatsappId, $claimedAt)",
  );
  const releaseMensajeProcesado = db.query<null, Record<string, string>>(
    "DELETE FROM mensajes_procesados WHERE whatsapp_id = $whatsappId",
  );
  const insertDecision = db.query<DecisionRow, Record<string, string>>(
    "INSERT INTO decisions (at, tipo, motivo, datos) VALUES ($at, $tipo, $motivo, $datos) RETURNING *",
  );
  const selectDecisions = db.query<DecisionRow, []>("SELECT * FROM decisions ORDER BY id");
  const insertPendiente = db.query<PendienteRow, Record<string, string>>(
    "INSERT INTO pendientes (tipo, motivo, datos, created_at) VALUES ($tipo, $motivo, $datos, $createdAt) RETURNING *",
  );
  const selectPendientesEnEspera = db.query<PendienteRow, []>(
    "SELECT * FROM pendientes WHERE cita_id IS NULL ORDER BY id",
  );
  const selectPendientesDeCita = db.query<PendienteRow, Record<string, number>>(
    "SELECT * FROM pendientes WHERE cita_id = $citaId ORDER BY id",
  );
  const deferPendiente = db.query(
    "UPDATE pendientes SET diferido_at = $at WHERE id = $id AND diferido_at IS NULL AND cita_id IS NULL",
  );
  const assignPendiente = db.query("UPDATE pendientes SET cita_id = $citaId WHERE id = $id AND cita_id IS NULL");
  const insertCita = db.query<CitaRow, Record<string, string>>(
    `INSERT INTO citas (fecha, tipo, estado, etapa, motivo, programada_at)
     VALUES ($fecha, $tipo, $estado, $etapa, $motivo, $programadaAt)
     ON CONFLICT (fecha) DO NOTHING RETURNING *`,
  );
  const selectCitaDelDia = db.query<CitaRow, Record<string, string>>("SELECT * FROM citas WHERE fecha = $fecha");
  const selectCitas = db.query<CitaRow, []>("SELECT * FROM citas ORDER BY id");
  const updateCitaSent = db.query(
    "UPDATE citas SET mensaje_saliente_id = $mensajeSalienteId WHERE id = $id AND mensaje_saliente_id IS NULL",
  );

  const toCita = (row: CitaRow): Cita => ({
    id: row.id,
    fecha: row.fecha,
    tipo: row.tipo,
    estado: row.estado,
    etapa: etapaFromText(row.etapa),
    motivo: row.motivo,
    pendientes: selectPendientesDeCita.all({ citaId: row.id }).map(toPendiente),
    programadaAt: new Date(row.programada_at),
    mensajeSalienteId: row.mensaje_saliente_id,
  });

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
        hora: next.hora ?? null,
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
        from: etapaFromText(row.from_etapa),
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
        monto: input.monto ?? null,
        receivedAt: now(),
      });
      return toSenal(row!);
    },

    senales() {
      return selectSenales.all().map(toSenal);
    },

    plataApartada() {
      return plataApartada(selectSenales.all().map(toSenal), clock.now());
    },

    comprasEnCuotas() {
      return comprasEnCuotas(selectSenales.all().map(toSenal), clock.now());
    },

    senalForMail(mailId) {
      const row = selectSenalForMail.get(mailId);
      return row ? toSenal(row) : null;
    },

    addExtraccion(input) {
      const row = insertExtraccion.get({
        estadoDeCuentaId: input.estadoDeCuentaId,
        mailId: input.mailId,
        cifras: JSON.stringify(input.cifras),
        extractedAt: now(),
      });
      return toExtraccion(row!);
    },

    extraccionForMail(mailId) {
      const row = selectExtraccionForMail.get(mailId);
      return row ? toExtraccion(row) : null;
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

    claimWhatsappId(whatsappId) {
      return claimMensajeProcesado.run({ whatsappId, claimedAt: now() }).changes === 1;
    },

    releaseWhatsappId(whatsappId) {
      releaseMensajeProcesado.run({ whatsappId });
    },

    recordDecision({ tipo, motivo, datos }) {
      const row = insertDecision.get({ at: now(), tipo, motivo, datos: JSON.stringify(datos ?? null) });
      return toDecision(row!);
    },

    decisions() {
      return selectDecisions.all().map(toDecision);
    },

    addPendiente({ tipo, motivo, datos }) {
      const row = insertPendiente.get({ tipo, motivo, datos: JSON.stringify(datos ?? null), createdAt: now() });
      return toPendiente(row!);
    },

    pendientes() {
      return selectPendientesEnEspera.all().map(toPendiente);
    },

    deferPendientes(ids) {
      const at = now();
      db.transaction(() => {
        for (const id of ids) deferPendiente.run({ at, id });
      })();
    },

    addCita({ pendienteIds, ...input }) {
      return db.transaction(() => {
        const row = insertCita.get({
          fecha: input.fecha,
          tipo: input.tipo,
          estado: input.estado,
          etapa: etapaToText(input.etapa),
          motivo: input.motivo,
          programadaAt: now(),
        });
        if (!row) return null;
        for (const id of pendienteIds) assignPendiente.run({ citaId: row.id, id });
        return toCita(row);
      })();
    },

    citaOn(fecha) {
      const row = selectCitaDelDia.get({ fecha });
      return row ? toCita(row) : null;
    },

    citas() {
      return selectCitas.all().map(toCita);
    },

    markCitaSent(citaId, mensajeSalienteId) {
      return updateCitaSent.run({ id: citaId, mensajeSalienteId }).changes === 1;
    },
  };
}
