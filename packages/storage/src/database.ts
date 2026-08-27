import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const MIGRATION_VERSION = 1;
const MIGRATION_SQL = readFileSync(
  new URL("../migrations/001_initial.sql", import.meta.url),
  "utf8"
);

export interface AgentLensDatabase {
  readonly connection: Database.Database;
  close(): void;
}

function applyMigrations(connection: Database.Database): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = connection
    .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
    .get(MIGRATION_VERSION);
  if (applied) return;

  connection.transaction(() => {
    connection.exec(MIGRATION_SQL);
    connection
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(MIGRATION_VERSION, Date.now());
  })();
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

  return {
    connection,
    close: () => connection.close()
  };
}
