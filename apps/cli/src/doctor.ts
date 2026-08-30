import { spawn } from "node:child_process";
import { constants as fileConstants } from "node:fs";
import { lstat, open, opendir, type FileHandle } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { TextDecoder } from "node:util";

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
type PathInspectionOutcome =
  | Readonly<{ ok: true; path: InspectedPath }>
  | Readonly<{ ok: false }>;

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

async function inspectPathMetadata(path: string): Promise<InspectedPath> {
  let pathStats;
  try {
    pathStats = await lstat(path, { bigint: true });
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return Object.freeze({ exists: false });
    throw new StableInspectionError("path_inspection_failed");
  }
  const kind = pathKind(pathStats as unknown as Awaited<ReturnType<typeof lstat>>);
  return Object.freeze({
    exists: true,
    kind,
    mode: Number(pathStats.mode),
    uid: Number(pathStats.uid),
    dev: pathStats.dev,
    ino: pathStats.ino
  });
}

async function inspectPath(path: string): Promise<InspectedPath> {
  const metadata = await inspectPathMetadata(path);
  if (!metadata.exists || metadata.kind === "symlink" || metadata.kind === "other") {
    return metadata;
  }

  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fileConstants.O_RDONLY |
        fileConstants.O_NOFOLLOW |
        (metadata.kind === "directory" ? fileConstants.O_DIRECTORY : 0)
    );
  } catch {
    throw new StableInspectionError("path_inspection_failed");
  }
  try {
    const handleStats = await handle.stat({ bigint: true });
    if (
      (metadata.kind === "directory" ? !handleStats.isDirectory() : !handleStats.isFile()) ||
      handleStats.dev !== metadata.dev ||
      handleStats.ino !== metadata.ino
    ) {
      throw new StableInspectionError("path_identity_changed");
    }
  } finally {
    await closeHandle(handle);
  }
  return metadata;
}

async function pathInspectionOutcome(
  path: string,
  metadataOnly = false
): Promise<PathInspectionOutcome> {
  try {
    return Object.freeze({
      ok: true,
      path: await (metadataOnly ? inspectPathMetadata(path) : inspectPath(path))
    });
  } catch {
    return Object.freeze({ ok: false });
  }
}

async function isTrustedAncestorAlias(
  path: string,
  alias: ExistingPath,
  expectedOwner: number
): Promise<boolean> {
  if (alias.uid === expectedOwner) return false;
  const parent = await inspectPathMetadata(dirname(path));
  if (
    !parent.exists ||
    parent.kind !== "directory" ||
    parent.uid !== alias.uid ||
    parent.uid === expectedOwner ||
    (parent.mode & 0o022) !== 0
  ) return false;

  try {
    const handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_DIRECTORY);
    try {
      return (await handle.stat()).isDirectory();
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

async function requestedRootBoundary(
  dataRoot: string,
  uid: number | null
): Promise<"root_symlink" | "root_invalid" | null> {
  let expectedOwner = uid;
  let current = dirname(dataRoot);
  while (true) {
    const inspected = await inspectPathMetadata(current);
    if (inspected.exists) {
      if (inspected.kind === "symlink") {
        if (
          expectedOwner !== null &&
          await isTrustedAncestorAlias(current, inspected, expectedOwner)
        ) break;
        return "root_symlink";
      }
      if (inspected.kind !== "directory") return "root_invalid";
      if (expectedOwner === null) expectedOwner = inspected.uid;
      else if (inspected.uid !== expectedOwner) {
        if ((inspected.mode & 0o022) !== 0) return "root_invalid";
        break;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const root = await inspectPathMetadata(dataRoot);
  return root.exists && root.kind === "symlink" ? "root_symlink" : null;
}

function rootBoundaryChecks(
  dataRootCode: "root_symlink" | "root_invalid"
): readonly DoctorCheck[] {
  return Object.freeze([
    doctorCheck("data_root", "fail", dataRootCode),
    doctorCheck("sensitive_paths", "fail", "root_invalid"),
    doctorCheck("redaction_key", "fail", "root_invalid"),
    doctorCheck("sqlite", "fail", "root_invalid")
  ]);
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
      const child = await inspectPathMetadata(childPath);
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
  const [secretsOutcome, artifactsOutcome, databaseOutcome, walOutcome, shmOutcome] =
    await Promise.all([
      pathInspectionOutcome(paths.secrets),
      pathInspectionOutcome(paths.artifacts),
      pathInspectionOutcome(paths.database, true),
      pathInspectionOutcome(paths.wal, true),
      pathInspectionOutcome(paths.shm, true)
    ]);
  const secrets = secretsOutcome.ok ? secretsOutcome.path : missingPath;
  const artifacts = artifactsOutcome.ok ? artifactsOutcome.path : missingPath;
  const database = databaseOutcome.ok ? databaseOutcome.path : missingPath;
  const wal = walOutcome.ok ? walOutcome.path : missingPath;
  const shm = shmOutcome.ok ? shmOutcome.path : missingPath;
  const keyOutcome = secretsOutcome.ok && secrets.exists && secrets.kind === "directory"
    ? await pathInspectionOutcome(paths.key, true)
    : secretsOutcome.ok
      ? Object.freeze({ ok: true as const, path: missingPath })
      : Object.freeze({ ok: false as const });
  const [temporaryArtifactsOutcome, finalArtifactsOutcome] =
    artifactsOutcome.ok && artifacts.exists && artifacts.kind === "directory"
      ? await Promise.all([
          pathInspectionOutcome(paths.temporaryArtifacts),
          pathInspectionOutcome(paths.finalArtifacts)
        ])
      : artifactsOutcome.ok
        ? [
            Object.freeze({ ok: true as const, path: missingPath }),
            Object.freeze({ ok: true as const, path: missingPath })
          ]
        : [Object.freeze({ ok: false as const }), Object.freeze({ ok: false as const })];
  const key = keyOutcome.ok ? keyOutcome.path : missingPath;
  const temporaryArtifacts = temporaryArtifactsOutcome.ok
    ? temporaryArtifactsOutcome.path
    : missingPath;
  const finalArtifacts = finalArtifactsOutcome.ok ? finalArtifactsOutcome.path : missingPath;
  const inspected = {
    secrets,
    key,
    artifacts,
    temporaryArtifacts,
    finalArtifacts,
    database,
    wal,
    shm
  };
  const outcomes = {
    secrets: secretsOutcome,
    key: keyOutcome,
    artifacts: artifactsOutcome,
    temporaryArtifacts: temporaryArtifactsOutcome,
    finalArtifacts: finalArtifactsOutcome,
    database: databaseOutcome,
    wal: walOutcome,
    shm: shmOutcome
  };

  const initialized = Object.values(inspected).some(({ exists }) => exists) ||
    Object.values(outcomes).some((outcome) => !outcome.ok);
  const counters = { directories: 0, files: 0, entries: 0 };
  let sensitiveFailure: string | null = rootPermission;
  if (!sensitiveFailure) {
    const expectedPaths: readonly [PathInspectionOutcome, InspectedPath, "directory" | "file", boolean][] = [
      [outcomes.secrets, inspected.secrets, "directory", false],
      [outcomes.key, inspected.key, "file", true],
      [outcomes.artifacts, inspected.artifacts, "directory", false],
      [outcomes.temporaryArtifacts, inspected.temporaryArtifacts, "directory", false],
      [outcomes.finalArtifacts, inspected.finalArtifacts, "directory", false],
      [outcomes.database, inspected.database, "file", false],
      [outcomes.wal, inspected.wal, "file", false],
      [outcomes.shm, inspected.shm, "file", false]
    ];
    for (const [outcome, candidate, expected, ownerOnly] of expectedPaths) {
      if (!outcome.ok) {
        sensitiveFailure = "path_inspection_failed";
        break;
      }
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
  if (!secretsOutcome.ok) {
    keyCheck = doctorCheck("redaction_key", "fail", "key_parent_invalid");
  } else if (inspected.secrets.exists && inspected.secrets.kind !== "directory") {
    keyCheck = doctorCheck("redaction_key", "fail", "key_parent_invalid");
  } else if (!keyOutcome.ok) {
    keyCheck = doctorCheck("redaction_key", "fail", "path_inspection_failed");
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
  if (!walOutcome.ok) {
    sqliteCheck = doctorCheck("sqlite", "fail", "path_inspection_failed");
  } else if (wal.exists && wal.kind === "symlink") {
    sqliteCheck = doctorCheck("sqlite", "fail", "sidecar_symlink");
  } else if (wal.exists && wal.kind !== "file") {
    sqliteCheck = doctorCheck("sqlite", "fail", "sidecar_non_regular");
  } else if (wal.exists) {
    sqliteCheck = doctorCheck("sqlite", "fail", "wal_present");
  } else if (!shmOutcome.ok || !databaseOutcome.ok) {
    sqliteCheck = doctorCheck("sqlite", "fail", "path_inspection_failed");
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
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
  } catch {
    return null;
  }
  for (const token of decoded.split(/\s+/u)) {
    if (Buffer.byteLength(token, "utf8") <= 128 && semanticVersionPattern.test(token)) return token;
  }
  return null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function systemCodexVersion(environment?: NodeJS.ProcessEnv): Promise<CodexVersionProbe> {
  return await new Promise<CodexVersionProbe>((resolveProbe) => {
    const usesProcessGroup = process.platform !== "win32";
    const child = spawn("codex", ["--version"], {
      env: environment ?? process.env,
      shell: false,
      detached: usesProcessGroup,
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end();
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    let forcedState: "timeout" | "overflow" | undefined;
    let spawnError: unknown;
    let settled = false;
    let destroyPipesRequested = false;
    let cleanup: Promise<void> | undefined;

    const childIsOpen = (): boolean =>
      child.pid !== undefined && child.exitCode === null && child.signalCode === null;
    const ownedProcessGroupExists = (): boolean => {
      if (!usesProcessGroup || child.pid === undefined) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        return errnoCode(error) !== "ESRCH";
      }
    };
    const signalOwnedProcessGroup = (signal: NodeJS.Signals): void => {
      if (usesProcessGroup && child.pid !== undefined && ownedProcessGroupExists()) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child when group signaling is unavailable.
        }
      }
      if (childIsOpen()) child.kill(signal);
    };
    const destroyOwnedPipes = (): void => {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const beginCleanup = (destroyPipes: boolean): Promise<void> => {
      destroyPipesRequested ||= destroyPipes;
      cleanup ??= (async () => {
        if (usesProcessGroup && child.pid !== undefined) {
          if (ownedProcessGroupExists()) {
            signalOwnedProcessGroup("SIGTERM");
            await wait(250);
            if (ownedProcessGroupExists()) signalOwnedProcessGroup("SIGKILL");
            const confirmationDeadline = Date.now() + 250;
            while (ownedProcessGroupExists() && Date.now() < confirmationDeadline) {
              await wait(10);
            }
          }
        } else if (childIsOpen()) {
          child.kill("SIGTERM");
          await wait(250);
          if (childIsOpen()) child.kill("SIGKILL");
        }
        if (destroyPipesRequested) destroyOwnedPipes();
      })();
      return cleanup.then(() => {
        if (destroyPipesRequested) destroyOwnedPipes();
      });
    };
    const settle = (probe: CodexVersionProbe): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveProbe(probe);
    };
    const force = (state: "timeout" | "overflow"): void => {
      forcedState ??= state;
      void beginCleanup(true).then(() => {
        settle({ state: forcedState!, signal: signalNumber(child.signalCode) });
      });
    };
    const timeout = setTimeout(() => force("timeout"), codexTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= codexOutputLimit) stdout.push(Buffer.from(chunk));
      else force("overflow");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > codexOutputLimit) force("overflow");
    });
    child.once("error", (error) => { spawnError = error; });
    child.once("exit", () => {
      if (usesProcessGroup) void beginCleanup(false);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (forcedState) return;
      let probe: CodexVersionProbe;
      if (spawnError) {
        probe = errnoCode(spawnError) === "ENOENT"
          ? { state: "missing" }
          : { state: "spawn_failed" };
      } else if (exitCode !== 0) {
        probe = { state: "nonzero", exitCode, signal: signalNumber(signal) };
      } else {
        const version = semanticVersion(Buffer.concat(stdout));
        probe = version === null ? { state: "invalid" } : { state: "available", version };
      }
      void beginCleanup(false).then(() => settle(probe));
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
    const boundaryCode = await requestedRootBoundary(dataRoot, currentUid(dependencies));
    storage = boundaryCode === null
      ? normalizedStorageChecks(await (
          dependencies.storageChecks ?? ((root) => inspectStorageChecks(root, dependencies))
        )(dataRoot))
      : rootBoundaryChecks(boundaryCode);
  } catch {
    storage = rootBoundaryChecks("root_invalid");
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
