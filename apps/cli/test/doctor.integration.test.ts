import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  openDatabase,
  ReadOnlyDatabaseError,
  type DatabaseInspection
} from "@agentlens/storage";
import {
  diagnoseDoctor,
  type DoctorCheck,
  type DoctorDependencies
} from "../src/doctor.js";
import { runDoctorCommand } from "../src/commands/doctor.js";

const execFile = promisify(execFileCallback);
const Database = createRequire(
  new URL("../../../packages/storage/package.json", import.meta.url)
)("better-sqlite3") as typeof import("better-sqlite3").default;
const temporaryRoots: string[] = [];

interface SnapshotEntry {
  readonly path: string;
  readonly kind: "directory" | "file" | "symlink" | "other";
  readonly mode: string;
  readonly uid: string;
  readonly gid: string;
  readonly size: string;
  readonly mtimeNs: string;
  readonly inode: string;
  readonly sha256?: string;
  readonly target?: string;
}

async function snapshot(path: string): Promise<readonly SnapshotEntry[] | null> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const entries: SnapshotEntry[] = [];
  const visit = async (current: string): Promise<void> => {
    const stats = await lstat(current, { bigint: true });
    const kind = stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : stats.isSymbolicLink()
          ? "symlink"
          : "other";
    entries.push({
      path: relative(path, current) || ".",
      kind,
      mode: stats.mode.toString(),
      uid: stats.uid.toString(),
      gid: stats.gid.toString(),
      size: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      inode: stats.ino.toString(),
      ...(kind === "file"
        ? { sha256: createHash("sha256").update(await readFile(current)).digest("hex") }
        : {}),
      ...(kind === "symlink" ? { target: await readlink(current) } : {})
    });
    if (kind === "directory") {
      for (const name of (await readdir(current)).sort()) await visit(join(current, name));
    }
  };
  await visit(path);
  return entries;
}

async function fixture(): Promise<Readonly<{ root: string; dataRoot: string }>> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-doctor-"));
  temporaryRoots.push(root);
  return { root, dataRoot: join(root, "data") };
}

function nonStorageDependencies(
  overrides: Partial<DoctorDependencies> = {}
): DoctorDependencies {
  return {
    codexVersion: async () => ({ state: "available", version: "1.2.3" }),
    processGroups: async () => ({ state: "posix" }),
    loopbackBind: async () => ({ close: async () => {} }),
    ...overrides
  };
}

function named(result: Awaited<ReturnType<typeof diagnoseDoctor>>, id: string): DoctorCheck {
  const value = result.checks.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`missing doctor check ${id}`);
  return value;
}

async function initializeCurrent(dataRoot: string): Promise<string> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(dataRoot, "agentlens.sqlite");
  const database = openDatabase(databasePath);
  database.close();
  await chmod(dataRoot, 0o700);
  await chmod(databasePath, 0o600);
  await mkdir(join(dataRoot, "secrets"), { mode: 0o700 });
  await writeFile(join(dataRoot, "secrets", "redaction-hmac.key"), "KEY_BYTES_MUST_NOT_BE_READ", {
    mode: 0o600
  });
  return databasePath;
}

async function initializeArtifactTrees(dataRoot: string): Promise<void> {
  await mkdir(join(dataRoot, "artifacts", "tmp"), { recursive: true, mode: 0o700 });
  await mkdir(join(dataRoot, "artifacts", "sha256", "ab"), { recursive: true, mode: 0o700 });
  for (const path of [
    join(dataRoot, "artifacts"),
    join(dataRoot, "artifacts", "tmp"),
    join(dataRoot, "artifacts", "sha256"),
    join(dataRoot, "artifacts", "sha256", "ab")
  ]) await chmod(path, 0o700);
}

async function createDatabaseThrough(dataRoot: string, version: number): Promise<string> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const path = join(dataRoot, "agentlens.sqlite");
  const connection = new Database(path);
  try {
    connection.pragma("foreign_keys = ON");
    const names = ["initial", "storage_invariants", "recorder_ownership", "task6_evaluation"];
    for (let current = 1; current <= version; current += 1) {
      connection.exec(await readFile(
        new URL(`../../../packages/storage/migrations/00${current}_${names[current - 1]}.sql`, import.meta.url),
        "utf8"
      ));
      connection.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(current, 1_777_777_777_000 + current);
    }
  } finally {
    connection.close();
  }
  await chmod(path, 0o600);
  await mkdir(join(dataRoot, "secrets"), { mode: 0o700 });
  await writeFile(join(dataRoot, "secrets", "redaction-hmac.key"), "LEGACY_KEY_SENTINEL", {
    mode: 0o600
  });
  return path;
}

function currentInspection(overrides: Partial<DatabaseInspection> = {}): DatabaseInspection {
  return {
    tables: [
      "artifacts", "current_assessments", "derivation_identities",
      "event_artifact_bindings", "event_relationships", "event_sources", "events",
      "git_evidence", "redaction_audits", "run_ownership", "runs", "schema_migrations"
    ],
    indexes: [
      "idx_artifacts_run_id", "idx_derivation_identities_run_source",
      "idx_event_artifact_bindings_run_artifact", "idx_event_artifact_bindings_run_event",
      "idx_event_relationships_one_recovery", "idx_event_relationships_related_event_id",
      "idx_event_sources_run_item_id", "idx_event_sources_run_turn_id",
      "idx_events_id_run_id", "idx_events_run_sequence", "idx_run_ownership_condition",
      "idx_runs_started_at"
    ],
    migrations: [1, 2, 3, 4],
    foreignKeys: true,
    queryOnly: true,
    journalMode: "delete",
    synchronous: 2,
    busyTimeout: 0,
    integrity: "ok",
    quickCheck: ["ok"],
    foreignKeyCheck: [],
    ...overrides
  };
}

function writer() {
  let text = "";
  return {
    output: { write: (chunk: string | Uint8Array) => { text += String(chunk); return true; } },
    text: () => text
  };
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  await chmod(path, 0o700);
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!processIsGone(pid) && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  expect(processIsGone(pid)).toBe(true);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("doctor storage inspection", () => {
  it("distinguishes absent, empty, partial, and current data roots without initializing them", async () => {
    const absent = await fixture();
    const absentBefore = await snapshot(absent.dataRoot);
    const absentResult = await diagnoseDoctor(absent.dataRoot, nonStorageDependencies());
    expect(absentResult.checks.slice(0, 4).map(({ status, metadata }) => [status, metadata.code]))
      .toEqual([
        ["warn", "not_initialized"],
        ["warn", "not_initialized"],
        ["warn", "not_initialized"],
        ["warn", "not_initialized"]
      ]);
    expect(await snapshot(absent.dataRoot)).toEqual(absentBefore);

    const empty = await fixture();
    await mkdir(empty.dataRoot, { mode: 0o700 });
    const emptyBefore = await snapshot(empty.dataRoot);
    const emptyResult = await diagnoseDoctor(empty.dataRoot, nonStorageDependencies());
    expect(named(emptyResult, "data_root")).toMatchObject({ status: "pass", metadata: { code: "ok" } });
    expect(named(emptyResult, "sensitive_paths")).toMatchObject({ status: "pass", metadata: { code: "ok" } });
    expect(named(emptyResult, "redaction_key")).toMatchObject({ status: "warn", metadata: { code: "not_initialized" } });
    expect(named(emptyResult, "sqlite")).toMatchObject({ status: "warn", metadata: { code: "not_initialized" } });
    expect(await snapshot(empty.dataRoot)).toEqual(emptyBefore);

    const partial = await fixture();
    await mkdir(join(partial.dataRoot, "artifacts"), { recursive: true, mode: 0o700 });
    await chmod(partial.dataRoot, 0o700);
    const partialBefore = await snapshot(partial.dataRoot);
    const partialResult = await diagnoseDoctor(partial.dataRoot, nonStorageDependencies());
    expect(named(partialResult, "redaction_key")).toMatchObject({ status: "warn", metadata: { code: "not_initialized" } });
    expect(named(partialResult, "sqlite")).toMatchObject({ status: "fail", metadata: { code: "database_missing" } });
    expect(await snapshot(partial.dataRoot)).toEqual(partialBefore);

    const current = await fixture();
    await initializeCurrent(current.dataRoot);
    const currentBefore = await snapshot(current.dataRoot);
    const currentResult = await diagnoseDoctor(current.dataRoot, nonStorageDependencies());
    expect(currentResult.checks.slice(0, 4).map(({ status, metadata }) => [status, metadata.code]))
      .toEqual([
        ["pass", "ok"],
        ["pass", "ok"],
        ["pass", "ok"],
        ["pass", "ok"]
      ]);
    expect(await snapshot(current.dataRoot)).toEqual(currentBefore);
  });

  it("fails an orphan regular WAL before considering a missing main database", async () => {
    const context = await fixture();
    await mkdir(context.dataRoot, { mode: 0o700 });
    await writeFile(join(context.dataRoot, "agentlens.sqlite-wal"), "ORPHAN_WAL_SENTINEL", {
      mode: 0o600
    });
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "wal_present" }
    });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("classifies an unreadable exact regular WAL before unrelated storage checks", async () => {
    const context = await fixture();
    await mkdir(context.dataRoot, { mode: 0o700 });
    const walPath = join(context.dataRoot, "agentlens.sqlite-wal");
    await writeFile(walPath, "UNREADABLE_WAL_SENTINEL", { mode: 0o600 });
    await chmod(walPath, 0o000);
    const before = await lstat(walPath, { bigint: true });

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "wal_present" }
    });
    expect(named(result, "redaction_key")).toMatchObject({
      status: "warn",
      metadata: { code: "not_initialized" }
    });
    expect(JSON.stringify(result)).not.toContain("UNREADABLE_WAL_SENTINEL");
    expect(await lstat(walPath, { bigint: true })).toMatchObject({
      mode: before.mode,
      uid: before.uid,
      gid: before.gid,
      size: before.size,
      mtimeNs: before.mtimeNs,
      ino: before.ino
    });
  });

  it.each([
    ["SHM sidecar", "agentlens.sqlite-shm", "UNREADABLE_SHM_SENTINEL"],
    ["redaction key", "secrets/redaction-hmac.key", "UNREADABLE_KEY_SENTINEL"]
  ] as const)("retains mandatory WAL precedence when an unreadable %s is also present", async (
    _name,
    relativePath,
    sentinel
  ) => {
    const context = await fixture();
    await mkdir(context.dataRoot, { mode: 0o700 });
    await writeFile(join(context.dataRoot, "agentlens.sqlite-wal"), "WAL_PRECEDENCE_SENTINEL", {
      mode: 0o600
    });
    const siblingPath = join(context.dataRoot, relativePath);
    await mkdir(dirname(siblingPath), { recursive: true, mode: 0o700 });
    await writeFile(siblingPath, sentinel, { mode: 0o600 });
    await chmod(siblingPath, 0o000);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "wal_present" }
    });
    expect(JSON.stringify(result)).not.toContain("WAL_PRECEDENCE_SENTINEL");
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it.each([
    ["secrets", async (dataRoot: string) => mkdir(join(dataRoot, "secrets"), { mode: 0o700 })],
    ["redaction key", async (dataRoot: string) => {
      await mkdir(join(dataRoot, "secrets"), { mode: 0o700 });
      await writeFile(join(dataRoot, "secrets", "redaction-hmac.key"), "PARTIAL_KEY", { mode: 0o600 });
    }],
    ["artifacts", async (dataRoot: string) => mkdir(join(dataRoot, "artifacts"), { mode: 0o700 })],
    ["SHM sidecar", async (dataRoot: string) => writeFile(
      join(dataRoot, "agentlens.sqlite-shm"),
      "PARTIAL_SHM",
      { mode: 0o600 }
    )]
  ] as const)("treats a %s-only root as partial rather than empty", async (_name, setup) => {
    const context = await fixture();
    await mkdir(context.dataRoot, { mode: 0o700 });
    await setup(context.dataRoot);
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "database_missing" }
    });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it.each([
    ["data root", ".", "data_root"],
    ["secrets directory", "secrets", "sensitive_paths"],
    ["artifacts directory", "artifacts", "sensitive_paths"],
    ["temporary-artifact directory", "artifacts/tmp", "sensitive_paths"],
    ["hash-tree directory", "artifacts/sha256", "sensitive_paths"],
    ["two-character hash bucket", "artifacts/sha256/ab", "sensitive_paths"]
  ] as const)("fails permissive mode on the %s", async (_name, relativePath, checkId) => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    await initializeArtifactTrees(context.dataRoot);
    const target = relativePath === "." ? context.dataRoot : join(context.dataRoot, relativePath);
    await chmod(target, 0o755);
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, checkId)).toMatchObject({ status: "fail", metadata: { code: "permissions" } });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it.each([
    ["redaction key", "secrets/redaction-hmac.key", "KEY_WORLD_READABLE_SENTINEL"],
    ["orphan temporary artifact", "artifacts/tmp/orphan.tmp", "TEMP_WORLD_READABLE_SENTINEL"],
    ["orphan final artifact", "artifacts/sha256/ab/orphan.json", "FINAL_WORLD_READABLE_SENTINEL"],
    ["database", "agentlens.sqlite", null],
    ["SHM sidecar", "agentlens.sqlite-shm", "SHM_WORLD_READABLE_SENTINEL"]
  ] as const)("fails a world-readable %s without reading its bytes", async (
    _name,
    relativePath,
    sentinel
  ) => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    await initializeArtifactTrees(context.dataRoot);
    const target = join(context.dataRoot, relativePath);
    if (sentinel !== null) await writeFile(target, sentinel, { mode: 0o644 });
    await chmod(target, 0o644);
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());
    const serialized = JSON.stringify(result);

    expect(named(result, "sensitive_paths")).toMatchObject({
      status: "fail",
      metadata: { code: "permissions" }
    });
    if (relativePath.includes("redaction")) {
      expect(named(result, "redaction_key")).toMatchObject({
        status: "fail",
        metadata: { code: "key_permissions" }
      });
    }
    if (sentinel !== null) expect(serialized).not.toContain(sentinel);
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("fails same-owner checks and warns rather than claiming pass when POSIX metadata is unavailable", async () => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    await initializeArtifactTrees(context.dataRoot);
    const actualUid = process.getuid?.() ?? 0;

    const wrongOwner = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      currentUid: () => actualUid + 1
    }));
    expect(named(wrongOwner, "data_root")).toMatchObject({ status: "fail", metadata: { code: "wrong_owner" } });
    expect(named(wrongOwner, "sensitive_paths")).toMatchObject({ status: "fail", metadata: { code: "wrong_owner" } });
    expect(named(wrongOwner, "redaction_key")).toMatchObject({ status: "fail", metadata: { code: "key_wrong_owner" } });

    const unsupported = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      currentUid: () => null
    }));
    expect(unsupported.checks.slice(0, 3).map(({ status, metadata }) => [status, metadata.code]))
      .toEqual([
        ["warn", "platform_unsupported"],
        ["warn", "platform_unsupported"],
        ["warn", "platform_unsupported"]
      ]);
  });

  it.each([
    ["redaction key", "secrets/redaction-hmac.key", "key_symlink"],
    ["database", "agentlens.sqlite", "database_symlink"],
    ["WAL sidecar", "agentlens.sqlite-wal", "sidecar_symlink"],
    ["SHM sidecar", "agentlens.sqlite-shm", "sidecar_symlink"],
    ["temporary artifact", "artifacts/tmp/link", "path_symlink"],
    ["hash bucket", "artifacts/sha256/ab", "path_symlink"]
  ] as const)("refuses a symlinked %s without following its external target", async (
    _name,
    relativePath,
    code
  ) => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    await initializeArtifactTrees(context.dataRoot);
    const target = join(context.dataRoot, relativePath);
    const outside = join(context.root, "OUTSIDE_SYMLINK_TARGET");
    await writeFile(outside, "EXTERNAL_TARGET_CONTENT_SENTINEL", { mode: 0o644 });
    await rm(target, { recursive: true, force: true });
    await symlink(outside, target);
    const beforeRoot = await snapshot(context.dataRoot);
    const beforeOutside = await snapshot(outside);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    const relevant = relativePath === "secrets/redaction-hmac.key"
      ? named(result, "redaction_key")
      : relativePath.startsWith("agentlens.sqlite")
        ? named(result, "sqlite")
        : named(result, "sensitive_paths");
    expect(relevant).toMatchObject({ status: "fail", metadata: { code } });
    expect(JSON.stringify(result)).not.toContain("OUTSIDE_SYMLINK_TARGET");
    expect(JSON.stringify(result)).not.toContain("EXTERNAL_TARGET_CONTENT_SENTINEL");
    expect(await snapshot(context.dataRoot)).toEqual(beforeRoot);
    expect(await snapshot(outside)).toEqual(beforeOutside);
  });

  it("refuses a symlinked root without following or changing the external tree", async () => {
    const context = await fixture();
    const outside = join(context.root, "external-root");
    await mkdir(outside, { mode: 0o755 });
    await writeFile(join(outside, "sentinel.txt"), "EXTERNAL_ROOT_SENTINEL", { mode: 0o644 });
    await symlink(outside, context.dataRoot);
    const beforeLink = await snapshot(context.dataRoot);
    const beforeOutside = await snapshot(outside);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "data_root")).toMatchObject({ status: "fail", metadata: { code: "root_symlink" } });
    expect(JSON.stringify(result)).not.toContain("EXTERNAL_ROOT_SENTINEL");
    expect(await snapshot(context.dataRoot)).toEqual(beforeLink);
    expect(await snapshot(outside)).toEqual(beforeOutside);
  });

  it("refuses a symlink in the requested data-root parent path without following it", async () => {
    const context = await fixture();
    const externalParent = join(context.root, "external-parent");
    const externalDataRoot = join(externalParent, "data");
    const linkedParent = join(context.root, "linked-parent");
    await initializeCurrent(externalDataRoot);
    await symlink(externalParent, linkedParent);
    const requestedDataRoot = join(linkedParent, "data");
    const beforeLink = await snapshot(linkedParent);
    const beforeOutside = await snapshot(externalParent);

    const result = await diagnoseDoctor(requestedDataRoot, nonStorageDependencies());

    expect(named(result, "data_root")).toMatchObject({
      status: "fail",
      metadata: { code: "root_symlink" }
    });
    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "root_invalid" }
    });
    expect(await snapshot(linkedParent)).toEqual(beforeLink);
    expect(await snapshot(externalParent)).toEqual(beforeOutside);
  });

  it("classifies a parent symlink before inspecting its inaccessible target", async () => {
    const context = await fixture();
    const externalParent = join(context.root, "inaccessible-external-parent");
    const linkedParent = join(context.root, "linked-inaccessible-parent");
    await mkdir(externalParent, { mode: 0o700 });
    await chmod(externalParent, 0o000);
    await symlink(externalParent, linkedParent);
    const before = await lstat(externalParent, { bigint: true });

    const result = await diagnoseDoctor(
      join(linkedParent, "data"),
      nonStorageDependencies()
    );

    expect(named(result, "data_root")).toMatchObject({
      status: "fail",
      metadata: { code: "root_symlink" }
    });
    expect(await lstat(externalParent, { bigint: true })).toMatchObject({
      mode: before.mode,
      uid: before.uid,
      gid: before.gid,
      size: before.size,
      mtimeNs: before.mtimeNs,
      ino: before.ino
    });
  });

  it("refuses a requested-root parent symlink when uid inspection is unavailable", async () => {
    const context = await fixture();
    const externalParent = join(context.root, "uidless-external-parent");
    const externalDataRoot = join(externalParent, "data");
    const linkedParent = join(context.root, "uidless-linked-parent");
    await initializeCurrent(externalDataRoot);
    await symlink(externalParent, linkedParent);
    const beforeOutside = await snapshot(externalParent);

    const result = await diagnoseDoctor(join(linkedParent, "data"), nonStorageDependencies({
      currentUid: () => null
    }));

    expect(named(result, "data_root")).toMatchObject({
      status: "fail",
      metadata: { code: "root_symlink" }
    });
    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "root_invalid" }
    });
    expect(await snapshot(externalParent)).toEqual(beforeOutside);
  });

  it.each([
    ["non-directory", false, "root_invalid"],
    ["dangling symlink", true, "root_symlink"]
  ] as const)("validates a differently-owned %s ancestor before trusting its boundary", async (
    _name,
    makeSymlink,
    expectedCode
  ) => {
    const context = await fixture();
    const invalidParent = join(context.root, makeSymlink ? "dangling-parent" : "file-parent");
    if (makeSymlink) await symlink(join(context.root, "missing-target"), invalidParent);
    else await writeFile(invalidParent, "NON_DIRECTORY_PARENT_SENTINEL", { mode: 0o600 });
    const actualUid = process.getuid?.() ?? 0;

    const result = await diagnoseDoctor(join(invalidParent, "data"), nonStorageDependencies({
      currentUid: () => actualUid + 1
    }));

    expect(named(result, "data_root")).toMatchObject({
      status: "fail",
      metadata: { code: expectedCode }
    });
    expect(JSON.stringify(result)).not.toContain("NON_DIRECTORY_PARENT_SENTINEL");
  });

  it("refuses a differently-owned writable directory as a trusted ancestor", async () => {
    const context = await fixture();
    const writableParent = join(context.root, "differently-owned-writable-parent");
    await mkdir(writableParent, { mode: 0o770 });
    await chmod(writableParent, 0o770);
    const actualUid = process.getuid?.() ?? 0;

    const result = await diagnoseDoctor(join(writableParent, "data"), nonStorageDependencies({
      currentUid: () => actualUid + 1
    }));

    expect(named(result, "data_root")).toMatchObject({
      status: "fail",
      metadata: { code: "root_invalid" }
    });
  });

  it.each([
    ["secrets", "redaction_key", "key_parent_invalid"],
    ["artifacts", "sensitive_paths", "path_symlink"]
  ] as const)("does not resolve children through a self-referential %s symlink", async (
    directory,
    checkId,
    code
  ) => {
    const context = await fixture();
    await mkdir(context.dataRoot, { mode: 0o700 });
    await symlink(directory, join(context.dataRoot, directory));
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, checkId)).toMatchObject({ status: "fail", metadata: { code } });
    expect(named(result, "data_root")).toMatchObject({ status: "pass" });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("refuses a non-directory data root", async () => {
    const context = await fixture();
    await writeFile(context.dataRoot, "ROOT_NON_DIRECTORY_SENTINEL", { mode: 0o600 });
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "data_root")).toMatchObject({
      status: "fail",
      metadata: { code: "root_non_directory" }
    });
    expect(JSON.stringify(result)).not.toContain("ROOT_NON_DIRECTORY_SENTINEL");
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it.each([
    ["redaction key", "secrets/redaction-hmac.key", "redaction_key", "key_non_regular"],
    ["database", "agentlens.sqlite", "sqlite", "database_non_regular"],
    ["WAL sidecar", "agentlens.sqlite-wal", "sqlite", "sidecar_non_regular"],
    ["SHM sidecar", "agentlens.sqlite-shm", "sqlite", "sidecar_non_regular"]
  ] as const)("refuses a non-regular %s", async (_name, relativePath, checkId, code) => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    const target = join(context.dataRoot, relativePath);
    await rm(target, { force: true });
    await mkdir(target);
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, checkId)).toMatchObject({ status: "fail", metadata: { code } });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("refuses a non-regular artifact node without opening it", async () => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    await initializeArtifactTrees(context.dataRoot);
    const fifo = join(context.dataRoot, "artifacts", "tmp", "nonregular.fifo");
    await execFile("mkfifo", [fifo]);
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sensitive_paths")).toMatchObject({
      status: "fail",
      metadata: { code: "path_non_regular" }
    });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("fails bounded artifact traversal without exposing entry names", async () => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    await initializeArtifactTrees(context.dataRoot);
    for (let index = 0; index < 6; index += 1) {
      await writeFile(join(context.dataRoot, "artifacts", "tmp", `LIMIT_NAME_${index}`), "x", {
        mode: 0o600
      });
    }
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      inspectionLimit: 5
    }));

    expect(named(result, "sensitive_paths")).toMatchObject({
      status: "fail",
      metadata: { code: "inspection_limit" }
    });
    expect(JSON.stringify(result)).not.toContain("LIMIT_NAME_");
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("treats a present main database with no key as a key failure", async () => {
    const context = await fixture();
    const databasePath = await initializeCurrent(context.dataRoot);
    await rm(join(context.dataRoot, "secrets", "redaction-hmac.key"));
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "redaction_key")).toMatchObject({
      status: "fail",
      metadata: { code: "key_missing" }
    });
    expect(named(result, "sqlite")).toMatchObject({ status: "pass" });
    expect(await snapshot(databasePath)).not.toBeNull();
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });
});

describe("doctor SQLite inspection", () => {
  it("accepts exactly migrations 1-4 and rejects older, future, and malformed sets", async () => {
    const current = await fixture();
    await initializeCurrent(current.dataRoot);
    expect(named(
      await diagnoseDoctor(current.dataRoot, nonStorageDependencies()),
      "sqlite"
    )).toMatchObject({ status: "pass", metadata: { code: "ok", currentMigration: 4 } });

    const older = await fixture();
    await createDatabaseThrough(older.dataRoot, 3);
    expect(named(
      await diagnoseDoctor(older.dataRoot, nonStorageDependencies()),
      "sqlite"
    )).toMatchObject({ status: "fail", metadata: { code: "schema_older", currentMigration: 3 } });

    const future = await fixture();
    const futurePath = await initializeCurrent(future.dataRoot);
    const futureDb = new Database(futurePath);
    futureDb.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (5, 5)").run();
    futureDb.close();
    expect(named(
      await diagnoseDoctor(future.dataRoot, nonStorageDependencies()),
      "sqlite"
    )).toMatchObject({ status: "fail", metadata: { code: "schema_future", currentMigration: 5 } });

    const malformed = await fixture();
    const malformedPath = await initializeCurrent(malformed.dataRoot);
    const malformedDb = new Database(malformedPath);
    malformedDb.prepare("DELETE FROM schema_migrations WHERE version = 3").run();
    malformedDb.close();
    expect(named(
      await diagnoseDoctor(malformed.dataRoot, nonStorageDependencies()),
      "sqlite"
    )).toMatchObject({ status: "fail", metadata: { code: "schema_unsupported" } });
  });

  it.each([
    ["required table", "DROP TABLE current_assessments", "tables_missing"],
    ["required index", "DROP INDEX idx_runs_started_at", "indexes_missing"]
  ] as const)("fails a missing %s", async (_name, sql, code) => {
    const context = await fixture();
    const path = await initializeCurrent(context.dataRoot);
    const connection = new Database(path);
    connection.pragma("foreign_keys = OFF");
    connection.exec(sql);
    connection.close();
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({ status: "fail", metadata: { code } });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("fails foreign-key violations without exposing row contents", async () => {
    const context = await fixture();
    const path = await initializeCurrent(context.dataRoot);
    const connection = new Database(path);
    connection.pragma("foreign_keys = OFF");
    connection.prepare(`
      INSERT INTO artifacts (
        id, run_id, kind, media_type, path, sha256, byte_length, redaction_state,
        truncated, original_byte_length, created_at
      ) VALUES (?, ?, 'native-payload', 'application/json', ?, ?, 1, 'redacted', 0, 1, 1)
    `).run(
      "FK_ARTIFACT_SENTINEL",
      "FK_MISSING_RUN_SENTINEL",
      "/FK_PATH_SENTINEL",
      "a".repeat(64)
    );
    connection.close();
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "foreign_key_violation", violationCount: 1 }
    });
    expect(JSON.stringify(result)).not.toMatch(/FK_(ARTIFACT|MISSING|PATH)_SENTINEL/);
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it.each([
    ["foreign keys disabled", { foreignKeys: false }, "foreign_keys_disabled"],
    ["query-only disabled", { queryOnly: false }, "query_only_disabled"],
    ["quick check failure", { quickCheck: ["CORRUPT_QUICK_SENTINEL"] }, "quick_check_failed"],
    ["integrity failure", { integrity: "CORRUPT_INTEGRITY_SENTINEL" }, "integrity_failed"]
  ] as const)("maps %s to a bounded failure", async (_name, override, code) => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      databaseInspection: async () => currentInspection(override)
    }));

    expect(named(result, "sqlite")).toMatchObject({ status: "fail", metadata: { code } });
    expect(JSON.stringify(result)).not.toContain("CORRUPT_QUICK_SENTINEL");
    expect(JSON.stringify(result)).not.toContain("CORRUPT_INTEGRITY_SENTINEL");
  });

  it.each([
    [new ReadOnlyDatabaseError("immutable_unavailable"), "immutable_unavailable"],
    [new Error("RAW_SQLITE_OPEN_SENTINEL /secret/database"), "open_failed"]
  ])("maps immutable/open refusal to stable code %#", async (error, code) => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      databaseInspection: async () => { throw error; }
    }));

    expect(named(result, "sqlite")).toMatchObject({ status: "fail", metadata: { code } });
    expect(JSON.stringify(result)).not.toContain("RAW_SQLITE_OPEN_SENTINEL");
    expect(JSON.stringify(result)).not.toContain("/secret/database");
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("fails a database with no migration record and applies no migration", async () => {
    const context = await fixture();
    await mkdir(context.dataRoot, { mode: 0o700 });
    const path = join(context.dataRoot, "agentlens.sqlite");
    const connection = new Database(path);
    connection.exec("CREATE TABLE fixture_only (id INTEGER PRIMARY KEY)");
    connection.close();
    await chmod(path, 0o600);
    await mkdir(join(context.dataRoot, "secrets"), { mode: 0o700 });
    await writeFile(join(context.dataRoot, "secrets", "redaction-hmac.key"), "NO_MIGRATION_KEY", {
      mode: 0o600
    });
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "schema_unsupported", migrationCount: 0 }
    });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("maps corrupt SQLite bytes to a bounded code without changing storage", async () => {
    const context = await fixture();
    await mkdir(context.dataRoot, { mode: 0o700 });
    const path = join(context.dataRoot, "agentlens.sqlite");
    await writeFile(path, "RAW_CORRUPT_DATABASE_SENTINEL", { mode: 0o600 });
    await mkdir(join(context.dataRoot, "secrets"), { mode: 0o700 });
    await writeFile(join(context.dataRoot, "secrets", "redaction-hmac.key"), "CORRUPT_DB_KEY", {
      mode: 0o600
    });
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({
      status: "fail",
      metadata: { code: "corrupt" }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_CORRUPT_DATABASE_SENTINEL");
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("fails closed on WAL and preserves database, WAL, and SHM bytes and metadata", async () => {
    const context = await fixture();
    const path = await initializeCurrent(context.dataRoot);
    await writeFile(`${path}-wal`, "WAL_PRIVACY_SENTINEL", { mode: 0o600 });
    await writeFile(`${path}-shm`, "SHM_PRIVACY_SENTINEL", { mode: 0o600 });
    const before = await snapshot(context.dataRoot);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies());

    expect(named(result, "sqlite")).toMatchObject({ status: "fail", metadata: { code: "wal_present" } });
    expect(JSON.stringify(result)).not.toMatch(/(WAL|SHM)_PRIVACY_SENTINEL/);
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });
});

describe("doctor local readiness probes and privacy", () => {
  it("runs local basename codex with exact argv and reports only a parsed bounded version", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    const argvFile = join(context.root, "argv.json");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), `
      const { writeFileSync } = require("node:fs");
      writeFileSync(process.env.DOCTOR_ARGV_FILE, JSON.stringify(process.argv.slice(2)));
      process.stdout.write("codex-cli 12.34.56-alpha.1\\n");
    `);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: {
        ...process.env,
        PATH: bin,
        DOCTOR_ARGV_FILE: argvFile,
        RAW_ENV_SENTINEL: "RAW_ENV_SENTINEL"
      }
    }));

    expect(await readFile(argvFile, "utf8")).toBe('["--version"]');
    expect(named(result, "codex")).toEqual({
      id: "codex",
      status: "pass",
      summary: "Codex is available.",
      metadata: { code: "ok", version: "12.34.56-alpha.1" }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_ENV_SENTINEL");
  });

  it.each([
    ["missing executable", null, 0, "executable_missing"],
    ["nonzero exit", "process.stdout.write('RAW_STDOUT_SENTINEL'); process.stderr.write('RAW_STDERR_SENTINEL'); process.exit(7);", 7, "nonzero_exit"],
    ["invalid version", "process.stdout.write('RAW_INVALID_VERSION_SENTINEL');", 0, "version_invalid"]
  ] as const)("bounds Codex %s diagnostics", async (_name, body, exitCode, code) => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    await mkdir(bin);
    if (body !== null) await writeExecutable(join(bin, "codex"), body);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: { ...process.env, PATH: bin }
    }));

    expect(named(result, "codex")).toMatchObject({ status: "fail", metadata: { code } });
    if (exitCode !== 0) expect(named(result, "codex").metadata.exitCode).toBe(exitCode);
    expect(JSON.stringify(result)).not.toMatch(/RAW_(STDOUT|STDERR|INVALID)_/);
  });

  it("rejects invalid UTF-8 even when later stdout bytes contain a semantic version", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), `
      process.stdout.write(Buffer.from([0xff, 0x20, 0x31, 0x2e, 0x32, 0x2e, 0x33, 0x0a]));
    `);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: { ...process.env, PATH: bin }
    }));

    expect(named(result, "codex")).toMatchObject({
      status: "fail",
      metadata: { code: "version_invalid" }
    });
  });

  it("maps an inaccessible local Codex executable to spawn_failed", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "codex"), "RAW_INACCESSIBLE_CODEX_SENTINEL", { mode: 0o600 });

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: { ...process.env, PATH: bin }
    }));

    expect(named(result, "codex")).toMatchObject({
      status: "fail",
      metadata: { code: "spawn_failed" }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_INACCESSIBLE_CODEX_SENTINEL");
  });

  it.each([
    ["timeout", `
      const { writeFileSync } = require("node:fs");
      writeFileSync(process.env.DOCTOR_PID_FILE, String(process.pid));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `, "timeout"],
    ["overflow", `
      const { writeFileSync } = require("node:fs");
      writeFileSync(process.env.DOCTOR_PID_FILE, String(process.pid));
      process.stdout.write("OVERFLOW_RAW_SENTINEL" + "x".repeat(9000));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `, "output_overflow"]
    ,
    ["stderr overflow", `
      const { writeFileSync } = require("node:fs");
      writeFileSync(process.env.DOCTOR_PID_FILE, String(process.pid));
      process.stderr.write("STDERR_OVERFLOW_RAW_SENTINEL" + "x".repeat(9000));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `, "output_overflow"]
  ] as const)("terminates and awaits Codex cleanup on %s", async (_name, body, code) => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    const pidFile = join(context.root, "pid");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), body);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: {
        ...process.env,
        PATH: bin,
        DOCTOR_PID_FILE: pidFile
      }
    }));
    const pid = Number(await readFile(pidFile, "utf8"));

    expect(named(result, "codex")).toMatchObject({ status: "fail", metadata: { code } });
    expect(JSON.stringify(result)).not.toContain("OVERFLOW_RAW_SENTINEL");
    await waitForProcessExit(pid);
  }, 10_000);

  it("bounds timeout cleanup for a Codex descendant that inherits stdio", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    const descendantPidFile = join(context.root, "descendant-pid");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", [
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);"
      ].join("")], { stdio: ["ignore", "inherit", "inherit"] });
      writeFileSync(process.env.DOCTOR_DESCENDANT_PID_FILE, String(descendant.pid));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `);

    const watchdog = setTimeout(async () => {
      try {
        const pid = Number(await readFile(descendantPidFile, "utf8"));
        process.kill(pid, "SIGKILL");
      } catch {
        // The fixed implementation should have already removed the descendant.
      }
    }, 4_500);
    const startedAt = Date.now();
    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: {
        ...process.env,
        PATH: bin,
        DOCTOR_DESCENDANT_PID_FILE: descendantPidFile
      }
    }));
    const elapsedMs = Date.now() - startedAt;
    const descendantPid = Number(await readFile(descendantPidFile, "utf8"));
    clearTimeout(watchdog);

    expect(named(result, "codex")).toMatchObject({
      status: "fail",
      metadata: { code: "timeout" }
    });
    expect(elapsedMs).toBeLessThan(4_000);
    await waitForProcessExit(descendantPid);
  }, 10_000);

  it("continues process-group escalation when the Codex leader exits first", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    const descendantPidFile = join(context.root, "leader-first-descendant-pid");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", [
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);"
      ].join("")], { stdio: "ignore" });
      writeFileSync(process.env.DOCTOR_DESCENDANT_PID_FILE, String(descendant.pid));
      process.on("SIGTERM", () => process.exit(0));
      setInterval(() => {}, 1000);
    `);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: {
        ...process.env,
        PATH: bin,
        DOCTOR_DESCENDANT_PID_FILE: descendantPidFile
      }
    }));
    const descendantPid = Number(await readFile(descendantPidFile, "utf8"));
    try {
      expect(named(result, "codex")).toMatchObject({
        status: "fail",
        metadata: { code: "timeout" }
      });
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 500));
      expect(processIsGone(descendantPid)).toBe(true);
    } finally {
      if (!processIsGone(descendantPid)) process.kill(descendantPid, "SIGKILL");
      await waitForProcessExit(descendantPid);
    }
  }, 10_000);

  it("cleans the owned process group after a nonzero Codex leader exits", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    const descendantPidFile = join(context.root, "nonzero-descendant-pid");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", [
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);"
      ].join("")], { stdio: "ignore" });
      writeFileSync(process.env.DOCTOR_DESCENDANT_PID_FILE, String(descendant.pid));
      process.exit(7);
    `);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: {
        ...process.env,
        PATH: bin,
        DOCTOR_DESCENDANT_PID_FILE: descendantPidFile
      }
    }));
    const descendantPid = Number(await readFile(descendantPidFile, "utf8"));
    try {
      expect(named(result, "codex")).toMatchObject({
        status: "fail",
        metadata: { code: "nonzero_exit", exitCode: 7 }
      });
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 500));
      expect(processIsGone(descendantPid)).toBe(true);
    } finally {
      if (!processIsGone(descendantPid)) process.kill(descendantPid, "SIGKILL");
      await waitForProcessExit(descendantPid);
    }
  }, 10_000);

  it("keeps the timeout bounded when a self-detached descendant inherits stdio", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    const descendantPidFile = join(context.root, "escaped-descendant-pid");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", [
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);"
      ].join("")], { detached: true, stdio: ["ignore", "inherit", "inherit"] });
      writeFileSync(process.env.DOCTOR_DESCENDANT_PID_FILE, String(descendant.pid));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `);

    const watchdog = setTimeout(async () => {
      try {
        const pid = Number(await readFile(descendantPidFile, "utf8"));
        process.kill(-pid, "SIGKILL");
      } catch {
        // The product is expected to return before this safety watchdog.
      }
    }, 4_500);
    const startedAt = Date.now();
    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: {
        ...process.env,
        PATH: bin,
        DOCTOR_DESCENDANT_PID_FILE: descendantPidFile
      }
    }));
    const elapsedMs = Date.now() - startedAt;
    const descendantPid = Number(await readFile(descendantPidFile, "utf8"));
    clearTimeout(watchdog);
    try {
      expect(named(result, "codex")).toMatchObject({
        status: "fail",
        metadata: { code: "timeout" }
      });
      expect(elapsedMs).toBeLessThan(4_000);
    } finally {
      try {
        process.kill(-descendantPid, "SIGKILL");
      } catch {
        // Already gone.
      }
      await waitForProcessExit(descendantPid);
    }
  }, 10_000);

  it.each([false, true])("uses exact loopback bind and leaves no listener after close failure=%s", async (
    closeFailure
  ) => {
    const context = await fixture();
    let selectedPort: number | undefined;
    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      loopbackBind: async (host, port) => {
        expect(host).toBe("127.0.0.1");
        expect(port).toBe(0);
        const server = createServer();
        await new Promise<void>((resolveListen, reject) => {
          server.once("error", reject);
          server.listen({ host, port }, () => resolveListen());
        });
        const address = server.address();
        if (typeof address === "object" && address) selectedPort = address.port;
        return {
          close: async () => {
            await new Promise<void>((resolveClose, reject) => {
              server.close((error) => error ? reject(error) : resolveClose());
            });
            if (closeFailure) throw new Error("CLOSE_AFTER_RELEASE_SENTINEL");
          }
        };
      }
    }));

    expect(named(result, "loopback")).toMatchObject({
      status: closeFailure ? "warn" : "pass",
      metadata: { code: closeFailure ? "close_failed" : "ok", host: "127.0.0.1" }
    });
    expect(selectedPort).toEqual(expect.any(Number));
    await expect(new Promise<void>((resolveConnect, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: selectedPort ?? 0 });
      socket.once("connect", () => { socket.destroy(); resolveConnect(); });
      socket.once("error", reject);
    })).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("keeps prompt/message/output/diff/native/note/key/artifact sentinels out of JSON, text, and new durable bytes", async () => {
    const context = await fixture();
    await initializeCurrent(context.dataRoot);
    await initializeArtifactTrees(context.dataRoot);
    const sentinels = [
      "DOCTOR_PROMPT_SENTINEL", "DOCTOR_MESSAGE_SENTINEL", "DOCTOR_OUTPUT_SENTINEL",
      "DOCTOR_DIFF_SENTINEL", "DOCTOR_NATIVE_SENTINEL", "DOCTOR_NOTE_SENTINEL",
      "DOCTOR_KEY_SENTINEL"
    ];
    await writeFile(join(context.dataRoot, "secrets", "redaction-hmac.key"), sentinels[6], {
      mode: 0o600
    });
    for (const [index, sentinel] of sentinels.slice(0, 6).entries()) {
      await writeFile(join(context.dataRoot, "artifacts", "tmp", `private-${index}`), sentinel, {
        mode: 0o600
      });
    }
    const before = await snapshot(context.dataRoot);
    const jsonOutput = writer();
    const textOutput = writer();
    const dependencies = nonStorageDependencies();

    await runDoctorCommand({ name: "doctor", dataRoot: context.dataRoot, json: true }, {
      ...dependencies,
      stdout: jsonOutput.output
    });
    await runDoctorCommand({ name: "doctor", dataRoot: context.dataRoot, json: false }, {
      ...dependencies,
      stdout: textOutput.output
    });

    for (const sentinel of sentinels) {
      expect(jsonOutput.text()).not.toContain(sentinel);
      expect(textOutput.text()).not.toContain(sentinel);
    }
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("does not execute Git while running the default local Codex probe", async () => {
    const context = await fixture();
    const bin = join(context.root, "bin");
    const gitMarker = join(context.root, "git-ran");
    await mkdir(bin);
    await writeExecutable(join(bin, "codex"), "process.stdout.write('codex-cli 1.2.3\\n');");
    await writeExecutable(join(bin, "git"), `
      const { writeFileSync } = require("node:fs");
      writeFileSync(${JSON.stringify(gitMarker)}, "GIT_EXECUTED_SENTINEL");
    `);

    const result = await diagnoseDoctor(context.dataRoot, nonStorageDependencies({
      codexVersion: undefined,
      codexEnvironment: { ...process.env, PATH: bin }
    }));

    expect(named(result, "codex")).toMatchObject({ status: "pass" });
    await expect(readFile(gitMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
