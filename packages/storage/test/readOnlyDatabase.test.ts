import { createHash } from "node:crypto";
import {
  chmodSync,
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
import {
  openDatabase,
  openDatabaseForServerRead,
  openDatabaseReadOnly,
  withServerReadSnapshot
} from "../src/index.js";
import { connectionFor } from "../src/databaseInternal.js";
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
  Readonly<{
    path: string;
    type: "file" | "directory" | "symlink" | "other";
    linkTarget?: string;
    uid: bigint;
    gid: bigint;
    mode: bigint;
    device: bigint;
    inode: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    sha256?: string;
  }>;

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function snapshotPath(root: string, path: string): PathSnapshot {
  const stat = lstatSync(path, { bigint: true });
  const type = stat.isFile()
    ? "file"
    : stat.isDirectory()
      ? "directory"
      : stat.isSymbolicLink()
        ? "symlink"
        : "other";
  return Object.freeze({
    path: path === root ? "." : path.slice(root.length + 1),
    type,
    ...(type === "symlink" ? { linkTarget: readlinkSync(path) } : {}),
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    ...(type === "file"
      ? { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }
      : {})
  });
}

function snapshotStorage(path: string): readonly PathSnapshot[] {
  const root = dirname(path);
  const entries: PathSnapshot[] = [];
  const visit = (entryPath: string): void => {
    const snapshot = snapshotPath(root, entryPath);
    entries.push(snapshot);
    if (snapshot.type !== "directory") return;
    for (const name of readdirSync(entryPath).sort()) visit(join(entryPath, name));
  };
  visit(root);
  return Object.freeze(entries);
}

function withAllowedShmCoordination(
  snapshot: readonly PathSnapshot[]
): readonly Readonly<Omit<PathSnapshot, "sha256" | "mtimeNs" | "ctimeNs"> & {
  sha256?: string;
  mtimeNs?: bigint;
  ctimeNs?: bigint;
}>[] {
  return Object.freeze(snapshot.map((entry) => {
    if (entry.path !== "agentlens.sqlite-shm") return entry;
    const {
      sha256: _allowedShmBytes,
      mtimeNs: _allowedShmMtime,
      ctimeNs: _allowedShmCtime,
      ...metadata
    } = entry;
    return Object.freeze(metadata);
  }));
}

function snapshotEntry(snapshot: readonly PathSnapshot[], path: string): PathSnapshot {
  const entry = snapshot.find((candidate) => candidate.path === path);
  if (!entry) throw new Error(`Expected storage snapshot entry ${path}.`);
  return entry;
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

function makeActiveDatabaseOwnerOnly(path: string): void {
  for (const entryPath of [path, `${path}-wal`, `${path}-shm`]) {
    expect(lstatExists(entryPath)).toBe(true);
    chmodSync(entryPath, 0o600);
  }
}

function runServerReadWithInjectedLstat(
  path: string,
  mutation:
    | "owner_mismatch"
    | "inode_swap"
    | "main_owner_mismatch"
    | "main_inode_swap"
): Readonly<{ reason: string | null; name: string | null }> {
  const environment = {
    ...process.env,
    AGENTLENS_SERVER_DATABASE_PATH: path,
    AGENTLENS_LSTAT_MUTATION: mutation
  };
  const databaseModule = new URL("../src/database.ts", import.meta.url).href;
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const path = process.env.AGENTLENS_SERVER_DATABASE_PATH;
    const mutation = process.env.AGENTLENS_LSTAT_MUTATION;
    const originalLstat = fs.lstatSync.bind(fs);
    const target = mutation.startsWith("main_") ? path : path + "-shm";
    let targetStats = 0;
    fs.lstatSync = (candidate, options) => {
      const stat = originalLstat(candidate, options);
      if (String(candidate) !== target) return stat;
      targetStats += 1;
      const ownerMismatch = mutation.endsWith("owner_mismatch");
      const inodeSwap = mutation.endsWith("inode_swap");
      const shouldMutate = ownerMismatch || (inodeSwap && targetStats === 2);
      if (!shouldMutate) return stat;
      const changed = Object.assign(Object.create(Object.getPrototypeOf(stat)), stat);
      if (ownerMismatch) {
        changed.uid = typeof stat.uid === "bigint" ? stat.uid + 1n : stat.uid + 1;
      } else {
        changed.ino = typeof stat.ino === "bigint" ? stat.ino + 1n : stat.ino + 1;
      }
      return changed;
    };
    syncBuiltinESMExports();
    const { openDatabaseForServerRead } = await import(${JSON.stringify(databaseModule)});
    let opened;
    let error;
    try {
      opened = openDatabaseForServerRead(path);
    } catch (caught) {
      error = caught;
    } finally {
      opened?.database.close();
    }
    process.stdout.write(JSON.stringify({
      reason: error?.reason ?? null,
      name: error?.name ?? null
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
  return JSON.parse(child.stdout) as Readonly<{ reason: string | null; name: string | null }>;
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

describe("openDatabaseForServerRead", () => {
  it("rolls back a server snapshot after both success and failure", async () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    new RunRepository(writable, {
      artifactRoot: join(dirname(path), "artifacts", "sha256")
    }).createRun(validRun("snapshot-rollback-run"), validOwnership());
    writable.close();
    const opened = openDatabaseForServerRead(path);
    try {
      await expect(withServerReadSnapshot(opened.database, () =>
        new RunRepository(opened.database, {
          artifactRoot: join(dirname(path), "artifacts", "sha256")
        }).getRun("snapshot-rollback-run")?.id
      )).resolves.toBe("snapshot-rollback-run");
      await expect(withServerReadSnapshot(opened.database, () => {
        throw new Error("snapshot operation failed");
      })).rejects.toThrow("snapshot operation failed");
      await expect(withServerReadSnapshot(opened.database, () => "reusable"))
        .resolves.toBe("reusable");
      expect(connectionFor(opened.database).inTransaction).toBe(false);
    } finally {
      opened.database.close();
    }
  });

  it("uses the immutable path when the WAL is genuinely absent", () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    new RunRepository(writable, {
      artifactRoot: join(dirname(path), "artifacts", "sha256")
    }).createRun(validRun("immutable-server-run"), validOwnership());
    writable.close();
    expect(existsSync(`${path}-wal`)).toBe(false);
    const before = snapshotStorage(path);

    const opened = openDatabaseForServerRead(path);
    try {
      expect(opened.mode).toBe("immutable");
      expect(new RunRepository(opened.database, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      }).listRuns().map(({ id }) => id)).toEqual(["immutable-server-run"]);
    } finally {
      opened.database.close();
    }

    expect(snapshotStorage(path)).toEqual(before);
  });

  it("sees fresh committed active-WAL runs without changing storage outside SHM coordination", () => {
    const path = temporaryDatabasePath();
    const artifactRoot = join(dirname(path), "artifacts", "sha256");
    const writable = openDatabase(path);
    const writableRepository = new RunRepository(writable, { artifactRoot });
    try {
      writableRepository.createRun(validRun("active-run-1"), validOwnership());
      mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
      writeFileSync(join(artifactRoot, "fixture-artifact"), "artifact bytes\n", { mode: 0o600 });
      makeActiveDatabaseOwnerOnly(path);

      const assertReadBoundary = (expectedRunId: string): void => {
        const before = snapshotStorage(path);
        const beforeShm = snapshotEntry(before, "agentlens.sqlite-shm");

        const opened = openDatabaseForServerRead(path);
        try {
          expect(opened.mode).toBe("active_wal");
          expect(new RunRepository(opened.database, { artifactRoot }).listRuns()
            .map(({ id }) => id)).toContain(expectedRunId);
          expect(() => connectionFor(opened.database)
            .prepare("UPDATE runs SET repository_display = ? WHERE id = ?")
            .run("forbidden-write", expectedRunId)).toThrow(/readonly|query.only/i);
          expect(opened.database.inspect()).toMatchObject({
            foreignKeys: true,
            queryOnly: true,
            busyTimeout: 5000
          });
        } finally {
          opened.database.close();
        }

        const after = snapshotStorage(path);
        const afterShm = snapshotEntry(after, "agentlens.sqlite-shm");
        expect(withAllowedShmCoordination(after)).toEqual(
          withAllowedShmCoordination(before)
        );
        expect(afterShm).toMatchObject({
          type: "file",
          uid: beforeShm.uid,
          gid: beforeShm.gid,
          mode: beforeShm.mode,
          inode: beforeShm.inode,
          size: beforeShm.size
        });
      };

      assertReadBoundary("active-run-1");
      writableRepository.createRun(validRun("active-run-2"), validOwnership());
      assertReadBoundary("active-run-2");
    } finally {
      writable.close();
    }
  });

  it("fails active-WAL reads when the pre-existing SHM is absent", () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    try {
      new RunRepository(writable, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      }).createRun(validRun("missing-shm-run"), validOwnership());
      makeActiveDatabaseOwnerOnly(path);
      rmSync(`${path}-shm`);
      const before = snapshotStorage(path);

      expect(thrownBy(() => openDatabaseForServerRead(path))).toMatchObject({
        reason: "active_sidecar_missing"
      });
      expect(snapshotStorage(path)).toEqual(before);
    } finally {
      writable.close();
    }
  });

  it("maps a stable corrupt active database without mutation outside SHM coordination", () => {
    const path = temporaryDatabasePath();
    writeFileSync(path, "not a sqlite database\n", { mode: 0o600 });
    writeFileSync(`${path}-wal`, Buffer.alloc(32, 0x57), { mode: 0o600 });
    writeFileSync(`${path}-shm`, Buffer.alloc(32_768, 0x53), { mode: 0o600 });
    const before = snapshotStorage(path);

    const error = thrownBy(() => openDatabaseForServerRead(path));
    expect(error).toMatchObject({
      name: "ServerReadDatabaseError",
      reason: "active_wal_unavailable"
    });
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(withAllowedShmCoordination(snapshotStorage(path))).toEqual(
      withAllowedShmCoordination(before)
    );
  });

  it.each([
    { entry: "database", kind: "directory" },
    { entry: "database", kind: "symlink" },
    { entry: "wal", kind: "directory" },
    { entry: "wal", kind: "symlink" },
    { entry: "shm", kind: "directory" },
    { entry: "shm", kind: "symlink" }
  ] as const)("rejects an active $entry $kind without mutation", ({ entry, kind }) => {
    const path = temporaryDatabasePath();
    createDatabaseThrough(path, 4).close();
    chmodSync(path, 0o600);
    const walPath = `${path}-wal`;
    const shmPath = `${path}-shm`;
    writeFileSync(walPath, "WAL fixture bytes", { mode: 0o600 });
    writeFileSync(shmPath, "SHM fixture bytes", { mode: 0o600 });
    const entryPath = entry === "database" ? path : entry === "wal" ? walPath : shmPath;
    rmSync(entryPath);
    if (kind === "directory") mkdirSync(entryPath, { mode: 0o700 });
    else {
      const target = join(dirname(path), `${entry}-target`);
      writeFileSync(target, "target bytes", { mode: 0o600 });
      symlinkSync(target, entryPath);
    }
    const before = snapshotStorage(path);

    expect(thrownBy(() => openDatabaseForServerRead(path))).toMatchObject({
      reason: "active_sidecar_invalid"
    });
    expect(snapshotStorage(path)).toEqual(before);
  });

  it.each([
    { entry: "database", mode: 0o640 },
    { entry: "wal", mode: 0o640 },
    { entry: "shm", mode: 0o604 }
  ] as const)("rejects group/world permissions on the active $entry", ({ entry, mode }) => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    try {
      new RunRepository(writable, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      }).createRun(validRun(`permissive-${entry}`), validOwnership());
      makeActiveDatabaseOwnerOnly(path);
      chmodSync(entry === "database" ? path : `${path}-${entry}`, mode);
      const before = snapshotStorage(path);

      expect(thrownBy(() => openDatabaseForServerRead(path))).toMatchObject({
        reason: "active_sidecar_invalid"
      });
      expect(snapshotStorage(path)).toEqual(before);
    } finally {
      writable.close();
    }
  });

  it("rejects an active sidecar whose owner differs from the effective user", () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    try {
      new RunRepository(writable, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      }).createRun(validRun("owner-mismatch-run"), validOwnership());
      makeActiveDatabaseOwnerOnly(path);
      const before = snapshotStorage(path);

      expect(runServerReadWithInjectedLstat(path, "owner_mismatch")).toEqual({
        name: "ServerReadDatabaseError",
        reason: "active_sidecar_invalid"
      });
      expect(snapshotStorage(path)).toEqual(before);
    } finally {
      writable.close();
    }
  });

  it("fails closed when an active sidecar inode changes between validation and open", () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    try {
      new RunRepository(writable, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      }).createRun(validRun("inode-swap-run"), validOwnership());
      makeActiveDatabaseOwnerOnly(path);
      const before = snapshotStorage(path);

      expect(runServerReadWithInjectedLstat(path, "inode_swap")).toEqual({
        name: "ServerReadDatabaseError",
        reason: "active_sidecar_changed"
      });
      expect(withAllowedShmCoordination(snapshotStorage(path))).toEqual(
        withAllowedShmCoordination(before)
      );
    } finally {
      writable.close();
    }
  });

  it("rejects an active main database whose owner differs from the effective user", () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    try {
      new RunRepository(writable, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      }).createRun(validRun("main-owner-mismatch-run"), validOwnership());
      makeActiveDatabaseOwnerOnly(path);
      const before = snapshotStorage(path);

      expect(runServerReadWithInjectedLstat(path, "main_owner_mismatch")).toEqual({
        name: "ServerReadDatabaseError",
        reason: "active_sidecar_invalid"
      });
      expect(snapshotStorage(path)).toEqual(before);
    } finally {
      writable.close();
    }
  });

  it("fails closed when the main database inode changes between validation and open", () => {
    const path = temporaryDatabasePath();
    const writable = openDatabase(path);
    try {
      new RunRepository(writable, {
        artifactRoot: join(dirname(path), "artifacts", "sha256")
      }).createRun(validRun("main-inode-swap-run"), validOwnership());
      makeActiveDatabaseOwnerOnly(path);
      const before = snapshotStorage(path);

      expect(runServerReadWithInjectedLstat(path, "main_inode_swap")).toEqual({
        name: "ServerReadDatabaseError",
        reason: "active_sidecar_changed"
      });
      expect(withAllowedShmCoordination(snapshotStorage(path))).toEqual(
        withAllowedShmCoordination(before)
      );
    } finally {
      writable.close();
    }
  });
});
