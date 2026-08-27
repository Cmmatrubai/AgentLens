import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { registerConnection, releaseConnection } from "./databaseInternal.js";

const MIGRATIONS = [
  {
    version: 1,
    sql: readFileSync(new URL("../migrations/001_initial.sql", import.meta.url), "utf8")
  },
  {
    version: 2,
    sql: readFileSync(new URL("../migrations/002_storage_invariants.sql", import.meta.url), "utf8")
  }
] as const;

export interface AgentLensDatabase {
  inspect(): DatabaseInspection;
  close(): void;
}

export interface DatabaseInspection {
  readonly tables: readonly string[];
  readonly indexes: readonly string[];
  readonly migrations: readonly number[];
  readonly foreignKeys: boolean;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly busyTimeout: number;
  readonly integrity: string;
}

function inspectConnection(connection: Database.Database): DatabaseInspection {
  return Object.freeze({
    tables: Object.freeze(connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all() as string[]),
    indexes: Object.freeze(connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .pluck()
      .all() as string[]),
    migrations: Object.freeze(connection
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .pluck()
      .all() as number[]),
    foreignKeys: connection.pragma("foreign_keys", { simple: true }) === 1,
    journalMode: String(connection.pragma("journal_mode", { simple: true })),
    synchronous: Number(connection.pragma("synchronous", { simple: true })),
    busyTimeout: Number(connection.pragma("busy_timeout", { simple: true })),
    integrity: String(connection.prepare("PRAGMA integrity_check").pluck().get())
  });
}

function applyMigrations(connection: Database.Database): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const isApplied = connection.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const recordMigration = connection.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
  );
  for (const migration of MIGRATIONS) {
    if (isApplied.get(migration.version)) continue;
    connection.transaction(() => {
      connection.exec(migration.sql);
      recordMigration.run(migration.version, Date.now());
    })();
  }
}

export function openDatabase(path: string): AgentLensDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const connection = new Database(path);
  try {
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    connection.pragma("synchronous = NORMAL");
    connection.pragma("busy_timeout = 5000");
    applyMigrations(connection);
  } catch (error) {
    connection.close();
    throw error;
  }

  let closed = false;
  const database: AgentLensDatabase = Object.freeze({
    inspect: () => {
      if (closed) throw new Error("AgentLens database is closed.");
      return inspectConnection(connection);
    },
    close: () => {
      if (closed) return;
      closed = true;
      releaseConnection(database)?.close();
    }
  });
  registerConnection(database, connection);
  return database;
}
