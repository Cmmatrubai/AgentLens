import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
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
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CapturePolicy } from "@agentlens/core";
import { openDatabase, RunRepository } from "@agentlens/storage";
import type { AssessCommand } from "../src/args.js";
import { runAssessCommand } from "../src/commands/assess.js";
import { main } from "../src/main.js";
import * as readOnlyDataRoot from "../src/readOnlyDataRoot.js";

interface RawStatement {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface RawDatabase {
  exec(source: string): void;
  prepare(source: string): RawStatement;
  close(): void;
}

const requireFromStorage = createRequire(
  fileURLToPath(new URL("../../../packages/storage/package.json", import.meta.url))
);
const SqliteDatabase = requireFromStorage("better-sqlite3") as new (
  filename: string
) => RawDatabase;
const roots: string[] = [];
const FIXED_TIME = Date.parse("2026-08-30T20:15:30.123Z");

interface Fixture {
  root: string;
  dataRoot: string;
  databasePath: string;
  runId: string;
}

interface MalformedDirectCommandCase {
  readonly label: string;
  readonly expectedError: RegExp;
  readonly build: (base: Record<string, unknown>) => unknown;
}

function withoutField(base: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...base };
  delete copy[field];
  return copy;
}

const malformedDirectCommands: readonly MalformedDirectCommandCase[] = [
  {
    label: "an undefined command",
    expectedError: /command.*object/i,
    build: () => undefined
  },
  {
    label: "a null command",
    expectedError: /command.*object/i,
    build: () => null
  },
  {
    label: "a missing name",
    expectedError: /command name.*assess/i,
    build: (base) => withoutField(base, "name")
  },
  {
    label: "an invalid name",
    expectedError: /command name.*assess/i,
    build: (base) => ({ ...base, name: "inspect" })
  },
  {
    label: "an undefined run ID",
    expectedError: /run ID.*non-empty string/i,
    build: (base) => ({ ...base, runId: undefined })
  },
  {
    label: "a non-string run ID",
    expectedError: /run ID.*non-empty string/i,
    build: (base) => ({ ...base, runId: Buffer.from("runtime-run-id") })
  },
  {
    label: "an empty run ID",
    expectedError: /run ID.*non-empty string/i,
    build: (base) => ({ ...base, runId: "" })
  },
  {
    label: "a missing verdict",
    expectedError: /verdict/i,
    build: (base) => withoutField(base, "verdict")
  },
  {
    label: "a non-string verdict",
    expectedError: /verdict/i,
    build: (base) => ({ ...base, verdict: Buffer.from("success") })
  },
  {
    label: "an unknown verdict",
    expectedError: /verdict/i,
    build: (base) => ({ ...base, verdict: "unknown" })
  },
  {
    label: "missing task completion",
    expectedError: /task-completed/i,
    build: (base) => withoutField(base, "taskCompleted")
  },
  {
    label: "non-string task completion",
    expectedError: /task-completed/i,
    build: (base) => ({ ...base, taskCompleted: Buffer.from("uncertain") })
  },
  {
    label: "unknown task completion",
    expectedError: /task-completed/i,
    build: (base) => ({ ...base, taskCompleted: "maybe" })
  },
  {
    label: "a Buffer note",
    expectedError: /note.*string/i,
    build: (base) => ({
      ...base,
      note: Buffer.from("Bearer DIRECT_CALL_BUFFER_NOTE_SENTINEL")
    })
  },
  {
    label: "a numeric note",
    expectedError: /note.*string/i,
    build: (base) => ({ ...base, note: 123 })
  },
  {
    label: "a null note",
    expectedError: /note.*string/i,
    build: (base) => ({ ...base, note: null })
  },
  {
    label: "a missing data root",
    expectedError: /data root.*non-empty string/i,
    build: (base) => withoutField(base, "dataRoot")
  },
  {
    label: "a non-string data root",
    expectedError: /data root.*non-empty string/i,
    build: (base) => ({ ...base, dataRoot: Buffer.from("runtime-data-root") })
  },
  {
    label: "an empty data root",
    expectedError: /data root.*non-empty string/i,
    build: (base) => ({ ...base, dataRoot: "" })
  },
  {
    label: "a missing JSON flag",
    expectedError: /json.*boolean/i,
    build: (base) => withoutField(base, "json")
  },
  {
    label: "a non-boolean JSON flag",
    expectedError: /json.*boolean/i,
    build: (base) => ({ ...base, json: "yes" })
  }
];

function validDirectCommand(dataRoot: string, runId: string): Record<string, unknown> {
  return {
    name: "assess",
    runId,
    verdict: "partial",
    taskCompleted: "uncertain",
    note: "",
    dataRoot,
    json: false
  };
}

async function directCall(command: unknown): Promise<unknown> {
  return runAssessCommand(command as AssessCommand, {
    stdout: { write: () => true }
  });
}

async function fixture(
  capturePolicy: CapturePolicy = "standard",
  runId = `assessment-run-${roots.length + 1}`
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-cli-assess-"));
  roots.push(root);
  const dataRoot = join(root, "data");
  const databasePath = join(dataRoot, "agentlens.sqlite");
  await mkdir(dataRoot, { mode: 0o700 });
  const database = openDatabase(databasePath);
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    });
    repository.createRun({
      id: runId,
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "fixture-agent",
      capturePolicy,
      capturePolicyVersion: "1",
      redactionVersion: "1",
      repositoryFingerprint: `fingerprint-${runId}`,
      repositoryDisplay: "fixture-repository",
      startedAt: FIXED_TIME - 10_000
    }, {
      recorderInstanceId: `recorder-${runId}`,
      recorderPid: 123,
      recorderStartToken: `start-${runId}`,
      heartbeatAt: FIXED_TIME - 10_000
    });
  } finally {
    database.close();
  }
  return { root, dataRoot, databasePath, runId };
}

async function invoke(argv: readonly string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write);
  try {
    return { exitCode: await main(argv), stdout, stderr };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

interface SnapshotEntry {
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  mode: string;
  uid: string;
  gid: string;
  size: string;
  mtimeNs: string;
  inode: string;
  sha256?: string;
  target?: string;
}

async function snapshot(path: string): Promise<SnapshotEntry[] | null> {
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
    const entry: SnapshotEntry = {
      path: relative(path, current) || ".",
      kind,
      mode: stats.mode.toString(),
      uid: stats.uid.toString(),
      gid: stats.gid.toString(),
      size: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      inode: stats.ino.toString()
    };
    if (kind === "file") {
      entry.sha256 = createHash("sha256").update(await readFile(current)).digest("hex");
    } else if (kind === "symlink") {
      entry.target = await readlink(current);
    }
    entries.push(entry);
    if (kind === "directory") {
      for (const child of (await readdir(current)).sort()) await visit(join(current, child));
    }
  };
  await visit(path);
  return entries;
}

async function regularFiles(path: string): Promise<string[]> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return [];
    if (stats.isFile()) return [path];
    if (!stats.isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all((await readdir(path)).map((entry) => regularFiles(join(path, entry))));
  return nested.flat().sort();
}

async function durableBytes(path: string): Promise<Buffer> {
  const files = await regularFiles(path);
  return Buffer.concat(await Promise.all(files.map((file) => readFile(file))));
}

function assessment(fixtureValue: Fixture) {
  const database = openDatabase(fixtureValue.databasePath);
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(fixtureValue.dataRoot, "artifacts", "sha256")
    });
    return {
      current: repository.getCurrentAssessment(fixtureValue.runId),
      detail: repository.getRunDetail(fixtureValue.runId)
    };
  } finally {
    database.close();
  }
}

function rawDatabase(path: string): RawDatabase {
  return new SqliteDatabase(path);
}

function downgradeToMigration003(path: string): void {
  const database = rawDatabase(path);
  try {
    database.exec(`
      DROP TABLE event_artifact_bindings;
      DROP TABLE current_assessments;
      DROP TABLE derivation_identities;
      DELETE FROM schema_migrations WHERE version = 4;
    `);
  } finally {
    database.close();
  }
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.sequential("assess command", () => {
  it("observes data-root lookup for a runtime-valid direct command", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-cli-assess-direct-valid-"));
    roots.push(root);
    const dataRoot = join(root, "missing-data");
    const locateSpy = vi.spyOn(readOnlyDataRoot, "locateReadOnlyDataRoot");

    const error = await directCall(validDirectCommand(dataRoot, "missing-run"))
      .then(() => null, (cause: unknown) => cause);

    expect(locateSpy).toHaveBeenCalledOnce();
    expect(locateSpy).toHaveBeenCalledWith(dataRoot);
    expect(await snapshot(dataRoot)).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/existing AgentLens data root/i);
  });

  it.each(malformedDirectCommands)(
    "rejects $label before touching a missing root",
    async ({ expectedError, build }) => {
      const root = await mkdtemp(join(tmpdir(), "agentlens-cli-assess-direct-missing-"));
      roots.push(root);
      const dataRoot = join(root, "missing-data");
      const command = build(validDirectCommand(dataRoot, "missing-run"));
      const locateSpy = vi.spyOn(readOnlyDataRoot, "locateReadOnlyDataRoot");

      const error = await directCall(command).then(() => null, (cause: unknown) => cause);

      expect(locateSpy).not.toHaveBeenCalled();
      expect(await snapshot(dataRoot)).toBeNull();
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(expectedError);
    }
  );

  it.each(malformedDirectCommands)(
    "rejects $label before changing a migration-003 root",
    async ({ expectedError, build }) => {
      const context = await fixture("standard");
      downgradeToMigration003(context.databasePath);
      const before = await snapshot(context.dataRoot);
      const command = build(validDirectCommand(context.dataRoot, context.runId));
      const locateSpy = vi.spyOn(readOnlyDataRoot, "locateReadOnlyDataRoot");

      const error = await directCall(command).then(() => null, (cause: unknown) => cause);

      expect(locateSpy).not.toHaveBeenCalled();
      expect(await snapshot(context.dataRoot)).toEqual(before);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(expectedError);
    }
  );

  it("validates malformed arguments and the note byte bound before touching a missing root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-cli-assess-missing-"));
    roots.push(root);
    const dataRoot = join(root, "missing-data");
    const oversized = `${"é".repeat(8 * 1024)}a`;

    for (const argv of [
      ["assess", "missing-run", "--data-root", dataRoot, "--verdict", "unknown"],
      ["assess", "missing-run", "--data-root", dataRoot, "--verdict", "partial", "--note", oversized],
      [
        "assess", "missing-run", "--data-root", dataRoot, "--verdict", "unreviewed",
        "--task-completed", "yes"
      ]
    ]) {
      expect((await invoke(argv)).exitCode).toBe(1);
      expect(await snapshot(dataRoot)).toBeNull();
    }
  });

  it("preserves an existing database exactly for invalid input and a missing run", async () => {
    const context = await fixture();
    const oversized = `${"é".repeat(8 * 1024)}a`;
    for (const argv of [
      [
        "assess", context.runId, "--data-root", context.dataRoot, "--verdict", "unreviewed",
        "--task-completed", "no"
      ],
      [
        "assess", context.runId, "--data-root", context.dataRoot, "--verdict", "partial",
        "--note", oversized
      ],
      ["assess", "missing-run", "--data-root", context.dataRoot, "--verdict", "success"]
    ]) {
      const before = await snapshot(context.dataRoot);
      const result = await invoke(argv);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(await snapshot(context.dataRoot)).toEqual(before);
    }
  });

  it("validates a migration-003 run read-only before the approved writable migration", async () => {
    const context = await fixture();
    downgradeToMigration003(context.databasePath);
    const before = await snapshot(context.dataRoot);

    expect((await invoke([
      "assess", "missing-run", "--verdict", "success", "--data-root", context.dataRoot
    ])).exitCode).toBe(1);
    expect(await snapshot(context.dataRoot)).toEqual(before);

    const result = await invoke([
      "assess", context.runId, "--verdict", "success", "--data-root", context.dataRoot, "--json"
    ]);
    expect(result.exitCode).toBe(0);
    const database = openDatabase(context.databasePath);
    try {
      expect(database.inspect().migrations).toEqual([1, 2, 3, 4]);
    } finally {
      database.close();
    }
    expect(assessment(context).current).toMatchObject({
      state: "explicit",
      verdict: "success",
      taskCompleted: "uncertain",
      note: { state: "absent" }
    });
  });

  it("rejects symlinked roots, symlinked databases, and any WAL path without target mutation", async () => {
    const target = await fixture();
    const rootLink = join(target.root, "root-link");
    await symlink(target.dataRoot, rootLink);
    const targetBeforeRoot = await snapshot(target.dataRoot);
    expect((await invoke([
      "assess", target.runId, "--verdict", "success", "--data-root", rootLink
    ])).exitCode).toBe(1);
    expect(await snapshot(target.dataRoot)).toEqual(targetBeforeRoot);

    const linkedRoot = join(target.root, "linked-database-root");
    await mkdir(linkedRoot);
    await symlink(target.databasePath, join(linkedRoot, "agentlens.sqlite"));
    const targetBeforeDatabase = await snapshot(target.dataRoot);
    const linkedBefore = await snapshot(linkedRoot);
    expect((await invoke([
      "assess", target.runId, "--verdict", "success", "--data-root", linkedRoot
    ])).exitCode).toBe(1);
    expect(await snapshot(target.dataRoot)).toEqual(targetBeforeDatabase);
    expect(await snapshot(linkedRoot)).toEqual(linkedBefore);

    const walPath = `${target.databasePath}-wal`;
    await writeFile(walPath, "WAL_REFUSAL_SENTINEL");
    const beforeWal = await snapshot(target.dataRoot);
    const walResult = await invoke([
      "assess", target.runId, "--verdict", "success", "--data-root", target.dataRoot
    ]);
    expect(walResult.exitCode).toBe(1);
    expect(walResult.stderr).toMatch(/wal/i);
    expect(await snapshot(target.dataRoot)).toEqual(beforeWal);
  });

  it("redacts a standard note, persists audits, and never emits or stores its raw sentinels", async () => {
    const context = await fixture("standard");
    const note = "Bearer ASSESS_BEARER_SENTINEL OPENAI_API_KEY=ASSESS_ASSIGNMENT_SENTINEL";
    const result = await invoke([
      "assess", context.runId, "--verdict", "partial", "--task-completed", "uncertain",
      "--note", note, "--data-root", context.dataRoot, "--json"
    ]);
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain("ASSESS_BEARER_SENTINEL");
    expect(`${result.stdout}${result.stderr}`).not.toContain("ASSESS_ASSIGNMENT_SENTINEL");

    const stored = assessment(context);
    const artifact = stored.detail.artifacts.find(({ kind }) => kind === "assessment-note");
    expect(stored.current).toMatchObject({
      verdict: "partial",
      taskCompleted: "uncertain",
      note: { state: "artifact", artifactId: artifact?.id },
      state: "explicit",
      provenance: "human"
    });
    expect(artifact).toBeDefined();
    const artifactText = await readFile(artifact!.path, "utf8");
    expect(artifactText).toMatch(/\[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/);
    expect(artifactText).toMatch(/\[\[REDACTED:assignment-api-key:hmac-sha256:[0-9a-f]{32}\]\]/);
    expect(stored.detail.redactionAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: artifact!.id, reason: "auth-bearer", count: 1 }),
      expect.objectContaining({ artifactId: artifact!.id, reason: "assignment-api-key", count: 1 })
    ]));
    const durable = await durableBytes(context.dataRoot);
    expect(durable.includes(Buffer.from("ASSESS_BEARER_SENTINEL"))).toBe(false);
    expect(durable.includes(Buffer.from("ASSESS_ASSIGNMENT_SENTINEL"))).toBe(false);
  });

  it("reuses an identical standard-note artifact but records equal-millisecond actions distinctly", async () => {
    const context = await fixture("standard");
    const note = "Bearer REPEATED_ASSESSMENT_SENTINEL";
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    const first = await invoke([
      "assess", context.runId, "--verdict", "partial", "--note", note,
      "--data-root", context.dataRoot, "--json"
    ]);
    const second = await invoke([
      "assess", context.runId, "--verdict", "partial", "--note", note,
      "--data-root", context.dataRoot, "--json"
    ]);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);

    const firstOutput = JSON.parse(first.stdout) as { currentEventId: string };
    const secondOutput = JSON.parse(second.stdout) as { currentEventId: string };
    const stored = assessment(context);
    const events = stored.detail.events.filter(({ kind }) => kind === "assessment.updated");
    expect(firstOutput.currentEventId).not.toBe(secondOutput.currentEventId);
    expect(events).toHaveLength(2);
    expect(new Set(events.map(({ id }) => id)).size).toBe(2);
    expect(events.every(({ receivedAt }) => receivedAt === "2026-08-30T20:15:30.123Z")).toBe(true);
    expect(stored.detail.artifacts.filter(({ kind }) => kind === "assessment-note")).toHaveLength(1);
    expect(stored.current).toMatchObject({
      currentEventId: secondOutput.currentEventId,
      reviewedAt: FIXED_TIME,
      updatedAt: FIXED_TIME
    });
    const bindingDatabase = rawDatabase(context.databasePath);
    try {
      expect(bindingDatabase.prepare(
        "SELECT COUNT(*) AS count FROM event_artifact_bindings WHERE role = 'assessment_note'"
      ).get()).toEqual({ count: 2 });
    } finally {
      bindingDatabase.close();
    }
    expect((await durableBytes(context.dataRoot)).includes(Buffer.from("REPEATED_ASSESSMENT_SENTINEL")))
      .toBe(false);
  });

  it("assesses two runs independently when their standard notes have identical bytes", async () => {
    const context = await fixture("standard");
    const otherRunId = `${context.runId}-other`;
    const database = openDatabase(context.databasePath);
    try {
      const repository = new RunRepository(database, {
        artifactRoot: join(context.dataRoot, "artifacts", "sha256")
      });
      repository.createRun({
        id: otherRunId,
        schemaVersion: 1,
        provider: "codex-exec",
        integrationVersion: "0.1.0",
        agentVersion: "fixture-agent",
        capturePolicy: "standard",
        capturePolicyVersion: "1",
        redactionVersion: "1",
        repositoryFingerprint: `fingerprint-${otherRunId}`,
        repositoryDisplay: "fixture-repository",
        startedAt: FIXED_TIME - 9_000
      }, {
        recorderInstanceId: `recorder-${otherRunId}`,
        recorderPid: 124,
        recorderStartToken: `start-${otherRunId}`,
        heartbeatAt: FIXED_TIME - 9_000
      });
    } finally {
      database.close();
    }
    const note = "same reviewer note for both runs";

    const first = await invoke([
      "assess", context.runId, "--verdict", "partial", "--note", note,
      "--data-root", context.dataRoot, "--json"
    ]);
    const second = await invoke([
      "assess", otherRunId, "--verdict", "partial", "--note", note,
      "--data-root", context.dataRoot, "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const firstInspect = await invoke([
      "inspect", context.runId, "--data-root", context.dataRoot, "--json"
    ]);
    const secondInspect = await invoke([
      "inspect", otherRunId, "--data-root", context.dataRoot, "--json"
    ]);
    expect(firstInspect.exitCode).toBe(0);
    expect(secondInspect.exitCode).toBe(0);

    const firstDetail = JSON.parse(firstInspect.stdout) as {
      summary: { assessment: Record<string, unknown> };
      reviewerNote: Record<string, unknown>;
    };
    const secondDetail = JSON.parse(secondInspect.stdout) as typeof firstDetail;
    for (const detail of [firstDetail, secondDetail]) {
      expect(detail.summary.assessment).toMatchObject({
        verdict: "partial",
        note: { state: "artifact", artifactId: expect.any(String) },
        state: "explicit",
        provenance: "human"
      });
      expect(detail.reviewerNote).toMatchObject({
        state: "artifact",
        artifactId: expect.any(String),
        contentAvailable: true,
        content: note
      });
    }
    expect(firstDetail.reviewerNote.artifactId).toBe(secondDetail.reviewerNote.artifactId);
  });

  it.each(["metadata-only", "strict"] as const)(
    "omits a %s note without creating a key or artifact",
    async (capturePolicy) => {
      const context = await fixture(capturePolicy);
      const sentinel = `${capturePolicy.toUpperCase()}_ASSESSMENT_NOTE_SENTINEL`;
      const result = await invoke([
        "assess", context.runId, "--verdict", "failure", "--note", sentinel,
        "--data-root", context.dataRoot, "--json"
      ]);
      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
      expect(assessment(context).current).toMatchObject({
        note: { state: "omitted", reason: capturePolicy },
        state: "explicit",
        provenance: "human"
      });
      expect(await regularFiles(join(context.dataRoot, "artifacts"))).toEqual([]);
      await expect(lstat(join(context.dataRoot, "secrets", "redaction-hmac.key")))
        .rejects.toMatchObject({ code: "ENOENT" });
      expect((await durableBytes(context.dataRoot)).includes(Buffer.from(sentinel))).toBe(false);
    }
  );

  it.each([
    ["omitted", undefined],
    ["empty", ""]
  ] as const)("keeps an %s standard note absent without creating a key or artifact", async (_case, note) => {
    const context = await fixture("standard");
    const argv = [
      "assess", context.runId, "--verdict", "success", "--data-root", context.dataRoot, "--json"
    ];
    if (note !== undefined) argv.splice(4, 0, "--note", note);
    expect((await invoke(argv)).exitCode).toBe(0);
    expect(assessment(context).current.note).toEqual({ state: "absent" });
    expect(await regularFiles(join(context.dataRoot, "artifacts"))).toEqual([]);
    await expect(lstat(join(context.dataRoot, "secrets", "redaction-hmac.key")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts exactly 16 KiB of UTF-8 and rejects one additional byte before write", async () => {
    const exactContext = await fixture("metadata-only");
    const exact = "é".repeat(8 * 1024);
    expect(Buffer.byteLength(exact, "utf8")).toBe(16 * 1024);
    expect((await invoke([
      "assess", exactContext.runId, "--verdict", "partial", "--note", exact,
      "--data-root", exactContext.dataRoot
    ])).exitCode).toBe(0);
    expect(assessment(exactContext).current.note).toEqual({
      state: "omitted",
      reason: "metadata-only"
    });

    const oversizedContext = await fixture("standard");
    const before = await snapshot(oversizedContext.dataRoot);
    expect((await invoke([
      "assess", oversizedContext.runId, "--verdict", "partial", "--note", `${exact}a`,
      "--data-root", oversizedContext.dataRoot
    ])).exitCode).toBe(1);
    expect(await snapshot(oversizedContext.dataRoot)).toEqual(before);
  });

  it("returns stable content-free JSON and concise text with explicit human timestamps", async () => {
    const context = await fixture("standard");
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
    const jsonResult = await invoke([
      "assess", context.runId, "--verdict", "unreviewed", "--note", "",
      "--data-root", context.dataRoot, "--json"
    ]);
    expect(jsonResult.exitCode).toBe(0);
    expect(JSON.parse(jsonResult.stdout)).toEqual({
      schemaVersion: 1,
      runId: context.runId,
      currentEventId: expect.any(String),
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "absent" },
      state: "explicit",
      provenance: "human",
      reviewedAt: FIXED_TIME,
      updatedAt: FIXED_TIME
    });

    const textResult = await invoke([
      "assess", context.runId, "--verdict", "success", "--task-completed", "yes",
      "--data-root", context.dataRoot
    ]);
    expect(textResult.exitCode).toBe(0);
    expect(textResult.stdout).toMatch(new RegExp(
      `^Assessment ${context.runId}: verdict=success taskCompleted=yes state=explicit ` +
      `provenance=human note=absent currentEventId=[^ ]+ reviewedAt=${FIXED_TIME} updatedAt=${FIXED_TIME}\\n$`
    ));
    expect(textResult.stdout).not.toContain("Human assessment updated");
  });

  it("may leave only an unreferenced redacted artifact when SQLite fails after artifact completion", async () => {
    const context = await fixture("standard");
    const database = rawDatabase(context.databasePath);
    try {
      database.exec(`
        CREATE TRIGGER force_assessment_failure
        BEFORE INSERT ON events
        WHEN NEW.kind = 'assessment.updated'
        BEGIN
          SELECT RAISE(ABORT, 'forced assessment database failure');
        END;
      `);
    } finally {
      database.close();
    }
    const note = "Bearer ORPHAN_ASSESSMENT_SENTINEL";
    const result = await invoke([
      "assess", context.runId, "--verdict", "failure", "--note", note,
      "--data-root", context.dataRoot
    ]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain("ORPHAN_ASSESSMENT_SENTINEL");

    const inspection = rawDatabase(context.databasePath);
    try {
      expect(inspection.prepare(
        "SELECT COUNT(*) AS count FROM events WHERE kind = 'assessment.updated'"
      ).get()).toEqual({ count: 0 });
      expect(inspection.prepare(
        "SELECT COUNT(*) AS count FROM artifacts WHERE kind = 'assessment-note'"
      ).get()).toEqual({ count: 0 });
      expect(inspection.prepare("SELECT COUNT(*) AS count FROM current_assessments").get())
        .toEqual({ count: 0 });
      expect(inspection.prepare("SELECT COUNT(*) AS count FROM event_artifact_bindings").get())
        .toEqual({ count: 0 });
    } finally {
      inspection.close();
    }
    const orphanFiles = await regularFiles(join(context.dataRoot, "artifacts", "sha256"));
    expect(orphanFiles).toHaveLength(1);
    expect(await readFile(orphanFiles[0]!, "utf8"))
      .toMatch(/\[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/);
    expect((await durableBytes(context.dataRoot)).includes(Buffer.from("ORPHAN_ASSESSMENT_SENTINEL")))
      .toBe(false);
  });
});
