import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase, openDatabaseReadOnly } from "../src/database.js";
import { RunRepository } from "../src/runRepository.js";

const temporaryRoots: string[] = [];

function temporaryDatabasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-readonly-"));
  temporaryRoots.push(root);
  return join(root, "agentlens.sqlite");
}

function migrationSql(version: number): string {
  const names = [
    "initial",
    "storage_invariants",
    "recorder_ownership",
    "task6_evaluation"
  ];
  return readFileSync(
    new URL(`../migrations/00${version}_${names[version - 1]}.sql`, import.meta.url),
    "utf8"
  );
}

function createDatabaseThrough(path: string, version: number): Database.Database {
  const connection = new Database(path);
  connection.pragma("foreign_keys = ON");
  for (let migration = 1; migration <= version; migration += 1) {
    connection.exec(migrationSql(migration));
    connection.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(migration, 1_777_777_777_000 + migration);
  }
  return connection;
}

type PathSnapshot =
  | Readonly<{ exists: false }>
  | Readonly<{
      exists: true;
      type: "file" | "directory" | "symlink" | "other";
      mode: bigint;
      size: bigint;
      mtimeNs: bigint;
      device: bigint;
      inode: bigint;
      sha256?: string;
      linkTarget?: string;
    }>;

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function snapshotPath(path: string): PathSnapshot {
  if (!lstatExists(path)) return Object.freeze({ exists: false });
  const stat = lstatSync(path, { bigint: true });
  const type = stat.isFile()
    ? "file"
    : stat.isDirectory()
      ? "directory"
      : stat.isSymbolicLink()
        ? "symlink"
        : "other";
  return Object.freeze({
    exists: true,
    type,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    device: stat.dev,
    inode: stat.ino,
    ...(type === "file"
      ? { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }
      : {}),
    ...(type === "symlink" ? { linkTarget: readlinkSync(path) } : {})
  });
}

function snapshotStorage(path: string): Readonly<{
  root: PathSnapshot;
  entries: readonly Readonly<{ name: string; snapshot: PathSnapshot }>[];
}> {
  const root = dirname(path);
  return Object.freeze({
    root: snapshotPath(root),
    entries: Object.freeze(readdirSync(root).sort().map((name) => Object.freeze({
      name,
      snapshot: snapshotPath(join(root, name))
    })))
  });
}

function validRun(id = "readonly-current-run") {
  return {
    id,
    schemaVersion: 1,
    provider: "codex-exec" as const,
    integrationVersion: "0.1.0",
    agentVersion: "fixture-agent",
    capturePolicy: "standard" as const,
    capturePolicyVersion: "1",
    redactionVersion: "1",
    repositoryFingerprint: `fixture-fingerprint-${id}`,
    repositoryDisplay: "fixture-repository",
    startedAt: 1_777_777_777_000
  };
}

function validOwnership() {
  return {
    recorderInstanceId: "readonly-recorder",
    recorderPid: 101,
    recorderStartToken: "readonly-start-token",
    heartbeatAt: 1_777_777_777_000
  };
}

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw.");
}

interface FreshProcessResult {
  readonly before: Readonly<{ present: boolean; value: string | null }>;
  readonly afterWritable: Readonly<{ present: boolean; value: string | null }>;
  readonly afterReadOnly: Readonly<{ present: boolean; value: string | null }>;
  readonly migrations: readonly number[];
  readonly walPresent: boolean;
}

function runFreshAgentLensProcess(
  path: string,
  initialValue: string | undefined
): FreshProcessResult {
  const environment = { ...process.env, AGENTLENS_FRESH_DATABASE_PATH: path };
  if (initialValue === undefined) delete environment.SQLITE_USE_URI;
  else environment.SQLITE_USE_URI = initialValue;
  const databaseModule = new URL("../src/database.ts", import.meta.url).href;
  const script = `
    import { existsSync } from "node:fs";
    import { openDatabase, openDatabaseReadOnly } from ${JSON.stringify(databaseModule)};
    const path = process.env.AGENTLENS_FRESH_DATABASE_PATH;
    const environmentValue = () => ({
      present: Object.prototype.hasOwnProperty.call(process.env, "SQLITE_USE_URI"),
      value: process.env.SQLITE_USE_URI ?? null
    });
    const before = environmentValue();
    const writable = openDatabase(path);
    writable.close();
    const afterWritable = environmentValue();
    const readOnly = openDatabaseReadOnly(path);
    const migrations = readOnly.inspect().migrations;
    readOnly.close();
    const afterReadOnly = environmentValue();
    process.stdout.write(JSON.stringify({
      before,
      afterWritable,
      afterReadOnly,
      migrations,
      walPresent: existsSync(path + "-wal")
    }));
  `;
  const child = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--conditions=development",
    "--input-type=module",
    "--eval",
    script
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environment
  });
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as FreshProcessResult;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("openDatabaseReadOnly", () => {
  it.each([
    { name: "an initially absent value", initialValue: undefined },
    { name: "a preexisting value", initialValue: "preserve-exactly" }
  ])("enables immutable URI support at the first AgentLens constructor and restores $name", ({
    initialValue
  }) => {
    const path = temporaryDatabasePath();

    const result = runFreshAgentLensProcess(path, initialValue);

    const expectedEnvironment = {
      present: initialValue !== undefined,
      value: initialValue ?? null
    };
    expect(result).toEqual({
      before: expectedEnvironment,
      afterWritable: expectedEnvironment,
      afterReadOnly: expectedEnvironment,
      migrations: [1, 2, 3, 4],
      walPresent: false
    });
  });

  it("fails clearly and restores the environment when a foreign constructor initialized URI support off", () => {
    const path = temporaryDatabasePath();
    const environment = {
      ...process.env,
      AGENTLENS_FRESH_DATABASE_PATH: path,
      SQLITE_USE_URI: "0"
    };
    const databaseModule = new URL("../src/database.ts", import.meta.url).href;
    const betterSqliteModule = pathToFileURL(
      createRequire(import.meta.url).resolve("better-sqlite3")
    ).href;
    const script = `
      import Database from ${JSON.stringify(betterSqliteModule)};
      import { openDatabaseReadOnly } from ${JSON.stringify(databaseModule)};
      const path = process.env.AGENTLENS_FRESH_DATABASE_PATH;
      const foreign = new Database(path);
      foreign.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY)");
      foreign.close();
      process.env.SQLITE_USE_URI = "restore-after-failure";
      let error;
      try {
        openDatabaseReadOnly(path);
      } catch (caught) {
        error = caught;
      }
      process.stdout.write(JSON.stringify({
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? null,
        environment: process.env.SQLITE_USE_URI ?? null
      }));
    `;
    const child = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "--conditions=development",
      "--input-type=module",
      "--eval",
      script
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment
    });
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout) as {
      errorName: string | null;
      errorMessage: string | null;
      environment: string | null;
    };
    expect(result).toMatchObject({
      errorName: "ReadOnlyDatabaseError",
      environment: "restore-after-failure"
    });
    expect(result.errorMessage).toMatch(/immutable/i);
  });

  it("immutably reads the checkpointed current main database and rejects writes", () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    const writableRepository = new RunRepository(writable, {
      artifactRoot: join(dirname(path), "artifacts", "sha256")
    });
    writableRepository.createRun(validRun(), validOwnership());
    writable.close();
    expect(existsSync(`${path}-wal`)).toBe(false);
    const before = snapshotStorage(path);

    const database = openDatabaseReadOnly(path);
    try {
      expect(database.inspect()).toMatchObject({
        migrations: [1, 2, 3, 4],
        foreignKeys: true,
        queryOnly: true,
        quickCheck: ["ok"],
        foreignKeyCheck: []
      });
      const repository = new RunRepository(database, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      });
      expect(repository.listRuns().map(({ id }) => id)).toEqual(["readonly-current-run"]);
      expect(() => repository.createRun(validRun("readonly-write-attempt"), validOwnership()))
        .toThrow(/readonly/i);
    } finally {
      database.close();
    }

    expect(snapshotStorage(path)).toEqual(before);
  });

  it("immutably inspects a checkpointed migration-003 main database without migrating", () => {
    const path = temporaryDatabasePath();
    createDatabaseThrough(path, 3).close();
    expect(existsSync(`${path}-wal`)).toBe(false);
    const before = snapshotStorage(path);

    const database = openDatabaseReadOnly(path);
    try {
      const inspection = database.inspect();
      expect(inspection.migrations).toEqual([1, 2, 3]);
      expect(inspection.tables).not.toContain("derivation_identities");
    } finally {
      database.close();
    }

    expect(snapshotStorage(path)).toEqual(before);
  });

  it("reports an empty migration list when schema_migrations is absent", () => {
    const path = temporaryDatabasePath();
    const connection = new Database(path);
    connection.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY)");
    connection.close();
    const before = snapshotStorage(path);

    const database = openDatabaseReadOnly(path);
    try {
      expect(database.inspect()).toMatchObject({
        tables: ["fixture"],
        migrations: [],
        quickCheck: ["ok"],
        foreignKeyCheck: []
      });
    } finally {
      database.close();
    }

    expect(snapshotStorage(path)).toEqual(before);
  });

  it("bounds corrupt SQLite inspection without changing the root or sidecars", () => {
    const path = temporaryDatabasePath();
    writeFileSync(path, "not a sqlite database\n", { mode: 0o600 });
    const before = snapshotStorage(path);

    const error = thrownBy(() => {
      const database = openDatabaseReadOnly(path);
      try {
        database.inspect();
      } finally {
        database.close();
      }
    });
    expect(error).toBeInstanceOf(Error);
    expect(snapshotStorage(path)).toEqual(before);
  });

  it("rejects missing and non-regular main database paths without mutation", () => {
    const missingPath = temporaryDatabasePath();
    const missingBefore = snapshotStorage(missingPath);
    expect(() => openDatabaseReadOnly(missingPath)).toThrow(/existing|regular|database/i);
    expect(snapshotStorage(missingPath)).toEqual(missingBefore);

    const directoryPath = temporaryDatabasePath();
    mkdirSync(directoryPath);
    const directoryBefore = snapshotStorage(directoryPath);
    expect(() => openDatabaseReadOnly(directoryPath)).toThrow(/regular|database/i);
    expect(snapshotStorage(directoryPath)).toEqual(directoryBefore);

    const symlinkPath = temporaryDatabasePath();
    const target = join(dirname(symlinkPath), "target.sqlite");
    createDatabaseThrough(target, 4).close();
    symlinkSync(target, symlinkPath);
    const symlinkBefore = snapshotStorage(symlinkPath);
    expect(() => openDatabaseReadOnly(symlinkPath)).toThrow(/regular|database/i);
    expect(snapshotStorage(symlinkPath)).toEqual(symlinkBefore);
  });

  it.each([
    "empty file",
    "stale bytes",
    "directory",
    "symlink"
  ] as const)("refuses a present WAL that is an %s with stable wal_present", (kind) => {
    const path = temporaryDatabasePath();
    createDatabaseThrough(path, 4).close();
    const walPath = `${path}-wal`;
    if (kind === "empty file") writeFileSync(walPath, Buffer.alloc(0));
    if (kind === "stale bytes") writeFileSync(walPath, "stale WAL bytes");
    if (kind === "directory") mkdirSync(walPath);
    if (kind === "symlink") {
      const target = join(dirname(path), "wal-target");
      writeFileSync(target, "target bytes");
      symlinkSync(target, walPath);
    }
    const before = snapshotStorage(path);

    const error = thrownBy(() => openDatabaseReadOnly(path));

    expect(error).toMatchObject({ reason: "wal_present" });
    expect(snapshotStorage(path)).toEqual(before);
  });

  it("returns wal_present before asking SQLite to inspect corrupt main bytes", () => {
    const path = temporaryDatabasePath();
    writeFileSync(path, "corrupt main database");
    writeFileSync(`${path}-wal`, Buffer.alloc(0));
    const before = snapshotStorage(path);

    const error = thrownBy(() => openDatabaseReadOnly(path));

    expect(error).toMatchObject({ reason: "wal_present" });
    expect(snapshotStorage(path)).toEqual(before);
  });
});
