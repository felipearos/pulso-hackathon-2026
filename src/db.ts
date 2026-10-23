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
export const migrations: Migration[] = [];

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
