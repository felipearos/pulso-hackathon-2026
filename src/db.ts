import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One versioned schema step. Versions only ever grow; a shipped step is never edited. */
export type Migration = { version: number; name: string; sql: string };

/**
 * Patricia's schema, in order. Tickets that add tables append a step here.
 * Deploys rerun the list against the live file, so every step must be safe to
 * skip once applied.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: "patricia",
    sql: `
      CREATE TABLE patricia (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        nombre TEXT NOT NULL,
        voz TEXT,
        gmail_permitido INTEGER NOT NULL DEFAULT 0,
        etapa TEXT NOT NULL CHECK (etapa IN ('1', '2', '3', '4', '5', 'graduada')),
        bolsillo TEXT,
        en_pausa INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO patricia (id, nombre, etapa) VALUES (1, 'Patricia', '1');
      CREATE TABLE etapa_cambios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        from_etapa TEXT NOT NULL,
        to_etapa TEXT NOT NULL,
        motivo TEXT NOT NULL
      );
      CREATE TABLE estados_de_cuenta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origen TEXT NOT NULL CHECK (origen IN ('banco', 'tienda')),
        ciclo INTEGER NOT NULL,
        fecha_cierre TEXT,
        fecha_vencimiento TEXT,
        cifras TEXT,
        pago_minimo INTEGER,
        received_at TEXT NOT NULL
      );
      CREATE TABLE senales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        mail_id TEXT NOT NULL,
        mail_from TEXT NOT NULL,
        subject TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE TABLE mensajes_salientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('text', 'audio', 'image')),
        text TEXT,
        duration_seconds REAL,
        whatsapp_id TEXT,
        sent_at TEXT NOT NULL
      );
      CREATE TABLE mensajes_entrantes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        intencion TEXT,
        whatsapp_id TEXT,
        received_at TEXT NOT NULL
      );
      CREATE TABLE decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        tipo TEXT NOT NULL,
        motivo TEXT NOT NULL,
        datos TEXT NOT NULL
      );
      CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions
        BEGIN SELECT RAISE(ABORT, 'the decision log is append-only'); END;
      CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions
        BEGIN SELECT RAISE(ABORT, 'the decision log is append-only'); END;
    `,
  },
  {
    version: 2,
    name: "reloj_demo",
    sql: `
      CREATE TABLE reloj_demo (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        offset_ms INTEGER
      );
      INSERT INTO reloj_demo (id, offset_ms) VALUES (1, NULL);
    `,
  },
  {
    version: 3,
    name: "senales-por-correo",
    // One señal per mail: the poll may see the same Gmail message twice. A base
    // from v1 may already hold duplicates; the first señal of each mail stays.
    sql: `
      DELETE FROM senales WHERE id NOT IN (SELECT MIN(id) FROM senales GROUP BY mail_id);
      CREATE UNIQUE INDEX senales_mail_id ON senales (mail_id);
    `,
  },
  {
    version: 4,
    name: "citas",
    sql: `
      -- At most one cita per Santiago day: two ticks in the same minute meet this key.
      CREATE TABLE citas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL UNIQUE,
        tipo TEXT NOT NULL CHECK (tipo IN ('lunes', 'jueves', 'domingo', 'bienvenida', 'bienvenida-de-vuelta', 'graduada')),
        estado TEXT NOT NULL CHECK (estado IN ('programada', 'callada')),
        etapa TEXT NOT NULL CHECK (etapa IN ('1', '2', '3', '4', '5', 'graduada')),
        motivo TEXT NOT NULL,
        programada_at TEXT NOT NULL
      );
      CREATE TABLE pendientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK (tipo IN ('bienvenida', 'bienvenida-de-vuelta', 'preocupacion', 'senal')),
        motivo TEXT NOT NULL,
        datos TEXT NOT NULL,
        created_at TEXT NOT NULL,
        diferido_at TEXT,
        cita_id INTEGER REFERENCES citas (id)
      );
    `,
  },
  {
    version: 5,
    name: "monto-del-pedido",
    // The paid amount of an S3, read from its mail; the plata apartada is its 10 %.
    sql: "ALTER TABLE senales ADD COLUMN monto INTEGER;",
  },
];

/** Opens the SQLite file, creating its directory, or an in-memory database for `:memory:`. */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

/**
 * Applies the steps the database has not seen yet, each in its own transaction,
 * and records them in `schema_migrations`. Running it again is a no-op.
 */
export function migrate(db: Database, steps: readonly Migration[] = migrations): number[] {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  const done = new Set(
    db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all().map((row) => row.version),
  );
  const applied: number[] = [];
  for (const step of [...steps].sort((a, b) => a.version - b.version)) {
    if (done.has(step.version)) continue;
    db.transaction(() => {
      db.run(step.sql);
      db.run("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [step.version, step.name]);
    })();
    applied.push(step.version);
  }
  return applied;
}
