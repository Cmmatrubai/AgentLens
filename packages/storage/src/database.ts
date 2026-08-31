import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { connectionFor, registerConnection, releaseConnection } from "./databaseInternal.js";

const MIGRATIONS = [
  {
    version: 1,
    sql: readFileSync(new URL("../migrations/001_initial.sql", import.meta.url), "utf8")
  },
  {
    version: 2,
    sql: readFileSync(new URL("../migrations/002_storage_invariants.sql", import.meta.url), "utf8")
  },
  {
    version: 3,
    sql: readFileSync(new URL("../migrations/003_recorder_ownership.sql", import.meta.url), "utf8")
  },
  {
    version: 4,
    sql: readFileSync(new URL("../migrations/004_task6_evaluation.sql", import.meta.url), "utf8")
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
  readonly queryOnly: boolean;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly busyTimeout: number;
  readonly integrity: string;
  readonly quickCheck: readonly string[];
  readonly foreignKeyCheck: readonly DatabaseForeignKeyViolation[];
}

export interface DatabaseForeignKeyViolation {
  readonly table: string;
  readonly rowid: number | null;
  readonly parent: string;
  readonly fkid: number;
}

export type ReadOnlyDatabaseErrorReason = "wal_present" | "immutable_unavailable";

export type ServerReadMode = "immutable" | "active_wal";

export interface ServerReadDatabase {
  readonly database: AgentLensDatabase;
  readonly mode: ServerReadMode;
}

export type ServerReadDatabaseErrorReason =
  | "active_sidecar_missing"
  | "active_sidecar_invalid"
  | "active_sidecar_changed"
  | "active_wal_unavailable";

export class ReadOnlyDatabaseError extends Error {
  readonly reason: ReadOnlyDatabaseErrorReason;

  constructor(reason: ReadOnlyDatabaseErrorReason, cause?: unknown) {
    super(`AgentLens immutable read-only database open failed: ${reason}.`,
      cause === undefined ? undefined : { cause });
    this.name = "ReadOnlyDatabaseError";
    this.reason = reason;
  }
}

export class ServerReadDatabaseError extends Error {
  readonly reason: ServerReadDatabaseErrorReason;

  constructor(reason: ServerReadDatabaseErrorReason, cause?: unknown) {
    super(`AgentLens server read database open failed: ${reason}.`,
      cause === undefined ? undefined : { cause });
    this.name = "ServerReadDatabaseError";
    this.reason = reason;
  }
}

interface ActiveFileIdentity {
  readonly path: string;
  readonly uid: bigint;
  readonly gid: bigint;
  readonly mode: bigint;
  readonly device: bigint;
  readonly inode: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function missingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function activeWalPresent(path: string): boolean {
  try {
    lstatSync(`${path}-wal`);
    return true;
  } catch (error) {
    if (missingPathError(error)) return false;
    throw new ServerReadDatabaseError("active_sidecar_invalid", error);
  }
}

function readActiveFileIdentity(path: string): ActiveFileIdentity {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    if (missingPathError(error)) {
      throw new ServerReadDatabaseError("active_sidecar_missing", error);
    }
    throw new ServerReadDatabaseError("active_sidecar_invalid", error);
  }

  const effectiveUserIdValue = process.geteuid?.() ?? process.getuid?.();
  if (effectiveUserIdValue === undefined) {
    throw new ServerReadDatabaseError("active_sidecar_invalid");
  }
  const effectiveUserId = BigInt(effectiveUserIdValue);
  if (!stat.isFile() || stat.uid !== effectiveUserId || (stat.mode & 0o077n) !== 0n) {
    throw new ServerReadDatabaseError("active_sidecar_invalid");
  }

  return Object.freeze({
    path,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs
  });
}

function activeIdentityChanged(
  before: ActiveFileIdentity,
  after: ActiveFileIdentity,
  allowShmCoordination: boolean
): boolean {
  return before.path !== after.path ||
    before.uid !== after.uid ||
    before.gid !== after.gid ||
    before.mode !== after.mode ||
    before.device !== after.device ||
    before.inode !== after.inode ||
    before.size !== after.size ||
    (!allowShmCoordination && (
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
    ));
}

type ActiveFileIdentities = readonly [
  ActiveFileIdentity,
  ActiveFileIdentity,
  ActiveFileIdentity
];

function readActiveIdentities(path: string): ActiveFileIdentities {
  return Object.freeze([
    readActiveFileIdentity(path),
    readActiveFileIdentity(`${path}-wal`),
    readActiveFileIdentity(`${path}-shm`)
  ]);
}

function validateActiveIdentitiesAfterOpen(
  before: ActiveFileIdentities
): void {
  let after: ActiveFileIdentities;
  try {
    after = readActiveIdentities(before[0].path);
  } catch (error) {
    if (error instanceof ServerReadDatabaseError &&
      error.reason === "active_sidecar_missing") throw error;
    throw new ServerReadDatabaseError("active_sidecar_changed", error);
  }
  if (activeIdentityChanged(before[0], after[0], false) ||
    activeIdentityChanged(before[1], after[1], false) ||
    activeIdentityChanged(before[2], after[2], true)) {
    throw new ServerReadDatabaseError("active_sidecar_changed");
  }
}

function constructDatabase(
  filename: string,
  options?: Database.Options
): Database.Database {
  const hadPriorValue = Object.prototype.hasOwnProperty.call(process.env, "SQLITE_USE_URI");
  const priorValue = process.env.SQLITE_USE_URI;
  process.env.SQLITE_USE_URI = "1";
  try {
    return new Database(filename, options);
  } finally {
    if (hadPriorValue) process.env.SQLITE_USE_URI = priorValue;
    else delete process.env.SQLITE_USE_URI;
  }
}

function inspectConnection(connection: Database.Database): DatabaseInspection {
  const tables = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .pluck()
    .all() as string[];
  const migrations = tables.includes("schema_migrations")
    ? connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .pluck()
        .all() as number[]
    : [];
  const foreignKeyCheck = (connection.prepare("PRAGMA foreign_key_check").all() as
    DatabaseForeignKeyViolation[]).map((violation) => Object.freeze({ ...violation }));
  return Object.freeze({
    tables: Object.freeze(tables),
    indexes: Object.freeze(connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .pluck()
      .all() as string[]),
    migrations: Object.freeze(migrations),
    foreignKeys: connection.pragma("foreign_keys", { simple: true }) === 1,
    queryOnly: connection.pragma("query_only", { simple: true }) === 1,
    journalMode: String(connection.pragma("journal_mode", { simple: true })),
    synchronous: Number(connection.pragma("synchronous", { simple: true })),
    busyTimeout: Number(connection.pragma("busy_timeout", { simple: true })),
    integrity: String(connection.prepare("PRAGMA integrity_check").pluck().get()),
    quickCheck: Object.freeze(
      connection.prepare("PRAGMA quick_check").pluck().all() as string[]
    ),
    foreignKeyCheck: Object.freeze(foreignKeyCheck)
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
  const connection = constructDatabase(path);
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

export function openDatabaseReadOnly(path: string): AgentLensDatabase {
  let databaseStat;
  try {
    databaseStat = lstatSync(path);
  } catch (error) {
    throw new Error("Read-only AgentLens database must be an existing regular file.", {
      cause: error
    });
  }
  if (!databaseStat.isFile()) {
    throw new Error("Read-only AgentLens database must be an existing regular file.");
  }

  let walPresent = false;
  try {
    lstatSync(`${path}-wal`);
    walPresent = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw new Error("AgentLens could not determine whether a WAL path is present.", {
        cause: error
      });
    }
  }
  if (walPresent) throw new ReadOnlyDatabaseError("wal_present");

  const immutableUrl = pathToFileURL(path);
  immutableUrl.searchParams.set("immutable", "1");
  let connection: Database.Database;
  try {
    connection = constructDatabase(immutableUrl.href, {
      readonly: true,
      fileMustExist: true
    });
  } catch (error) {
    throw new ReadOnlyDatabaseError("immutable_unavailable", error);
  }
  try {
    connection.pragma("foreign_keys = ON");
    connection.pragma("query_only = ON");
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

export function openDatabaseForServerRead(path: string): ServerReadDatabase {
  if (!activeWalPresent(path)) {
    return Object.freeze({
      database: openDatabaseReadOnly(path),
      mode: "immutable" as const
    });
  }

  const before = readActiveIdentities(path);
  let connection: Database.Database;
  try {
    connection = constructDatabase(path, {
      readonly: true,
      fileMustExist: true
    });
  } catch (error) {
    try {
      validateActiveIdentitiesAfterOpen(before);
    } catch (validationError) {
      throw validationError;
    }
    throw new ServerReadDatabaseError("active_wal_unavailable", error);
  }
  try {
    connection.pragma("foreign_keys = ON");
    connection.pragma("query_only = ON");
    connection.pragma("busy_timeout = 5000");
    connection.pragma("schema_version", { simple: true });
  } catch (error) {
    connection.close();
    try {
      validateActiveIdentitiesAfterOpen(before);
    } catch (validationError) {
      throw validationError;
    }
    throw new ServerReadDatabaseError("active_wal_unavailable", error);
  }

  try {
    validateActiveIdentitiesAfterOpen(before);
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
  return Object.freeze({ database, mode: "active_wal" });
}

export async function withServerReadSnapshot<T>(
  database: AgentLensDatabase,
  operation: () => Promise<T> | T
): Promise<T> {
  const connection = connectionFor(database);
  connection.exec("BEGIN");
  let operationError: unknown;
  let result: T | undefined;
  try {
    // BEGIN is deferred. This read pins the snapshot before application code
    // can yield or a later repository statement observes a different commit.
    connection.prepare("SELECT rootpage FROM sqlite_schema ORDER BY name LIMIT 1").get();
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  try {
    if (connection.inTransaction) connection.exec("ROLLBACK");
  } catch (rollbackError) {
    if (operationError === undefined) throw rollbackError;
  }
  if (operationError !== undefined) throw operationError;
  return result as T;
}
