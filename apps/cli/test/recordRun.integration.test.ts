import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod,
  copyFile,
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
import { delimiter, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TraceEventV1 } from "@agentlens/core";
import * as derivations from "@agentlens/derivations";
import { openDatabase, RunRepository } from "@agentlens/storage";
import {
  derivePersistedTerminalCommand,
  ensureTestDerivationsForRun
} from "../src/deriveTests.js";
import {
  recoverStaleRuns,
  type RecoverStaleRunsInput
} from "../src/recoverRuns.js";
import { recordRun } from "../src/recordRun.js";

const execFile = promisify(execFileCallback);
const requireFromStorage = createRequire(
  fileURLToPath(new URL("../../../packages/storage/package.json", import.meta.url))
);
const SqliteDatabase = requireFromStorage("better-sqlite3") as new (
  filename: string,
  options: { readonly: boolean; fileMustExist: boolean }
) => {
  pragma(source: string): unknown;
  prepare(source: string): { get(...params: unknown[]): unknown };
  close(): void;
};
const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const roots: string[] = [];
const processGroups: number[] = [];
const silentOutput = { write: () => true };

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile("git", args, { cwd, encoding: "utf8" })).stdout;
}

async function fixture(): Promise<{
  root: string;
  repo: string;
  dataRoot: string;
  env: NodeJS.ProcessEnv;
}> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-cli-record-"));
  roots.push(root);
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const dataRoot = join(root, "data");
  await mkdir(repo);
  await mkdir(bin);
  await git(repo, "init", "-q");
  await git(repo, "config", "user.email", "fixture@example.test");
  await git(repo, "config", "user.name", "AgentLens Fixture");
  await writeFile(join(repo, "tracked.txt"), "before\n", "utf8");
  await writeFile(join(repo, ".env.production"), "DATABASE_PASSWORD=initial\n", "utf8");
  await git(repo, "add", "tracked.txt", ".env.production");
  await git(repo, "commit", "-qm", "initial");
  await copyFile(fakeCodex, join(bin, "codex"));
  await chmod(join(bin, "codex"), 0o700);
  return {
    root,
    repo,
    dataRoot,
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
  };
}

async function installCommandFixture(
  root: string,
  input: Readonly<{
    command: string;
    aggregatedOutput?: string;
    exitCode?: number;
    status?: "completed" | "failed";
    includeStarted?: boolean;
  }>
): Promise<void> {
  const terminalItem = {
    id: "bounded-command",
    type: "command_execution",
    command: input.command,
    aggregated_output: input.aggregatedOutput ?? "fixture output",
    exit_code: input.exitCode ?? 0,
    status: input.status ?? "completed"
  };
  const records = [
    { type: "thread.started", thread_id: "fixture-thread" },
    { type: "turn.started", thread_id: "fixture-thread", turn_id: "fixture-turn" },
    ...(input.includeStarted
      ? [{
          type: "item.started",
          thread_id: "fixture-thread",
          turn_id: "fixture-turn",
          item: { ...terminalItem, status: "in_progress" }
        }]
      : []),
    {
      type: "item.completed",
      thread_id: "fixture-thread",
      turn_id: "fixture-turn",
      item: terminalItem
    },
    {
      type: "turn.completed",
      thread_id: "fixture-thread",
      turn_id: "fixture-turn",
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 }
    }
  ];
  const source = [
    "#!/usr/bin/env node",
    `const records = ${JSON.stringify(records)};`,
    "for (const record of records) process.stdout.write(JSON.stringify(record) + '\\n');",
    ""
  ].join("\n");
  const executable = join(root, "bin", "codex");
  await writeFile(executable, source, "utf8");
  await chmod(executable, 0o700);
}

function piped(bytes: Buffer = Buffer.alloc(0)): NodeJS.ReadStream {
  return Object.assign(Readable.from([bytes]), { isTTY: false }) as unknown as NodeJS.ReadStream;
}

function detail(dataRoot: string, runId: string) {
  const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
  try {
    return new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    }).getRunDetail(runId);
  } finally {
    database.close();
  }
}

function appendOnlyTestCommand(
  repository: RunRepository,
  runId: string,
  sourceEventId: string
): TraceEventV1 {
  const source = repository.getRunDetail(runId).events.find(({ id }) => id === sourceEventId);
  if (!source || (source.status !== "completed" && source.status !== "failed")) {
    throw new Error("Split-derivation fixture requires a durable terminal source event.");
  }
  const command = derivations.buildTestDerivationDrafts({
    runId,
    sourceEventId,
    sourceProvider: source.source.provider,
    eventStatus: source.status,
    exitCode: 0,
    classification: {
      family: "pnpm",
      confidence: "high",
      derivationVersion: "test-command/1"
    }
  })[0];
  return repository.appendDerivedEvent({
    identity: command.derivation.identity,
    sourceEventId,
    eventId: command.id,
    receivedAt: source.receivedAt,
    kind: command.kind,
    status: command.status,
    sourceProvider: command.source.provider,
    summary: command.summary,
    normalizedPayload: command.normalizedPayload,
    derivation: {
      name: command.derivation.name,
      version: command.derivation.version,
      identity: command.derivation.identity,
      confidence: command.derivation.confidence
    }
  });
}

async function durableBytes(root: string): Promise<Buffer> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Buffer.concat(await Promise.all(files.map((entry) => readFile(join(entry.parentPath, entry.name)))));
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

async function waitForOpenCommand(dataRoot: string, runId: () => string | undefined): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      const id = runId();
      if (id && detail(dataRoot, id).events.some(({ kind, status }) =>
        kind === "command" && status === "in_progress"
      )) return;
    } catch {
      // The database/run can still be between creation and its first event.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the persisted open command event.");
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const processGroupId of processGroups.splice(0)) {
    try { process.kill(-processGroupId, "SIGKILL"); } catch { /* expected after recorder cleanup */ }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("recordRun lifecycle", () => {
  it("persists and releases recorder/child ownership around a completed run", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const ownership = detail(context.dataRoot, recorded.runId).ownership;

    expect(ownership).toMatchObject({
      recorderPid: process.pid,
      recorderStartToken: expect.any(String),
      recorderInstanceId: expect.any(String),
      childPid: expect.any(Number),
      childStartToken: expect.any(String),
      childProcessGroupId: expect.any(Number),
      condition: "released"
    });
  });

  it("refuses a dirty worktree before the fake child or durable recorder starts", async () => {
    const context = await fixture();
    const startedFile = join(context.root, "child-started.log");
    await writeFile(join(context.repo, "untracked-before-spawn.txt"), "dirty\n", "utf8");

    await expect(recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: startedFile },
        stdout: silentOutput
      }
    )).rejects.toThrow(/clean Git repository before child spawn/i);
    await expect(readFile(startedFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(context.dataRoot, "agentlens.sqlite"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("leaves pre-existing stale-capable storage byte-and-metadata unchanged on dirty Git refusal", async () => {
    const context = await fixture();
    const seeded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    await execFile("sqlite3", [join(context.dataRoot, "agentlens.sqlite"), `
      UPDATE runs SET status = 'running', ended_at = NULL WHERE id = '${seeded.runId}';
      UPDATE run_ownership SET condition = 'active', recorder_pid = 404404,
        recorder_start_token = 'stale-token' WHERE run_id = '${seeded.runId}';
    `]);
    await writeFile(join(context.repo, "dirty-before-recovery.txt"), "dirty\n", "utf8");
    const startedFile = join(context.root, "dirty-stale-child-started.log");
    const before = await snapshot(context.dataRoot);
    const recovery = vi.fn(async (_input: RecoverStaleRunsInput) => ({
      recoveredRunIds: [],
      orphanRunIds: [],
      ambiguousRunIds: []
    }));

    await expect(recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: startedFile },
        stdout: silentOutput,
        recoverStaleRuns: recovery,
        processIdentityInspector: {
          captureStartToken: vi.fn(async () => "must-not-be-called"),
          inspect: vi.fn(async () => "gone" as const),
          inspectGroup: vi.fn(() => "gone" as const)
        }
      }
    )).rejects.toThrow(/clean Git repository before child spawn/i);

    expect(recovery).not.toHaveBeenCalled();
    await expect(lstat(startedFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("refuses a missing data-root child inside the repository before storage or spawn", async () => {
    const context = await fixture();
    const startedFile = join(context.root, "in-repo-child-started.log");
    const dataRoot = join(context.repo, "missing", "agentlens-data");

    await expect(recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: startedFile },
        stdout: silentOutput
      }
    )).rejects.toThrow(/data root.*repository/i);

    await expect(lstat(join(context.repo, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(startedFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses the canonical repository root itself as data-root before storage or spawn", async () => {
    const context = await fixture();
    const startedFile = join(context.root, "repository-root-started.log");
    const originalHead = (await git(context.repo, "rev-parse", "HEAD")).trim();

    await expect(recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.repo,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: startedFile },
        stdout: silentOutput
      }
    )).rejects.toThrow(/data root.*repository/i);

    expect((await git(context.repo, "rev-parse", "HEAD")).trim()).toBe(originalHead);
    expect(await git(context.repo, "status", "--porcelain")).toBe("");
    await expect(lstat(join(context.repo, "agentlens.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(context.repo, "secrets"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(startedFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses canonical in-repository containment through a symlinked parent before storage or spawn", async () => {
    const context = await fixture();
    const startedFile = join(context.root, "canonical-child-started.log");
    const repositoryAlias = join(context.root, "repository-alias");
    const dataRoot = join(repositoryAlias, "agentlens-data");
    await symlink(context.repo, repositoryAlias);

    await expect(recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: startedFile },
        stdout: silentOutput
      }
    )).rejects.toThrow(/data root.*repository/i);

    await expect(lstat(join(context.repo, "agentlens-data"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(startedFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a symlink alias of the canonical repository root before storage or spawn", async () => {
    const context = await fixture();
    const startedFile = join(context.root, "canonical-root-alias-started.log");
    const repositoryAlias = join(context.root, "repository-root-alias");
    await symlink(context.repo, repositoryAlias);

    await expect(recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: repositoryAlias,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: startedFile },
        stdout: silentOutput
      }
    )).rejects.toThrow(/data root.*repository/i);

    await expect(lstat(join(context.repo, "agentlens.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(context.repo, "secrets"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(startedFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prints the run id before the real fake child starts and forwards exact argv", async () => {
    const context = await fixture();
    const orderFile = join(context.root, "order.log");
    const argvCapture = join(context.root, "argv.json");
    const output: string[] = [];
    const childArgs = [
      "codex", "exec", "--json", "literal argument with spaces", "--fake-mode=success"
    ];

    const result = await recordRun(
      { name: "record", capture: "standard", dataRoot: context.dataRoot, childArgs },
      {
        cwd: context.repo,
        stdin: piped(),
        env: {
          ...context.env,
          AGENTLENS_FAKE_STARTED_FILE: orderFile,
          AGENTLENS_ARGV_CAPTURE: argvCapture
        },
        stdout: {
          write: (chunk) => {
            output.push(String(chunk));
            return true;
          }
        },
        onRunIdPrinted: (runId) => writeFile(orderFile, `run-id:${runId}\n`, "utf8")
      }
    );

    expect(result).toMatchObject({ status: "completed", exitCode: 0, terminatingSignal: null });
    expect(output.join("")).toContain(result.runId);
    expect((await readFile(orderFile, "utf8")).split("\n").slice(0, 2)).toEqual([
      `run-id:${result.runId}`,
      "child-started"
    ]);
    expect(JSON.parse(await readFile(argvCapture, "utf8"))).toEqual(childArgs.slice(1));
    expect(detail(context.dataRoot, result.runId).run.childPid).toEqual(expect.any(Number));
  });

  it("recovers an eligible older run before creating/printing the new run and spawning Codex", async () => {
    const context = await fixture();
    const databasePath = join(context.dataRoot, "agentlens.sqlite");
    const database = openDatabase(databasePath);
    try {
      const repository = new RunRepository(database, {
        artifactRoot: join(context.dataRoot, "artifacts", "sha256")
      });
      repository.createRun({
        id: "older-stale-run",
        schemaVersion: 1,
        provider: "codex-exec",
        integrationVersion: "0.1.0",
        agentVersion: "unknown",
        capturePolicy: "standard",
        capturePolicyVersion: "1",
        redactionVersion: "1",
        repositoryFingerprint: "older-fixture",
        repositoryDisplay: "fixture",
        startedAt: 1
      }, {
        recorderInstanceId: "older-recorder",
        recorderPid: 404_404,
        recorderStartToken: "older-start-token",
        heartbeatAt: 1
      });
    } finally {
      database.close();
    }
    const orderFile = join(context.root, "recovery-order.log");
    let recoveredAtPrint = false;
    let newRunPresentAtPrint = false;
    let runIdsAtRecovery: readonly string[] = [];

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: orderFile },
        stdout: silentOutput,
        recoverStaleRuns: async (input) => {
          runIdsAtRecovery = input.repository.listRuns({ limit: 100 }).map(({ id }) => id);
          return recoverStaleRuns(input);
        },
        processIdentityInspector: {
          captureStartToken: async (pid) => `token-${pid}`,
          inspect: async (pid) => pid === 404_404 ? "gone" : "same",
          inspectGroup: () => "gone"
        },
        onRunIdPrinted: async (runId) => {
          const older = detail(context.dataRoot, "older-stale-run");
          recoveredAtPrint = older.run.status !== "starting" &&
            older.ownership?.condition === "released" &&
            older.events.some(({ kind }) => kind === "recorder.ownership_lost");
          newRunPresentAtPrint = detail(context.dataRoot, runId).run.id === runId;
          await writeFile(orderFile, "run-id-after-recovery\n", "utf8");
        }
      }
    );

    expect(result.status).toBe("completed");
    expect(runIdsAtRecovery).toEqual(["older-stale-run"]);
    expect(recoveredAtPrint).toBe(true);
    expect(newRunPresentAtPrint).toBe(true);
    expect((await readFile(orderFile, "utf8")).split("\n").slice(0, 2)).toEqual([
      "run-id-after-recovery",
      "child-started"
    ]);
  });

  it("does not label ID-less thread or turn starts as interrupted recovery", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(run.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "thread.started",
        source: expect.objectContaining({ threadId: "fixture-thread" })
      }),
      expect.objectContaining({
        kind: "turn.started",
        source: expect.objectContaining({ turnId: "fixture-turn" })
      })
    ]));
    expect(run.events.filter(({ kind }) => kind === "recorder.recovery")).toEqual([]);
  });

  it("keeps provider completion and a nonzero process exit as separate contradictory facts", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=nonzero"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(result).toMatchObject({ status: "failed", exitCode: 7, cliExitCode: 7 });
    expect(run.run).toMatchObject({
      providerTerminalKind: "completed",
      exitCode: 7,
      contradictionCodes: ["provider_completed_with_nonzero_exit"]
    });
    expect(run.events.some(({ kind, provenance }) =>
      kind === "turn.completed" && provenance === "observed"
    )).toBe(true);
    expect(run.events.some(({ kind, provenance }) =>
      kind === "recorder.process_exit" && provenance === "recorder"
    )).toBe(true);
  });

  it("keeps an observed command failure and later recovery activity as separate facts", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=failed-then-recovery"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);
    const commands = run.events.filter(({ kind }) => kind === "command");

    expect(result.status).toBe("completed");
    expect(commands.map(({ status }) => status)).toEqual([
      "in_progress", "failed", "in_progress", "completed"
    ]);
    expect(commands.every(({ provenance }) => provenance === "observed")).toBe(true);
    expect(run.run).toMatchObject({ providerTerminalKind: "completed", exitCode: 0 });
  });

  it("derives test evidence only after the terminal observed command is durable", async () => {
    const context = await fixture();
    let terminalPersistedSnapshot: Readonly<{
      source: Readonly<{
        id: string;
        kind: string;
        status: string;
        provenance: string;
        eventType: string | null;
      }>;
      derivedCount: number;
    }> | undefined;

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        onObservedEventPersisted: ({ runId, eventId }) => {
          const connection = new SqliteDatabase(join(context.dataRoot, "agentlens.sqlite"), {
            readonly: true,
            fileMustExist: true
          });
          try {
            connection.pragma("query_only = ON");
            const source = connection.prepare(`
              SELECT
                events.id,
                events.kind,
                events.status,
                events.provenance,
                event_sources.event_type AS eventType
              FROM events
              JOIN event_sources ON event_sources.event_id = events.id
              WHERE events.run_id = ? AND events.id = ?
            `).get(runId, eventId) as {
              id: string;
              kind: string;
              status: string;
              provenance: string;
              eventType: string | null;
            } | undefined;
            if (source?.eventType !== "item.completed") return;
            const derivedCount = connection.prepare(`
              SELECT COUNT(*) AS count
              FROM events
              WHERE run_id = ? AND kind IN ('test.command', 'test.result')
            `).get(runId) as { count: number };
            terminalPersistedSnapshot = Object.freeze({ source, derivedCount: derivedCount.count });
          } finally {
            connection.close();
          }
        }
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const started = run.events.find(({ source }) =>
      source.itemId === "test-command" && source.eventType === "item.started"
    );
    const terminal = run.events.find(({ source }) =>
      source.itemId === "test-command" && source.eventType === "item.completed"
    );
    const trajectory = run.events.filter(({ id, relationships }) =>
      id === terminal?.id || relationships.some(({ type, eventId }) =>
        type === "derived_from" && eventId === terminal?.id
      )
    );

    expect(terminalPersistedSnapshot).toEqual({
      source: {
        id: terminal?.id,
        kind: "command",
        status: "completed",
        provenance: "observed",
        eventType: "item.completed"
      },
      derivedCount: 0
    });
    expect(trajectory.map(({ kind }) => kind)).toEqual([
      "command",
      "test.command",
      "test.result"
    ]);
    expect(started).toMatchObject({
      kind: "command",
      status: "in_progress",
      provenance: "observed",
      source: { eventType: "item.started", itemId: "test-command" },
      relationships: []
    });
    expect(run.events.filter(({ relationships }) => relationships.some(({ eventId }) =>
      eventId === started?.id
    ))).toEqual([]);
    expect(new Set(run.events.map(({ sequence }) => sequence)).size).toBe(run.events.length);
  });

  it("finalization fills a complete eager-derivation gap and remains idempotent", async () => {
    const context = await fixture();
    let eagerCalls = 0;
    let finalizationCalls = 0;
    let derivationCounts: readonly number[] = [];
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        derivePersistedTerminalCommand: () => {
          eagerCalls += 1;
          return [];
        },
        ensureTestDerivationsForRun: (input) => {
          finalizationCalls += 1;
          const count = () => input.repository.getRunDetail(input.runId).events.filter(({ kind }) =>
            kind === "test.command" || kind === "test.result"
          ).length;
          const before = count();
          const first = ensureTestDerivationsForRun(input);
          const afterFirst = count();
          const repeated = ensureTestDerivationsForRun(input);
          derivationCounts = [before, afterFirst, count()];
          expect(repeated).toEqual(first);
          return repeated;
        }
      }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(eagerCalls).toBe(1);
    expect(finalizationCalls).toBe(1);
    expect(derivationCounts).toEqual([0, 2, 2]);
    expect(run.events.filter(({ kind }) => kind.startsWith("test.")).map(({ kind }) => kind))
      .toEqual(["test.command", "test.result"]);
    expect(run.events.at(-1)?.kind).toBe("run.reconciled");
  });

  it("finalization fills only the missing result after a split eager write", async () => {
    const context = await fixture();
    let eagerCommandId: string | undefined;
    let kindsAcrossFinalization: readonly (readonly string[])[] = [];
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        derivePersistedTerminalCommand: (input) => {
          const command = appendOnlyTestCommand(
            input.repository,
            input.runId,
            input.sourceEventId
          );
          eagerCommandId = command.id;
          return [command];
        },
        ensureTestDerivationsForRun: (input) => {
          const kinds = () => input.repository.getRunDetail(input.runId).events
            .filter(({ kind }) => kind.startsWith("test."))
            .map(({ kind }) => kind);
          const before = kinds();
          const first = ensureTestDerivationsForRun(input);
          const afterFirst = kinds();
          const repeated = ensureTestDerivationsForRun(input);
          kindsAcrossFinalization = [before, afterFirst, kinds()];
          expect(repeated).toEqual(first);
          return repeated;
        }
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const derived = run.events.filter(({ kind }) => kind.startsWith("test."));

    expect(kindsAcrossFinalization).toEqual([
      ["test.command"],
      ["test.command", "test.result"],
      ["test.command", "test.result"]
    ]);
    expect(derived.map(({ kind }) => kind)).toEqual(["test.command", "test.result"]);
    expect(derived[0]?.id).toBe(eagerCommandId);
  });

  it.each([
    { name: "malformed quoting", command: "pnpm test '\"" },
    { name: "unknown command", command: "echo pytest" }
  ])("contains $name without losing the terminal source", async ({ command }) => {
    const context = await fixture();
    await installCommandFixture(context.root, { command });
    let eagerCalls = 0;

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        derivePersistedTerminalCommand: (input) => {
          eagerCalls += 1;
          return derivePersistedTerminalCommand(input);
        }
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const source = run.events.find(({ source: eventSource }) =>
      eventSource.itemId === "bounded-command" && eventSource.eventType === "item.completed"
    );

    expect(result.status).toBe("completed");
    expect(eagerCalls).toBe(1);
    expect(source).toMatchObject({
      kind: "command",
      status: "completed",
      provenance: "observed"
    });
    expect(run.events.filter(({ kind }) => kind.startsWith("test."))).toEqual([]);
    expect(run.events.filter(({ kind }) => kind === "error")).toEqual([]);
  });

  it("contains classifier exceptions per durable source and leaves a retryable gap", async () => {
    const context = await fixture();
    const classifierSentinel = "CLASSIFIER_PRIVATE_SENTINEL";
    const classifier = vi.spyOn(derivations, "classifyTestCommand")
      .mockImplementation(() => { throw new Error(classifierSentinel); });

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);
    const source = run.events.find(({ source: eventSource }) =>
      eventSource.itemId === "test-command" && eventSource.eventType === "item.completed"
    );

    expect(result.status).toBe("completed");
    expect(classifier).toHaveBeenCalled();
    expect(source).toMatchObject({
      kind: "command",
      status: "completed",
      provenance: "observed"
    });
    expect(run.events.filter(({ kind }) => kind.startsWith("test."))).toEqual([]);
    expect(run.events.filter(({ kind }) => kind === "error")).toEqual([]);
    expect((await durableBytes(context.dataRoot)).includes(Buffer.from(classifierSentinel))).toBe(false);
  });

  it("routes a derived-event storage failure through recorder-error reconciliation without source mutation", async () => {
    const context = await fixture();
    const appendDerivedEvent = RunRepository.prototype.appendDerivedEvent;
    const storageFailure = vi.spyOn(RunRepository.prototype, "appendDerivedEvent")
      .mockImplementationOnce(() => { throw new Error("DERIVATION_STORAGE_PRIVATE_SENTINEL"); })
      .mockImplementation(appendDerivedEvent);
    let terminalSourceBeforeFailure: string | undefined;

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        derivePersistedTerminalCommand: () => [],
        onObservedEventPersisted: ({ runId, eventId }) => {
          const source = detail(context.dataRoot, runId).events.find(({ id }) => id === eventId);
          if (source?.source.eventType === "item.completed") {
            terminalSourceBeforeFailure = JSON.stringify(source);
          }
        }
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const terminal = run.events.find(({ source }) =>
      source.itemId === "test-command" && source.eventType === "item.completed"
    );
    const recorderFailure = run.events.find(({ kind, provenance }) =>
      kind === "error" && provenance === "recorder"
    );

    expect(storageFailure).toHaveBeenCalled();
    expect(result.status).toBe("recorder_error");
    expect(JSON.stringify(terminal)).toBe(terminalSourceBeforeFailure);
    expect(recorderFailure).toMatchObject({
      status: "failed",
      normalizedPayload: { recorderFailure: true, phase: "recording" }
    });
    expect(run.events.at(-1)).toMatchObject({
      kind: "run.reconciled",
      normalizedPayload: { status: "recorder_error", recorderFailure: true }
    });
    expect((await durableBytes(context.dataRoot)).includes(
      Buffer.from("DERIVATION_STORAGE_PRIVATE_SENTINEL")
    )).toBe(false);
  });

  it("rebases and contains an eager second-write derivation failure", async () => {
    const context = await fixture();
    const failureSentinel = "EAGER_DERIVATION_STORAGE_PRIVATE_SENTINEL";
    const appendDerivedEvent = RunRepository.prototype.appendDerivedEvent;
    let appendCalls = 0;
    let terminalSourceBeforeFailure: string | undefined;
    let partialCommandBeforeFailure: string | undefined;
    let observedRunId: string | undefined;
    vi.spyOn(RunRepository.prototype, "appendDerivedEvent")
      .mockImplementation(function (this: RunRepository, input) {
        appendCalls += 1;
        if (appendCalls === 2) {
          if (!observedRunId) throw new Error("Missing observed run ID before eager failure.");
          partialCommandBeforeFailure = JSON.stringify(
            detail(context.dataRoot, observedRunId).events.find(({ kind }) => kind === "test.command")
          );
          throw new Error(failureSentinel);
        }
        return appendDerivedEvent.call(this, input);
      });

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        onObservedEventPersisted: ({ runId, eventId }) => {
          const source = detail(context.dataRoot, runId).events.find(({ id }) => id === eventId);
          if (source?.source.eventType === "item.completed") {
            observedRunId = runId;
            terminalSourceBeforeFailure = JSON.stringify(source);
          }
        }
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const terminal = run.events.find(({ source }) =>
      source.itemId === "test-command" && source.eventType === "item.completed"
    );
    const derived = run.events.filter(({ kind }) => kind.startsWith("test."));
    const recorderFailure = run.events.find(({ kind, provenance }) =>
      kind === "error" && provenance === "recorder"
    );

    expect(result.status).toBe("recorder_error");
    expect(JSON.stringify(terminal)).toBe(terminalSourceBeforeFailure);
    expect(derived.map(({ kind }) => kind)).toEqual(["test.command", "test.result"]);
    expect(JSON.stringify(derived[0])).toBe(partialCommandBeforeFailure);
    expect(derived[1]?.relationships).toEqual([
      { type: "derived_from", eventId: terminal?.id }
    ]);
    expect(run.events.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: run.events.length }, (_, sequence) => sequence)
    );
    expect(terminal?.sequence).toBeLessThan(derived[0]?.sequence ?? -1);
    expect(derived[0]?.sequence).toBeLessThan(derived[1]?.sequence ?? -1);
    expect(recorderFailure).toMatchObject({
      status: "failed",
      normalizedPayload: { recorderFailure: true, phase: "recording" }
    });
    expect(run.events.at(-1)).toMatchObject({
      kind: "run.reconciled",
      normalizedPayload: { status: "recorder_error", recorderFailure: true }
    });

    const database = openDatabase(join(context.dataRoot, "agentlens.sqlite"));
    try {
      const repository = new RunRepository(database, {
        artifactRoot: join(context.dataRoot, "artifacts", "sha256")
      });
      const beforeRetry = repository.getRunDetail(result.runId).events;
      const firstRetry = ensureTestDerivationsForRun({ repository, runId: result.runId });
      const afterFirstRetry = repository.getRunDetail(result.runId).events;
      const secondRetry = ensureTestDerivationsForRun({ repository, runId: result.runId });
      expect(firstRetry).toEqual(derived);
      expect(secondRetry).toEqual(firstRetry);
      expect(afterFirstRetry).toEqual(beforeRetry);
      expect(repository.getRunDetail(result.runId).events).toEqual(beforeRetry);
    } finally {
      database.close();
    }
    expect((await durableBytes(context.dataRoot)).includes(Buffer.from(failureSentinel))).toBe(false);
  });

  it("rebases and contains a finalization second-write derivation failure", async () => {
    const context = await fixture();
    const failureSentinel = "FINALIZATION_DERIVATION_STORAGE_PRIVATE_SENTINEL";
    const appendDerivedEvent = RunRepository.prototype.appendDerivedEvent;
    let appendCalls = 0;
    let terminalSourceBeforeFailure: string | undefined;
    let partialCommandBeforeFailure: string | undefined;
    let observedRunId: string | undefined;
    vi.spyOn(RunRepository.prototype, "appendDerivedEvent")
      .mockImplementation(function (this: RunRepository, input) {
        appendCalls += 1;
        if (appendCalls === 2) {
          if (!observedRunId) throw new Error("Missing observed run ID before finalization failure.");
          partialCommandBeforeFailure = JSON.stringify(
            detail(context.dataRoot, observedRunId).events.find(({ kind }) => kind === "test.command")
          );
          throw new Error(failureSentinel);
        }
        return appendDerivedEvent.call(this, input);
      });

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        derivePersistedTerminalCommand: () => [],
        onObservedEventPersisted: ({ runId, eventId }) => {
          const source = detail(context.dataRoot, runId).events.find(({ id }) => id === eventId);
          if (source?.source.eventType === "item.completed") {
            observedRunId = runId;
            terminalSourceBeforeFailure = JSON.stringify(source);
          }
        }
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const terminal = run.events.find(({ source }) =>
      source.itemId === "test-command" && source.eventType === "item.completed"
    );
    const derived = run.events.filter(({ kind }) => kind.startsWith("test."));
    const recorderFailure = run.events.find(({ kind, provenance }) =>
      kind === "error" && provenance === "recorder"
    );

    expect(result.status).toBe("recorder_error");
    expect(JSON.stringify(terminal)).toBe(terminalSourceBeforeFailure);
    expect(derived.map(({ kind }) => kind)).toEqual(["test.command", "test.result"]);
    expect(JSON.stringify(derived[0])).toBe(partialCommandBeforeFailure);
    expect(derived[1]?.relationships).toEqual([
      { type: "derived_from", eventId: terminal?.id }
    ]);
    expect(run.events.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: run.events.length }, (_, sequence) => sequence)
    );
    expect(terminal?.sequence).toBeLessThan(derived[0]?.sequence ?? -1);
    expect(derived[0]?.sequence).toBeLessThan(derived[1]?.sequence ?? -1);
    expect(recorderFailure).toMatchObject({
      status: "failed",
      normalizedPayload: { recorderFailure: true, phase: "recording" }
    });
    expect(run.events.at(-1)).toMatchObject({
      kind: "run.reconciled",
      normalizedPayload: { status: "recorder_error", recorderFailure: true }
    });

    const database = openDatabase(join(context.dataRoot, "agentlens.sqlite"));
    try {
      const repository = new RunRepository(database, {
        artifactRoot: join(context.dataRoot, "artifacts", "sha256")
      });
      const beforeRetry = repository.getRunDetail(result.runId).events;
      const firstRetry = ensureTestDerivationsForRun({ repository, runId: result.runId });
      const afterFirstRetry = repository.getRunDetail(result.runId).events;
      const secondRetry = ensureTestDerivationsForRun({ repository, runId: result.runId });
      expect(firstRetry).toEqual(derived);
      expect(secondRetry).toEqual(firstRetry);
      expect(afterFirstRetry).toEqual(beforeRetry);
      expect(repository.getRunDetail(result.runId).events).toEqual(beforeRetry);
    } finally {
      database.close();
    }
    expect((await durableBytes(context.dataRoot)).includes(Buffer.from(failureSentinel))).toBe(false);
  });

  it("persists already-redacted command evidence for every observed command lifecycle event", async () => {
    const context = await fixture();
    const sentinel = "STANDARD_COMMAND_EVIDENCE_SENTINEL";
    await installCommandFixture(context.root, {
      command: `printf ACCESS_TOKEN=${sentinel}`,
      includeStarted: true
    });

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const commands = detail(context.dataRoot, result.runId).events
      .filter(({ kind }) => kind === "command");

    expect(commands).toHaveLength(2);
    for (const command of commands) {
      const normalized = command.normalizedPayload as {
        command?: unknown;
        commandEvidence?: { state?: unknown; redactedCommand?: unknown };
      };
      expect(normalized).toMatchObject({
        commandEvidence: {
          state: "available",
          redactedCommand: expect.stringMatching(
            /^printf ACCESS_TOKEN=\[\[REDACTED:assignment-access-token:hmac-sha256:[0-9a-f]{32}\]\]$/
          )
        }
      });
      expect(normalized.commandEvidence?.redactedCommand).toBe(normalized.command);
    }
    expect((await durableBytes(context.dataRoot)).includes(Buffer.from(sentinel))).toBe(false);
  });

  it("keeps bounded command evidence and numeric exit metadata when output truncates", async () => {
    const context = await fixture();
    await installCommandFixture(context.root, {
      command: "pnpm test",
      aggregatedOutput: "x".repeat(40 * 1024),
      exitCode: 17,
      status: "failed"
    });

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const command = detail(context.dataRoot, result.runId).events
      .find(({ kind }) => kind === "command");

    expect(command?.normalizedPayload).toMatchObject({
      truncated: true,
      exitCode: 17,
      commandEvidence: {
        state: "available",
        redactedCommand: "pnpm test"
      }
    });
  });

  it("truncates when command evidence pushes the final durable normalized payload above 32 KiB", async () => {
    const context = await fixture();
    const commandText = `pnpm test ${"x".repeat(8 * 1024)}`;
    const aggregatedOutput = "y".repeat(20 * 1024);
    const originalNormalized = {
      eventType: "item.completed",
      itemType: "command_execution",
      command: commandText,
      aggregatedOutput,
      exitCode: 23,
      status: "failed"
    };
    const augmentedNormalized = {
      ...originalNormalized,
      commandEvidence: { state: "available", redactedCommand: commandText }
    };
    expect(Buffer.byteLength(JSON.stringify(originalNormalized), "utf8"))
      .toBeLessThanOrEqual(32 * 1024);
    expect(Buffer.byteLength(JSON.stringify(augmentedNormalized), "utf8"))
      .toBeGreaterThan(32 * 1024);
    await installCommandFixture(context.root, {
      command: commandText,
      aggregatedOutput,
      exitCode: 23,
      status: "failed"
    });

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const command = detail(context.dataRoot, result.runId).events
      .find(({ kind }) => kind === "command");
    const normalized = command?.normalizedPayload as Record<string, unknown> | undefined;

    expect(normalized).toMatchObject({
      truncated: true,
      exitCode: 23,
      commandEvidence: { state: "available", redactedCommand: commandText }
    });
    expect(normalized).not.toHaveProperty("aggregatedOutput");
  });

  it("omits command evidence without retaining redactedCommand when the redacted UTF-8 value exceeds 16 KiB", async () => {
    const context = await fixture();
    await installCommandFixture(context.root, {
      command: `pnpm test ${"🙂".repeat(4_096)}`
    });

    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const command = detail(context.dataRoot, result.runId).events
      .find(({ kind }) => kind === "command");
    const normalized = command?.normalizedPayload as {
      commandEvidence?: Record<string, unknown>;
    } | undefined;

    expect(normalized?.commandEvidence).toEqual({
      state: "omitted",
      reason: "capture-bound"
    });
    expect(normalized?.commandEvidence).not.toHaveProperty("redactedCommand");
  });

  it("persists malformed stdout, unknown provider records, and stderr without losing the run", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=malformed-unknown-stderr"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const events = detail(context.dataRoot, result.runId).events;

    expect(result.status).toBe("completed");
    expect(events.filter(({ kind }) => kind === "recorder.stream_diagnostic")).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({
      kind: "source.unknown",
      nativePayload: { storage: "inline", redacted: { type: "future.event", future: { nested: 7 } } }
    }));
  });

  it("discards a 64 MiB source line content-free and records the following valid provider line", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=oversized-following"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const events = detail(context.dataRoot, result.runId).events;
    const oversized = events.filter(({ kind, normalizedPayload }) =>
      kind === "recorder.stream_diagnostic" &&
      (normalizedPayload as { reason?: unknown } | undefined)?.reason === "line_too_large"
    );

    expect(result.status).toBe("completed");
    expect(oversized).toHaveLength(1);
    expect(oversized[0]).toMatchObject({
      summary: "Oversized source line discarded",
      normalizedPayload: {
        stream: "stdout",
        reason: "line_too_large",
        limitBytes: 1_048_576,
        observedBytes: 64 * 1024 * 1024
      }
    });
    expect(events).toContainEqual(expect.objectContaining({
      kind: "source.unknown",
      source: expect.objectContaining({ eventType: "future.following" })
    }));
    expect((await durableBytes(context.dataRoot)).includes(Buffer.from("OVERSIZED_RAW_SENTINEL")))
      .toBe(false);
  }, 20_000);

  it("forwards buffered stdin bytes unchanged and closes child stdin", async () => {
    const context = await fixture();
    const stdinCapture = join(context.root, "stdin.bin");
    const original = Buffer.from([0x00, 0xff, 0x41, 0x0a, 0x42]);
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "-", "--fake-mode=stdin-echo"]
      },
      {
        cwd: context.repo,
        stdin: piped(original),
        env: { ...context.env, AGENTLENS_STDIN_CAPTURE: stdinCapture },
        stdout: silentOutput
      }
    );

    expect(result.status).toBe("completed");
    expect(await readFile(stdinCapture)).toEqual(original);
  });

  it("durably reconciles a recorder error when the child rejects buffered stdin", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "-", "--fake-mode=stdin-reject"]
      },
      {
        cwd: context.repo,
        stdin: piped(Buffer.alloc(8 * 1024 * 1024, 0x61)),
        env: context.env,
        stdout: silentOutput
      }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(result.status).toBe("recorder_error");
    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "error",
      provenance: "recorder"
    }));
    expect(run.events.at(-1)?.kind).toBe("run.reconciled");
  });

  it("keeps the run starting on spawn failure, appends validated recorder support, and reconciles", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, PATH: join(context.root, "missing-bin") },
        stdout: silentOutput
      }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(run.run).toMatchObject({
      status: "recorder_error",
      childPid: null,
      exitCode: null,
      terminatingSignal: null,
      providerTerminalKind: null
    });
    expect(run.events.map(({ kind }) => kind)).toEqual([
      "git.snapshot", "recorder.invocation", "error", "git.final_evidence", "run.reconciled"
    ]);
    expect(run.events[0]).toMatchObject({ provenance: "git_recovered" });
    expect(run.events[2]).toMatchObject({
      provenance: "recorder",
      normalizedPayload: { recorderFailure: true }
    });
    expect(run.events.some(({ kind }) => kind === "recorder.process_exit")).toBe(false);
  });

  it("records explicit interruption, nullable signal semantics, and one recovery for an open item", async () => {
    const context = await fixture();
    const controller = new AbortController();
    let printedRunId: string | undefined;
    const recording = recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=hang"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: {
          write: (chunk) => {
            const match = /Run ID: ([^\n]+)/.exec(String(chunk));
            if (match?.[1]) printedRunId = match[1];
            return true;
          }
        },
        signal: controller.signal
      }
    );
    await waitForOpenCommand(context.dataRoot, () => printedRunId);
    controller.abort();
    const result = await recording;
    const run = detail(context.dataRoot, result.runId);

    expect(result.status).toBe("interrupted");
    expect(run.run.exitCode).toBeNull();
    expect(run.run.terminatingSignal).toMatch(/^SIG/);
    expect(run.events.filter(({ kind }) => kind === "recorder.interruption")).toHaveLength(1);
    expect(run.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
    expect(run.events.find(({ kind }) => kind === "command")?.status).toBe("in_progress");
  });

  it("persists the actual SIGKILL fact after bounded escalation without inventing provider completion", async () => {
    if (process.platform === "win32") return;
    const context = await fixture();
    const controller = new AbortController();
    let printedRunId: string | undefined;
    const recording = recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=ignore-term"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: {
          ...context.env,
          AGENTLENS_FAKE_GRANDCHILD_FILE: join(context.root, "grandchild.pid")
        },
        stdout: {
          write: (chunk) => {
            const match = /Run ID: ([^\n]+)/.exec(String(chunk));
            if (match?.[1]) printedRunId = match[1];
            return true;
          }
        },
        signal: controller.signal,
        terminationGraceMs: 50
      }
    );
    await waitForOpenCommand(context.dataRoot, () => printedRunId);
    controller.abort();
    const result = await recording;
    const run = detail(context.dataRoot, result.runId);

    expect(result.status).toBe("interrupted");
    expect(run.run).toMatchObject({ exitCode: null, terminatingSignal: "SIGKILL" });
    expect(run.events.filter(({ kind }) => kind === "recorder.interruption")).toHaveLength(1);
    expect(run.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
    expect(run.events.some(({ kind, provenance }) =>
      kind === "turn.completed" && provenance === "observed"
    )).toBe(false);
    expect(run.events.find(({ kind }) => kind === "command")?.status).toBe("in_progress");
  });

  it("waits for a resistant descendant before final Git and preserves direct and group signals", async () => {
    if (process.platform === "win32") return;
    const context = await fixture();
    const controller = new AbortController();
    const grandchildFile = join(context.root, "cooperative-grandchild.pid");
    const grandchildTermFile = join(context.root, "cooperative-grandchild-term.log");
    let printedRunId: string | undefined;
    let groupGoneAtFinalGit = false;
    let ownershipAtFinalGit: string | undefined;
    let originalObservedCommand: string | undefined;

    const recording = recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: [
          "codex",
          "exec",
          "--json",
          "--fake-mode=cooperative-parent-resistant-grandchild"
        ]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: {
          ...context.env,
          AGENTLENS_FAKE_GRANDCHILD_FILE: grandchildFile,
          AGENTLENS_FAKE_GRANDCHILD_TERM_FILE: grandchildTermFile,
          AGENTLENS_FAKE_DESCENDANT_GIT_FILE: join(context.repo, "tracked.txt")
        },
        stdout: {
          write: (chunk) => {
            const match = /Run ID: ([^\n]+)/.exec(String(chunk));
            if (match?.[1]) printedRunId = match[1];
            return true;
          }
        },
        signal: controller.signal,
        terminationGraceMs: 75,
        onFinalGitPersisted: () => {
          if (!printedRunId) throw new Error("missing run ID at final Git boundary");
          const snapshot = detail(context.dataRoot, printedRunId);
          const groupId = snapshot.ownership?.childProcessGroupId;
          if (groupId === null || groupId === undefined) {
            throw new Error("missing process-group identity at final Git boundary");
          }
          try {
            process.kill(-groupId, 0);
          } catch {
            groupGoneAtFinalGit = true;
          }
          ownershipAtFinalGit = snapshot.ownership?.condition;
          expect(snapshot.gitEvidence).not.toBeNull();
        }
      }
    );
    await waitForOpenCommand(context.dataRoot, () => printedRunId);
    if (!printedRunId) throw new Error("missing run ID after open command");
    const openDetail = detail(context.dataRoot, printedRunId);
    const openGroupId = openDetail.ownership?.childProcessGroupId;
    if (openGroupId === null || openGroupId === undefined) {
      throw new Error("missing process-group identity after open command");
    }
    processGroups.push(openGroupId);
    originalObservedCommand = JSON.stringify(openDetail.events.find(({ kind }) => kind === "command"));
    controller.abort();
    const result = await recording;
    const run = detail(context.dataRoot, result.runId);
    const groupId = run.ownership?.childProcessGroupId;
    const grandchildPid = Number(await readFile(grandchildFile, "utf8"));
    const processExit = run.events.find(({ kind }) => kind === "recorder.process_exit");

    expect(result).toMatchObject({
      status: "interrupted",
      exitCode: null,
      terminatingSignal: "SIGTERM"
    });
    expect(processExit?.normalizedPayload).toMatchObject({
      exitCode: null,
      terminatingSignal: "SIGTERM",
      processGroupTermination: {
        processGroupId: groupId,
        initialSignal: "SIGTERM",
        escalationSignal: "SIGKILL",
        confirmedGone: true
      }
    });
    expect(await readFile(grandchildTermFile, "utf8")).toBe("term-observed\n");
    expect(await readFile(join(context.repo, "tracked.txt"), "utf8")).toBe("descendant after term\n");
    expect(groupGoneAtFinalGit).toBe(true);
    expect(ownershipAtFinalGit).toBe("active");
    expect(run.ownership?.condition).toBe("released");
    expect(() => process.kill(grandchildPid, 0)).toThrow();
    expect(() => process.kill(-(groupId ?? 0), 0)).toThrow();
    expect(run.events.filter(({ kind }) => kind === "recorder.interruption")).toHaveLength(1);
    expect(run.events.some(({ kind, provenance }) =>
      kind === "turn.completed" && provenance === "observed"
    )).toBe(false);
    expect(JSON.stringify(run.events.find(({ kind }) => kind === "command")))
      .toBe(originalObservedCommand);
  }, 10_000);

  it("leaves Git and ownership nonfinal when process-group disappearance cannot be confirmed", async () => {
    if (process.platform === "win32") return;
    const context = await fixture();
    const controller = new AbortController();
    let printedRunId: string | undefined;
    const recording = recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=hang"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: {
          write: (chunk) => {
            const match = /Run ID: ([^\n]+)/.exec(String(chunk));
            if (match?.[1]) printedRunId = match[1];
            return true;
          }
        },
        signal: controller.signal,
        terminationGraceMs: 25,
        inspectProcessGroup: () => "ambiguous"
      }
    );
    await waitForOpenCommand(context.dataRoot, () => printedRunId);
    if (!printedRunId) throw new Error("missing run ID after open command");
    const open = detail(context.dataRoot, printedRunId);
    const processGroupId = open.ownership?.childProcessGroupId;
    if (processGroupId === null || processGroupId === undefined) {
      throw new Error("missing process-group identity after open command");
    }
    processGroups.push(processGroupId);
    controller.abort();

    await expect(recording).rejects.toThrow("could not confirm owned process-group shutdown");
    const nonfinal = detail(context.dataRoot, printedRunId);
    expect(nonfinal.run).toMatchObject({ status: "running", endedAt: null });
    expect(nonfinal.ownership?.condition).toBe("active");
    expect(nonfinal.gitEvidence).toBeNull();
    expect(nonfinal.events.filter(({ kind }) => kind === "recorder.interruption")).toHaveLength(1);
    expect(nonfinal.events.filter(({ kind, provenance, normalizedPayload }) =>
      kind === "error" &&
      provenance === "recorder" &&
      typeof normalizedPayload === "object" &&
      normalizedPayload !== null &&
      !Array.isArray(normalizedPayload) &&
      (normalizedPayload as Record<string, unknown>).recorderFailure === true
    )).toHaveLength(1);
    expect(nonfinal.events.some(({ kind }) => kind === "run.reconciled")).toBe(false);
  }, 10_000);

  it("reconciles a signal received after child terminal and final Git persistence as interrupted", async () => {
    const context = await fixture();
    const controller = new AbortController();
    const lateSignalHook = { onFinalGitPersisted: () => controller.abort() };
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        ...lateSignalHook,
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        signal: controller.signal
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const interruption = run.events.filter(({ kind }) => kind === "recorder.interruption");
    const reconciled = run.events.at(-1);

    expect(result).toMatchObject({
      status: "interrupted",
      exitCode: 0,
      terminatingSignal: null
    });
    expect(interruption).toHaveLength(1);
    expect(reconciled).toMatchObject({
      kind: "run.reconciled",
      normalizedPayload: { status: "interrupted", explicitInterruption: true }
    });
    expect(reconciled?.relationships).toContainEqual({
      type: "derived_from",
      eventId: interruption[0]?.id
    });
  });

  it("preserves an interruption delivered immediately after open-event recovery", async () => {
    const context = await fixture();
    const controller = new AbortController();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=open-item"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        signal: controller.signal,
        onRecoveryAppended: () => controller.abort()
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const open = run.events.find(({ kind, source }) =>
      kind === "command" && source.itemId === "command-open"
    );

    expect(result).toMatchObject({
      status: "interrupted",
      exitCode: 0,
      terminatingSignal: null
    });
    expect(run.run).toMatchObject({
      status: "interrupted",
      exitCode: 0,
      terminatingSignal: null,
      terminalReason: "explicit_interruption",
      contradictionCodes: ["provider_completed_but_interrupted"]
    });
    expect(open).toMatchObject({ status: "in_progress", provenance: "observed" });
    expect(run.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
    expect(run.events.filter(({ kind }) => kind === "recorder.interruption")).toHaveLength(1);
    expect(run.events.filter(({ kind, provenance }) =>
      kind === "error" && provenance === "recorder"
    )).toEqual([]);
    expect(new Set(run.events.map(({ sequence }) => sequence)).size).toBe(run.events.length);
  });

  it("persists final Git evidence after a child commit even when status is clean", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=commit"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const gitEvidence = detail(context.dataRoot, result.runId).gitEvidence;

    expect(gitEvidence).toMatchObject({
      headChanged: true,
      finalStatus: { state: "artifact" },
      trackedFinalDiff: { state: "artifact" },
      diffCheck: { state: "artifact" },
      diffCheckPassed: true
    });
  });

  it("reconciles a recorder error when final Git evidence becomes unavailable", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=remove-git"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(result.status).toBe("recorder_error");
    expect(run.gitEvidence).toBeNull();
    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "recorder.process_exit",
      provenance: "recorder"
    }));
    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "error",
      provenance: "recorder",
      normalizedPayload: { recorderFailure: true, phase: "recording" }
    }));
    const providerTerminal = run.events.find(({ kind }) => kind === "turn.completed");
    const recorderFailure = run.events.find(({ kind }) => kind === "error");
    const reconciled = run.events.at(-1);
    expect(run.run.providerTerminalKind).toBe("completed");
    expect(reconciled?.kind).toBe("run.reconciled");
    expect(reconciled?.relationships).toEqual(expect.arrayContaining([
      { type: "derived_from", eventId: providerTerminal?.id },
      { type: "derived_from", eventId: recorderFailure?.id }
    ]));
  });

  it("records successive runs that share identical content-addressed artifacts", async () => {
    const context = await fixture();
    const command = {
      name: "record" as const,
      capture: "standard" as const,
      dataRoot: context.dataRoot,
      childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
    };

    const first = await recordRun(command, {
      cwd: context.repo,
      stdin: piped(),
      env: context.env,
      stdout: silentOutput
    });
    const second = await recordRun(command, {
      cwd: context.repo,
      stdin: piped(),
      env: context.env,
      stdout: silentOutput
    });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(second.runId).not.toBe(first.runId);
    expect(detail(context.dataRoot, first.runId).gitEvidence?.initialStatus).toEqual(
      detail(context.dataRoot, second.runId).gitEvidence?.initialStatus
    );
  });
});
