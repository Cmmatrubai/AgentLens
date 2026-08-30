import { spawn } from "node:child_process";
import { constants as fileConstants } from "node:fs";
import { lstat, open, opendir, type FileHandle } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import {
  openDatabaseReadOnly,
  ReadOnlyDatabaseError,
  type DatabaseInspection
} from "@agentlens/storage";

export interface DoctorResultV1 {
  readonly schemaVersion: 1;
  readonly overall: "pass" | "warn" | "fail";
  readonly dataRoot: string;
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly summary: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export type CodexVersionProbe =
  | Readonly<{ state: "available"; version: string }>
  | Readonly<{ state: "missing" | "spawn_failed" | "invalid" }>
  | Readonly<{ state: "nonzero"; exitCode: number | null; signal: number | null }>
  | Readonly<{ state: "timeout" | "overflow"; signal: number | null }>;

export type ProcessGroupProbe = Readonly<{
  state: "posix" | "fallback" | "known_limitation";
}>;

interface LoopbackLease {
  close(): Promise<void>;
}

export interface DoctorDependencies {
  readonly storageChecks?: (dataRoot: string) => Promise<readonly DoctorCheck[]>;
  readonly databaseInspection?: (databasePath: string) => Promise<DatabaseInspection>;
  readonly currentUid?: () => number | null;
  readonly inspectionLimit?: number;
  readonly codexVersion?: () => Promise<CodexVersionProbe>;
  readonly codexEnvironment?: NodeJS.ProcessEnv;
  readonly processGroups?: () => Promise<ProcessGroupProbe>;
  readonly loopbackBind?: (host: string, port: number) => Promise<LoopbackLease>;
}

type PathKind = "directory" | "file" | "symlink" | "other";

interface ExistingPath {
  readonly exists: true;
  readonly kind: PathKind;
  readonly mode: number;
  readonly uid: number;
  readonly dev: bigint;
  readonly ino: bigint;
}

type InspectedPath = ExistingPath | Readonly<{ exists: false }>;

const summaries = Object.freeze({
  data_root: Object.freeze({
    pass: "Data root is present and protected.",
    warn: "Data root is not initialized.",
    fail: "Data root inspection failed."
  }),
  sensitive_paths: Object.freeze({
    pass: "Sensitive storage paths are protected.",
    warn: "Sensitive storage paths are not initialized.",
    fail: "Sensitive storage path inspection failed."
  }),
  redaction_key: Object.freeze({
    pass: "Redaction key metadata is protected.",
    warn: "Redaction key is not initialized.",
    fail: "Redaction key metadata is invalid."
  }),
  sqlite: Object.freeze({
    pass: "SQLite storage is current and healthy.",
    warn: "SQLite storage is not initialized.",
    fail: "SQLite storage validation failed."
  }),
  codex: Object.freeze({
    pass: "Codex is available.",
    warn: "Codex availability check failed.",
    fail: "Codex availability check failed."
  }),
  process_groups: Object.freeze({
    pass: "POSIX process-group support is available.",
    warn: "POSIX process-group support is limited.",
    fail: "POSIX process-group support is limited."
  }),
  loopback: Object.freeze({
    pass: "Loopback binding is available.",
    warn: "Loopback binding check failed.",
    fail: "Loopback binding check failed."
  })
} as const);

const storageCheckIds = ["data_root", "sensitive_paths", "redaction_key", "sqlite"] as const;
const requiredTables = Object.freeze([
  "artifacts",
  "current_assessments",
  "derivation_identities",
  "event_artifact_bindings",
  "event_relationships",
  "event_sources",
  "events",
  "git_evidence",
  "redaction_audits",
  "run_ownership",
  "runs",
  "schema_migrations"
]);
const requiredIndexes = Object.freeze([
  "idx_artifacts_run_id",
  "idx_derivation_identities_run_source",
  "idx_event_artifact_bindings_run_artifact",
  "idx_event_artifact_bindings_run_event",
  "idx_event_relationships_one_recovery",
  "idx_event_relationships_related_event_id",
  "idx_event_sources_run_item_id",
  "idx_event_sources_run_turn_id",
  "idx_events_id_run_id",
  "idx_events_run_sequence",
  "idx_run_ownership_condition",
  "idx_runs_started_at"
]);
const defaultInspectionLimit = 10_000;
const codexOutputLimit = 8 * 1024;
const codexTimeoutMs = 3_000;

class StableInspectionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function doctorCheck(
  id: keyof typeof summaries,
  status: DoctorCheck["status"],
  code: string,
  metadata: Readonly<Record<string, string | number | boolean | null>> = {}
): DoctorCheck {
  return Object.freeze({
    id,
    status,
    summary: summaries[id][status],
    metadata: Object.freeze({ code, ...metadata })
  });
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

function pathKind(stats: Awaited<ReturnType<typeof lstat>>): PathKind {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  if (stats.isSymbolicLink()) return "symlink";
  return "other";
}

async function closeHandle(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    throw new StableInspectionError("path_inspection_failed");
  }
}

async function inspectPath(path: string): Promise<InspectedPath> {
  let pathStats;
  try {
    pathStats = await lstat(path, { bigint: true });
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return Object.freeze({ exists: false });
    throw new StableInspectionError("path_inspection_failed");
  }
  const kind = pathKind(pathStats as unknown as Awaited<ReturnType<typeof lstat>>);
  if (kind === "symlink" || kind === "other") {
    return Object.freeze({
      exists: true,
      kind,
      mode: Number(pathStats.mode),
      uid: Number(pathStats.uid),
      dev: pathStats.dev,
      ino: pathStats.ino
    });
  }

  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fileConstants.O_RDONLY |
        fileConstants.O_NOFOLLOW |
        (kind === "directory" ? fileConstants.O_DIRECTORY : 0)
    );
  } catch {
    throw new StableInspectionError("path_inspection_failed");
  }
  try {
    const handleStats = await handle.stat({ bigint: true });
    if (
      (kind === "directory" ? !handleStats.isDirectory() : !handleStats.isFile()) ||
      handleStats.dev !== pathStats.dev ||
      handleStats.ino !== pathStats.ino
    ) {
      throw new StableInspectionError("path_identity_changed");
    }
  } finally {
    await closeHandle(handle);
  }
  return Object.freeze({
    exists: true,
    kind,
    mode: Number(pathStats.mode),
    uid: Number(pathStats.uid),
    dev: pathStats.dev,
    ino: pathStats.ino
  });
}

function currentUid(dependencies: DoctorDependencies): number | null {
  if (dependencies.currentUid) return dependencies.currentUid();
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function structuralCode(path: InspectedPath, expected: "directory" | "file"): string | null {
  if (!path.exists) return null;
  if (path.kind === "symlink") return "path_symlink";
  if (path.kind !== expected) return "path_non_regular";
  return null;
}

function permissionCode(
  path: ExistingPath,
  expected: "directory" | "file",
  uid: number | null,
  ownerOnlyFile = false
): "wrong_owner" | "permissions" | null {
  if (uid === null) return null;
  if (path.uid !== uid) return "wrong_owner";
  const forbidden = expected === "directory" || ownerOnlyFile ? 0o077 : 0o044;
  return (path.mode & forbidden) === 0 ? null : "permissions";
}

async function walkSensitiveTree(
  root: string,
  uid: number | null,
  limit: number,
  counters: { directories: number; files: number; entries: number }
): Promise<string | null> {
  const rootInfo = await inspectPath(root);
  if (!rootInfo.exists) return null;
  const rootStructure = structuralCode(rootInfo, "directory");
  if (rootStructure) return rootStructure;
  const rootPermission = permissionCode(rootInfo as ExistingPath, "directory", uid);
  if (rootPermission) return rootPermission;

  let directory;
  try {
    directory = await opendir(root);
  } catch {
    throw new StableInspectionError("path_inspection_failed");
  }
  try {
    for await (const entry of directory) {
      counters.entries += 1;
      if (counters.entries > limit) return "inspection_limit";
      const childPath = join(root, entry.name);
      const child = await inspectPath(childPath);
      if (!child.exists) throw new StableInspectionError("path_identity_changed");
      if (child.kind === "directory") {
        counters.directories += 1;
        const nested = await walkSensitiveTree(childPath, uid, limit, counters);
        if (nested) return nested;
      } else {
        const structure = structuralCode(child, "file");
        if (structure) return structure;
        counters.files += 1;
        const permission = permissionCode(child as ExistingPath, "file", uid);
        if (permission) return permission;
      }
    }
  } finally {
    try {
      await directory.close();
    } catch (error) {
      if (errnoCode(error) !== "ERR_DIR_CLOSED") {
        throw new StableInspectionError("path_inspection_failed");
      }
    }
  }
  return null;
}

async function defaultDatabaseInspection(databasePath: string): Promise<DatabaseInspection> {
  const database = openDatabaseReadOnly(databasePath);
  try {
    try {
      return database.inspect();
    } catch {
      throw new StableInspectionError("corrupt");
    }
  } finally {
    database.close();
  }
}

function sqliteInspectionCheck(inspection: DatabaseInspection): DoctorCheck {
  const migrations = [...inspection.migrations];
  const integerMigrations = migrations.every((version) =>
    typeof version === "number" && Number.isInteger(version) && version > 0
  );
  const sequential = integerMigrations && migrations.every((version, index) => version === index + 1);
  const currentMigration = integerMigrations && migrations.length > 0
    ? Math.max(...migrations)
    : null;
  const migrationMetadata = {
    migrationCount: migrations.length,
    currentMigration
  };

  if (migrations.length === 0 || !sequential) {
    return doctorCheck("sqlite", "fail", "schema_unsupported", migrationMetadata);
  }
  if (currentMigration !== null && currentMigration < 4) {
    return doctorCheck("sqlite", "fail", "schema_older", migrationMetadata);
  }
  if (currentMigration !== null && currentMigration > 4) {
    return doctorCheck("sqlite", "fail", "schema_future", migrationMetadata);
  }

  const tableSet = new Set(inspection.tables);
  const indexSet = new Set(inspection.indexes);
  const sharedMetadata = {
    ...migrationMetadata,
    tableCount: inspection.tables.length,
    indexCount: inspection.indexes.length
  };
  if (!requiredTables.every((table) => tableSet.has(table))) {
    return doctorCheck("sqlite", "fail", "tables_missing", sharedMetadata);
  }
  if (!requiredIndexes.every((index) => indexSet.has(index))) {
    return doctorCheck("sqlite", "fail", "indexes_missing", sharedMetadata);
  }
  if (!inspection.foreignKeys) {
    return doctorCheck("sqlite", "fail", "foreign_keys_disabled", sharedMetadata);
  }
  if (!inspection.queryOnly) {
    return doctorCheck("sqlite", "fail", "query_only_disabled", sharedMetadata);
  }
  if (inspection.foreignKeyCheck.length !== 0) {
    return doctorCheck("sqlite", "fail", "foreign_key_violation", {
      ...sharedMetadata,
      violationCount: inspection.foreignKeyCheck.length
    });
  }
  if (inspection.quickCheck.length !== 1 || inspection.quickCheck[0] !== "ok") {
    return doctorCheck("sqlite", "fail", "quick_check_failed", {
      ...sharedMetadata,
      quickCheckOk: false
    });
  }
  if (inspection.integrity !== "ok") {
    return doctorCheck("sqlite", "fail", "integrity_failed", {
      ...sharedMetadata,
      integrityOk: false
    });
  }
  return doctorCheck("sqlite", "pass", "ok", {
    ...sharedMetadata,
    foreignKeys: true,
    queryOnly: true,
    foreignKeyViolationCount: 0,
    quickCheckOk: true,
    integrityOk: true
  });
}

async function inspectStorageChecks(
  dataRoot: string,
  dependencies: DoctorDependencies
): Promise<readonly DoctorCheck[]> {
  const uid = currentUid(dependencies);
  let root: InspectedPath;
  try {
    root = await inspectPath(dataRoot);
  } catch {
    return storageCheckIds.map((id) => doctorCheck(id, "fail", "path_inspection_failed"));
  }
  if (!root.exists) {
    return storageCheckIds.map((id) => doctorCheck(id, "warn", "not_initialized"));
  }
  if (root.kind === "symlink" || root.kind !== "directory") {
    const rootCode = root.kind === "symlink" ? "root_symlink" : "root_non_directory";
    return [
      doctorCheck("data_root", "fail", rootCode),
      doctorCheck("sensitive_paths", "fail", "root_invalid"),
      doctorCheck("redaction_key", "fail", "root_invalid"),
      doctorCheck("sqlite", "fail", "root_invalid")
    ];
  }

  const rootPermission = permissionCode(root, "directory", uid);
  const dataRootCheck = rootPermission
    ? doctorCheck("data_root", "fail", rootPermission)
    : uid === null
      ? doctorCheck("data_root", "warn", "platform_unsupported")
      : doctorCheck("data_root", "pass", "ok");

  const paths = {
    secrets: join(dataRoot, "secrets"),
    key: join(dataRoot, "secrets", "redaction-hmac.key"),
    artifacts: join(dataRoot, "artifacts"),
    temporaryArtifacts: join(dataRoot, "artifacts", "tmp"),
    finalArtifacts: join(dataRoot, "artifacts", "sha256"),
    database: join(dataRoot, "agentlens.sqlite"),
    wal: join(dataRoot, "agentlens.sqlite-wal"),
    shm: join(dataRoot, "agentlens.sqlite-shm")
  };
  const missingPath: InspectedPath = Object.freeze({ exists: false });
  let inspected: Record<keyof typeof paths, InspectedPath>;
  try {
    const [secrets, artifacts, database, wal, shm] = await Promise.all([
      inspectPath(paths.secrets),
      inspectPath(paths.artifacts),
      inspectPath(paths.database),
      inspectPath(paths.wal),
      inspectPath(paths.shm)
    ]);
    const key = secrets.exists && secrets.kind === "directory"
      ? await inspectPath(paths.key)
      : missingPath;
    const [temporaryArtifacts, finalArtifacts] = artifacts.exists &&
        artifacts.kind === "directory"
      ? await Promise.all([
          inspectPath(paths.temporaryArtifacts),
          inspectPath(paths.finalArtifacts)
        ])
      : [missingPath, missingPath];
    inspected = {
      secrets,
      key,
      artifacts,
      temporaryArtifacts,
      finalArtifacts,
      database,
      wal,
      shm
    };
  } catch {
    return [
      dataRootCheck,
      doctorCheck("sensitive_paths", "fail", "path_inspection_failed"),
      doctorCheck("redaction_key", "fail", "path_inspection_failed"),
      doctorCheck("sqlite", "fail", "path_inspection_failed")
    ];
  }

  const initialized = Object.values(inspected).some(({ exists }) => exists);
  const counters = { directories: 0, files: 0, entries: 0 };
  let sensitiveFailure: string | null = rootPermission;
  if (!sensitiveFailure) {
    const expectedPaths: readonly [InspectedPath, "directory" | "file", boolean][] = [
      [inspected.secrets, "directory", false],
      [inspected.key, "file", true],
      [inspected.artifacts, "directory", false],
      [inspected.temporaryArtifacts, "directory", false],
      [inspected.finalArtifacts, "directory", false],
      [inspected.database, "file", false],
      [inspected.wal, "file", false],
      [inspected.shm, "file", false]
    ];
    for (const [candidate, expected, ownerOnly] of expectedPaths) {
      const structure = structuralCode(candidate, expected);
      if (structure) {
        sensitiveFailure = structure;
        break;
      }
      if (!candidate.exists) continue;
      if (expected === "directory") counters.directories += 1;
      else counters.files += 1;
      const permission = permissionCode(candidate, expected, uid, ownerOnly);
      if (permission) {
        sensitiveFailure = permission;
        break;
      }
    }
  }
  if (!sensitiveFailure) {
    try {
      for (const tree of [paths.temporaryArtifacts, paths.finalArtifacts]) {
        const failure = await walkSensitiveTree(
          tree,
          uid,
          dependencies.inspectionLimit ?? defaultInspectionLimit,
          counters
        );
        if (failure) {
          sensitiveFailure = failure;
          break;
        }
      }
    } catch (error) {
      sensitiveFailure = error instanceof StableInspectionError
        ? error.code
        : "path_inspection_failed";
    }
  }
  const sensitiveMetadata = {
    inspectedDirectories: counters.directories,
    inspectedFiles: counters.files,
    inspectedEntries: counters.entries
  };
  const sensitiveCheck = sensitiveFailure
    ? doctorCheck("sensitive_paths", "fail", sensitiveFailure, sensitiveMetadata)
    : uid === null
      ? doctorCheck("sensitive_paths", "warn", "platform_unsupported", sensitiveMetadata)
      : doctorCheck("sensitive_paths", "pass", "ok", sensitiveMetadata);

  let keyCheck: DoctorCheck;
  const key = inspected.key;
  if (inspected.secrets.exists && inspected.secrets.kind !== "directory") {
    keyCheck = doctorCheck("redaction_key", "fail", "key_parent_invalid");
  } else if (!key.exists) {
    keyCheck = inspected.database.exists
      ? doctorCheck("redaction_key", "fail", "key_missing")
      : doctorCheck("redaction_key", "warn", "not_initialized");
  } else if (key.kind === "symlink") {
    keyCheck = doctorCheck("redaction_key", "fail", "key_symlink");
  } else if (key.kind !== "file") {
    keyCheck = doctorCheck("redaction_key", "fail", "key_non_regular");
  } else if (uid === null) {
    keyCheck = doctorCheck("redaction_key", "warn", "platform_unsupported");
  } else if (key.uid !== uid) {
    keyCheck = doctorCheck("redaction_key", "fail", "key_wrong_owner");
  } else if ((key.mode & 0o077) !== 0) {
    keyCheck = doctorCheck("redaction_key", "fail", "key_permissions");
  } else {
    keyCheck = doctorCheck("redaction_key", "pass", "ok");
  }

  let sqliteCheck: DoctorCheck;
  const wal = inspected.wal;
  const shm = inspected.shm;
  const database = inspected.database;
  if (wal.exists && wal.kind === "symlink") {
    sqliteCheck = doctorCheck("sqlite", "fail", "sidecar_symlink");
  } else if (wal.exists && wal.kind !== "file") {
    sqliteCheck = doctorCheck("sqlite", "fail", "sidecar_non_regular");
  } else if (wal.exists) {
    sqliteCheck = doctorCheck("sqlite", "fail", "wal_present");
  } else if (shm.exists && shm.kind === "symlink") {
    sqliteCheck = doctorCheck("sqlite", "fail", "sidecar_symlink");
  } else if (shm.exists && shm.kind !== "file") {
    sqliteCheck = doctorCheck("sqlite", "fail", "sidecar_non_regular");
  } else if (database.exists && database.kind === "symlink") {
    sqliteCheck = doctorCheck("sqlite", "fail", "database_symlink");
  } else if (database.exists && database.kind !== "file") {
    sqliteCheck = doctorCheck("sqlite", "fail", "database_non_regular");
  } else if (!database.exists) {
    sqliteCheck = initialized
      ? doctorCheck("sqlite", "fail", "database_missing")
      : doctorCheck("sqlite", "warn", "not_initialized");
  } else {
    try {
      const inspection = await (dependencies.databaseInspection ?? defaultDatabaseInspection)(
        paths.database
      );
      sqliteCheck = sqliteInspectionCheck(inspection);
    } catch (error) {
      if (error instanceof ReadOnlyDatabaseError) {
        sqliteCheck = doctorCheck("sqlite", "fail", error.reason);
      } else if (error instanceof StableInspectionError && error.code === "corrupt") {
        sqliteCheck = doctorCheck("sqlite", "fail", "corrupt");
      } else {
        sqliteCheck = doctorCheck("sqlite", "fail", "open_failed");
      }
    }
  }

  return Object.freeze([dataRootCheck, sensitiveCheck, keyCheck, sqliteCheck]);
}

function signalNumber(signal: NodeJS.Signals | null): number | null {
  if (signal === null) return null;
  return osConstants.signals[signal] ?? null;
}

function semanticVersion(stdout: Buffer): string | null {
  const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
  for (const token of stdout.toString("utf8").split(/\s+/u)) {
    if (Buffer.byteLength(token, "utf8") <= 128 && semanticVersionPattern.test(token)) return token;
  }
  return null;
}

async function systemCodexVersion(environment?: NodeJS.ProcessEnv): Promise<CodexVersionProbe> {
  return await new Promise<CodexVersionProbe>((resolveProbe) => {
    const child = spawn("codex", ["--version"], {
      env: environment ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end();
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    let forcedState: "timeout" | "overflow" | undefined;
    let spawnError: unknown;
    let killTimer: NodeJS.Timeout | undefined;

    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 250);
    };
    const timeout = setTimeout(() => {
      forcedState ??= "timeout";
      terminate();
    }, codexTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= codexOutputLimit) stdout.push(Buffer.from(chunk));
      else {
        forcedState ??= "overflow";
        terminate();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > codexOutputLimit) {
        forcedState ??= "overflow";
        terminate();
      }
    });
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (forcedState) {
        resolveProbe({ state: forcedState, signal: signalNumber(signal) });
        return;
      }
      if (spawnError) {
        resolveProbe(
          errnoCode(spawnError) === "ENOENT" ? { state: "missing" } : { state: "spawn_failed" }
        );
        return;
      }
      if (exitCode !== 0) {
        resolveProbe({ state: "nonzero", exitCode, signal: signalNumber(signal) });
        return;
      }
      const version = semanticVersion(Buffer.concat(stdout));
      resolveProbe(version === null ? { state: "invalid" } : { state: "available", version });
    });
  });
}

function codexCheck(probe: CodexVersionProbe): DoctorCheck {
  switch (probe.state) {
    case "available":
      return doctorCheck("codex", "pass", "ok", { version: probe.version });
    case "missing":
      return doctorCheck("codex", "fail", "executable_missing");
    case "spawn_failed":
      return doctorCheck("codex", "fail", "spawn_failed");
    case "invalid":
      return doctorCheck("codex", "fail", "version_invalid");
    case "nonzero":
      return doctorCheck("codex", "fail", "nonzero_exit", {
        exitCode: probe.exitCode,
        signal: probe.signal
      });
    case "timeout":
      return doctorCheck("codex", "fail", "timeout", { signal: probe.signal });
    case "overflow":
      return doctorCheck("codex", "fail", "output_overflow", { signal: probe.signal });
  }
}

async function inspectCodex(dependencies: DoctorDependencies): Promise<DoctorCheck> {
  try {
    const probe = await (dependencies.codexVersion ?? (() =>
      systemCodexVersion(dependencies.codexEnvironment)))();
    return codexCheck(probe);
  } catch {
    return doctorCheck("codex", "fail", "spawn_failed");
  }
}

async function systemProcessGroups(): Promise<ProcessGroupProbe> {
  return process.platform === "win32"
    ? { state: "known_limitation" }
    : { state: "posix" };
}

async function inspectProcessGroups(dependencies: DoctorDependencies): Promise<DoctorCheck> {
  try {
    const probe = await (dependencies.processGroups ?? systemProcessGroups)();
    if (probe.state === "posix") return doctorCheck("process_groups", "pass", "ok");
    if (probe.state === "fallback") return doctorCheck("process_groups", "warn", "fallback");
    return doctorCheck("process_groups", "warn", "platform_unsupported");
  } catch {
    return doctorCheck("process_groups", "warn", "probe_failed");
  }
}

async function systemLoopbackBind(host: string, port: number): Promise<LoopbackLease> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once("error", onError);
    server.listen({ host, port, exclusive: true }, () => {
      server.removeListener("error", onError);
      resolveListen();
    });
  });
  return {
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  };
}

async function inspectLoopback(dependencies: DoctorDependencies): Promise<DoctorCheck> {
  let lease: LoopbackLease;
  try {
    lease = await (dependencies.loopbackBind ?? systemLoopbackBind)("127.0.0.1", 0);
  } catch {
    return doctorCheck("loopback", "warn", "bind_failed", { host: "127.0.0.1" });
  }
  try {
    await lease.close();
  } catch {
    return doctorCheck("loopback", "warn", "close_failed", { host: "127.0.0.1" });
  }
  return doctorCheck("loopback", "pass", "ok", { host: "127.0.0.1" });
}

function normalizedStorageChecks(checks: readonly DoctorCheck[]): readonly DoctorCheck[] {
  return storageCheckIds.map((id) => {
    const matching = checks.filter((check) => check.id === id);
    return matching.length === 1
      ? matching[0]!
      : doctorCheck(id, "fail", "probe_failed");
  });
}

function overallStatus(checks: readonly DoctorCheck[]): DoctorResultV1["overall"] {
  if (checks.some(({ status }) => status === "fail")) return "fail";
  return checks.some(({ status }) => status === "warn") ? "warn" : "pass";
}

export async function diagnoseDoctor(
  requestedDataRoot: string,
  dependencies: DoctorDependencies = {}
): Promise<DoctorResultV1> {
  const dataRoot = resolve(requestedDataRoot);
  let storage: readonly DoctorCheck[];
  try {
    storage = normalizedStorageChecks(await (
      dependencies.storageChecks ?? ((root) => inspectStorageChecks(root, dependencies))
    )(dataRoot));
  } catch {
    storage = storageCheckIds.map((id) => doctorCheck(id, "fail", "probe_failed"));
  }
  const [codex, processGroups, loopback] = await Promise.all([
    inspectCodex(dependencies),
    inspectProcessGroups(dependencies),
    inspectLoopback(dependencies)
  ]);
  const checks = Object.freeze([...storage, codex, processGroups, loopback]);
  return Object.freeze({
    schemaVersion: 1,
    overall: overallStatus(checks),
    dataRoot,
    checks
  });
}
