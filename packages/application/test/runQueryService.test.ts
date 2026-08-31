import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { codexExecCapabilities, type TraceEventV1 } from "@agentlens/core";
import {
  RunRepository,
  openDatabase,
  type CreateRunInput
} from "@agentlens/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RunQueryServiceError,
  createCursorCodec,
  createRunQueryService,
  createSourceRefProjector
} from "../src/index.js";

const roots: string[] = [];
const receivedAt = "2026-08-31T12:00:00.000Z";
const storageRequire = createRequire(new URL("../../storage/package.json", import.meta.url));

interface FixtureSqlite {
  prepare(sql: string): { run(...parameters: unknown[]): unknown };
  exec(sql: string): void;
  close(): void;
}

const FixtureDatabase = storageRequire("better-sqlite3") as new (path: string) => FixtureSqlite;

function run(id: string, startedAt: number): CreateRunInput {
  return {
    id,
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "fixture",
    capturePolicy: "standard",
    capturePolicyVersion: "1",
    redactionVersion: "1",
    repositoryFingerprint: "repo-fixture",
    repositoryDisplay: "fixture repository",
    startedAt
  };
}

function event(
  runId: string,
  id: string,
  sequence: number,
  overrides: Partial<TraceEventV1> = {}
): TraceEventV1 {
  return {
    id,
    runId,
    sequence,
    receivedAt: new Date(Date.parse(receivedAt) + sequence).toISOString(),
    kind: "message.agent",
    status: "completed",
    provenance: "observed",
    source: { provider: "codex-exec", itemId: id, eventType: "item.completed" },
    relationships: [],
    summary: `event ${sequence}`,
    normalizedPayload: { role: "agent", text: `safe ${sequence}` },
    ...overrides
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentlens-run-query-"));
  roots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(root, "agentlens.sqlite");
  const database = openDatabase(databasePath);
  const repository = new RunRepository(database, { artifactRoot });
  const create = (id: string, startedAt: number) => repository.createRun(run(id, startedAt), {
    recorderInstanceId: `recorder-${id}`,
    recorderPid: 4242,
    recorderStartToken: `token-${id}`,
    heartbeatAt: startedAt
  });
  return { root, artifactRoot, databasePath, database, repository, create };
}

function service(
  databasePath: string,
  artifactRoot: string,
  processIdentityInspector = {
    captureStartToken: async () => null,
    inspect: async () => "same" as const,
    inspectGroup: () => "alive" as const
  }
) {
  return createRunQueryService({
    databasePath,
    artifactRoot,
    cursorCodec: createCursorCodec(Buffer.alloc(32, 0x31)),
    sourceRefProjector: createSourceRefProjector(Buffer.alloc(32, 0x32)),
    processIdentityInspector,
    providerCapabilities: { forProvider: () => codexExecCapabilities }
  });
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RunQueryService", () => {
  it("uses the run row for existence when recorder ownership is missing", async () => {
    const setup = await fixture();
    setup.create("ownership-missing", 1);
    setup.repository.appendEvent(event("ownership-missing", "ownership-event", 0));
    const writable = new FixtureDatabase(setup.databasePath);
    writable.prepare("DELETE FROM run_ownership WHERE run_id = ?").run("ownership-missing");
    writable.close();
    setup.database.close();

    const query = service(setup.databasePath, setup.artifactRoot);
    await expect(query.getRun("ownership-missing")).resolves.toMatchObject({
      runId: "ownership-missing",
      ownership: { storedCondition: null, diagnosis: "unavailable" }
    });
    await expect(query.getEvents("ownership-missing", { limit: 10 })).resolves.toMatchObject({
      items: [{ eventId: "ownership-event" }]
    });
    await expect(query.getEvent("ownership-missing", "ownership-event")).resolves.toMatchObject({
      eventId: "ownership-event"
    });
    await expect(query.listRuns({ limit: 10 })).resolves.toMatchObject({
      items: [{
        runId: "ownership-missing",
        ownership: { storedCondition: null, diagnosis: "unavailable" }
      }]
    });
  });

  it("preserves every frozen run lifecycle status and conservative provider limitations", async () => {
    const setup = await fixture();
    const create = (id: string, startedAt: number) => setup.create(id, startedAt);
    create("status-starting", 1);
    create("status-running", 2);
    setup.repository.markRunning("status-running", {
      recorderInstanceId: "recorder-status-running",
      childPid: 5002,
      childStartToken: "child-running",
      childProcessGroupId: 5002,
      updatedAt: 2
    });

    for (const [id, startedAt, exitCode, signal, expectedStatus] of [
      ["status-completed", 3, 0, null, "completed"],
      ["status-failed", 4, 1, null, "failed"],
      ["status-interrupted", 5, null, "SIGINT", "interrupted"]
    ] as const) {
      create(id, startedAt);
      setup.repository.markRunning(id, {
        recorderInstanceId: `recorder-${id}`,
        childPid: 5000 + startedAt,
        childStartToken: `child-${id}`,
        childProcessGroupId: 5000 + startedAt,
        updatedAt: startedAt
      });
      const processEventId = `${id}-process`;
      setup.repository.appendEvent(event(id, processEventId, 0, {
        kind: "recorder.process_exit",
        status: signal === null ? (exitCode === 0 ? "completed" : "failed") : "interrupted",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: id },
        normalizedPayload: { exitCode, terminatingSignal: signal }
      }));
      setup.repository.recordProcessFact(id, { eventId: processEventId });
      const providerTerminalEventId = signal === null ? `${id}-provider-terminal` : undefined;
      if (providerTerminalEventId !== undefined) {
        const kind = exitCode === 0 ? "turn.completed" : "turn.failed";
        setup.repository.appendEvent(event(id, providerTerminalEventId, 1, {
          kind,
          status: exitCode === 0 ? "completed" : "failed",
          provenance: "observed",
          source: { provider: "codex-exec", eventType: kind }
        }));
      }
      expect(setup.repository.reconcileRun(id, {
        eventId: `${id}-reconciled`,
        receivedAt,
        endedAt: startedAt + 10,
        ...(providerTerminalEventId === undefined ? {} : { providerTerminalEventId })
      }).status).toBe(expectedStatus);
    }

    create("status-recorder-error", 6);
    setup.repository.appendEvent(event("status-recorder-error", "status-recorder-error-fact", 0, {
      kind: "error",
      status: "failed",
      provenance: "recorder",
      source: { provider: "codex-exec", correlationId: "status-recorder-error" },
      normalizedPayload: { recorderFailure: true }
    }));
    setup.repository.reconcileRun("status-recorder-error", {
      eventId: "status-recorder-error-reconciled",
      receivedAt,
      endedAt: 16,
      recorderFailureEventId: "status-recorder-error-fact"
    });
    setup.database.close();

    const page = await service(setup.databasePath, setup.artifactRoot).listRuns({ limit: 10 });
    expect(new Map(page.items.map((item) => [item.runId, item.status]))).toEqual(new Map([
      ["status-recorder-error", { state: "known", value: "recorder_error" }],
      ["status-interrupted", { state: "known", value: "interrupted" }],
      ["status-failed", { state: "known", value: "failed" }],
      ["status-completed", { state: "known", value: "completed" }],
      ["status-running", { state: "known", value: "running" }],
      ["status-starting", { state: "known", value: "starting" }]
    ]));
    expect(page.items[0]?.summary.providerCapabilityLimitations).toMatchObject({
      state: "available",
      value: expect.arrayContaining([
        { capability: "file_reads", availability: "unavailable" },
        { capability: "tool_output", availability: "partial" }
      ])
    });
    expect(page.items.find(({ runId }) => runId === "status-completed")?.ownership)
      .toMatchObject({ diagnosis: "released" });
  });

  it("batches a 100-run page without detail hydration and preserves lifecycle summaries", async () => {
    const setup = await fixture();
    for (let index = 0; index < 100; index += 1) setup.create(`run-${index.toString().padStart(3, "0")}`, index);
    setup.repository.saveGitEvidence("run-099", {
      initialHead: "a".repeat(40),
      finalHead: "b".repeat(40),
      initialBranch: "main",
      finalBranch: "task",
      initialStatus: { state: "omitted", reason: "metadata-only" },
      finalStatus: { state: "omitted", reason: "metadata-only" },
      trackedFinalDiff: { state: "absent" },
      diffCheck: { state: "omitted", reason: "metadata-only" },
      diffCheckPassed: true,
      untrackedMetadata: { state: "absent" },
      headChanged: true,
      branchChanged: true,
      capturedAt: 100
    });
    await setup.repository.updateAssessment({
      runId: "run-099",
      eventId: "assessment-099",
      receivedAt,
      verdict: "success",
      taskCompleted: "yes"
    });
    const writable = new FixtureDatabase(setup.databasePath);
    writable.prepare("UPDATE runs SET status = 'completed', ended_at = 200 WHERE id <> ?")
      .run("run-099");
    writable.prepare("UPDATE run_ownership SET condition = 'released' WHERE run_id <> ?")
      .run("run-099");
    writable.close();
    setup.database.close();

    const list = vi.spyOn(RunRepository.prototype, "listRunPage");
    const summaries = vi.spyOn(RunRepository.prototype, "getRunSummaryBatch");
    const details = vi.spyOn(RunRepository.prototype, "getRunDetail");
    const ownership = vi.spyOn(RunRepository.prototype, "getOwnership");
    const ownershipBatch = vi.spyOn(RunRepository.prototype, "getOwnershipBatch");
    const inspector = {
      captureStartToken: vi.fn(async () => null),
      inspect: vi.fn(async () => "same" as const),
      inspectGroup: vi.fn(() => "alive" as const)
    };
    const before = await digest(setup.databasePath);
    const page = await service(setup.databasePath, setup.artifactRoot, inspector)
      .listRuns({ limit: 100 });

    expect(page.items).toHaveLength(100);
    expect(page.items[0]).toMatchObject({
      runId: "run-099",
      status: { state: "known", value: "starting" },
      ownership: { diagnosis: "active" },
      finalGitEvidence: { state: "available", headChanged: true, branchChanged: true },
      warningCodes: ["git_head_changed", "git_branch_changed"],
      summary: {
        assessment: { state: "explicit", provenance: "human", verdict: "success" },
        likelyTests: { state: "none_detected" }
      }
    });
    expect(page.nextCursor).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    expect(summaries).toHaveBeenCalledTimes(1);
    expect(details).not.toHaveBeenCalled();
    expect(ownership).not.toHaveBeenCalled();
    expect(ownershipBatch).toHaveBeenCalledTimes(1);
    expect(inspector.inspect).toHaveBeenCalledTimes(1);
    expect(await digest(setup.databasePath)).toBe(before);
  });

  it("projects run anchors, relationships, recovery labels, and browser-safe event details", async () => {
    const setup = await fixture();
    setup.create("run-detail", 1);
    setup.repository.appendEvent(event("run-detail", "command-open", 0, {
      kind: "command",
      status: "in_progress",
      source: { provider: "codex-exec", itemId: "native-command", eventType: "item.started", itemType: "command_execution" },
      normalizedPayload: { command: "pnpm test" }
    }));
    setup.repository.appendEvent(event("run-detail", "command-failed", 1, {
      kind: "command",
      status: "failed",
      source: { provider: "codex-exec", itemId: "failed-command", eventType: "item.failed", itemType: "command_execution" },
      normalizedPayload: { command: "pnpm test", exitCode: 1 }
    }));
    setup.repository.appendEvent(event("run-detail", "test-result", 2, {
      kind: "test.result",
      status: "failed",
      provenance: "derived",
      source: { provider: "codex-exec" },
      relationships: [{ type: "derived_from", eventId: "command-failed" }],
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["command-failed"],
        confidence: "high",
        identity: "derivation-fixture"
      },
      normalizedPayload: { family: "pnpm", outcome: "failed" }
    }));
    setup.repository.appendEvent(event("run-detail", "recovery", 3, {
      kind: "recorder.recovery",
      status: "interrupted",
      provenance: "recorder",
      source: { provider: "codex-exec", itemId: "native-command", eventType: "recorder.recovery", itemType: "command_execution" },
      relationships: [{ type: "recovers", eventId: "command-open" }],
      normalizedPayload: { recoveredEventId: "command-open" }
    }));
    setup.repository.appendEvent(event("run-detail", "git-final", 4, {
      kind: "git.final_evidence",
      provenance: "git_recovered"
    }));
    setup.repository.appendEvent(event("run-detail", "future-kind", 5, {
      kind: "future.provider.event"
    }));
    setup.database.close();

    const query = service(setup.databasePath, setup.artifactRoot);
    const detail = await query.getRun("run-detail");
    expect(detail).toMatchObject({
      runId: "run-detail",
      eventCount: 6,
      anchors: {
        firstFailure: { eventId: "command-failed", sequence: 1 },
        recorderRecovery: { eventId: "recovery", sequence: 3 },
        latestLikelyTest: { eventId: "test-result", sequence: 2 },
        finalGitEvidence: { eventId: "git-final", sequence: 4 },
        latestEvent: { eventId: "future-kind", sequence: 5 }
      }
    });
    const recovery = await query.getEvent("run-detail", "recovery");
    expect(recovery).toMatchObject({
      presentationClass: "recorder_recovery",
      recoveredEventIds: ["command-open"]
    });
    const unknown = await query.getEvent("run-detail", "future-kind");
    expect(unknown).toMatchObject({
      presentationClass: "unknown",
      content: { state: "unavailable", reason: "unsupported_kind" }
    });
    expect(JSON.stringify([detail, recovery, unknown])).not.toContain("native-command");
    expect(await query.getRun("missing-run")).toBeNull();
    expect(await query.getEvent("run-detail", "missing-event")).toBeNull();
  });

  it("uses terminal head, active tail, polling, around, and snapshot-bound cursors", async () => {
    const setup = await fixture();
    setup.create("terminal-run", 1);
    setup.create("active-run", 2);
    for (let sequence = 0; sequence < 6; sequence += 1) {
      setup.repository.appendEvent(event("terminal-run", `terminal-${sequence}`, sequence));
      setup.repository.appendEvent(event("active-run", `active-${sequence}`, sequence));
    }
    setup.repository.appendEvent(event("terminal-run", "recorder-failure", 6, {
      kind: "error",
      status: "failed",
      provenance: "recorder",
      source: { provider: "codex-exec", correlationId: "terminal-run" },
      normalizedPayload: { recorderFailure: true }
    }));
    setup.repository.reconcileRun("terminal-run", {
      eventId: "terminal-reconciled",
      receivedAt,
      endedAt: 10,
      recorderFailureEventId: "recorder-failure"
    });
    setup.database.close();

    const query = service(setup.databasePath, setup.artifactRoot);
    const terminal = await query.getEvents("terminal-run", { limit: 2 });
    const active = await query.getEvents("active-run", { limit: 2 });
    expect(terminal.mode).toBe("head");
    expect(terminal.items.map(({ sequence }) => sequence)).toEqual([0, 1]);
    expect(active.mode).toBe("tail");
    expect(active.items.map(({ sequence }) => sequence)).toEqual([4, 5]);
    expect((await query.getEvents("terminal-run", { limit: 2, afterSequence: 2 })).items
      .map(({ sequence }) => sequence)).toEqual([3, 4]);
    expect((await query.getEvents("terminal-run", { limit: 3, aroundSequence: 3 })).items
      .map(({ sequence }) => sequence)).toEqual([2, 3, 4]);

    if (terminal.window.state !== "nonempty" || terminal.window.laterCursor === null) {
      throw new Error("expected a later cursor");
    }
    const next = await query.getEvents("terminal-run", {
      limit: 2,
      cursor: terminal.window.laterCursor
    });
    expect(next.mode).toBe("cursor");
    expect(next.items.map(({ sequence }) => sequence)).toEqual([2, 3]);
    if (next.window.state !== "nonempty" || next.window.earlierCursor === null) {
      throw new Error("expected an earlier cursor");
    }
    const previous = await query.getEvents("terminal-run", {
      limit: 2,
      cursor: next.window.earlierCursor
    });
    expect(previous.items.map(({ sequence }) => sequence)).toEqual([0, 1]);
    await expect(query.getEvents("active-run", {
      limit: 2,
      cursor: terminal.window.laterCursor
    })).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(query.getEvents("terminal-run", {
      limit: 2,
      cursor: `${terminal.window.laterCursor}x`
    })).rejects.toBeInstanceOf(RunQueryServiceError);
    await expect(query.getEvents("terminal-run", {
      limit: 2,
      cursor: terminal.window.laterCursor,
      afterSequence: 1
    })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("returns a true zero-event window without inventing sequence zero", async () => {
    const setup = await fixture();
    setup.create("empty-run", 1);
    setup.database.close();

    const page = await service(setup.databasePath, setup.artifactRoot)
      .getEvents("empty-run", { limit: 100 });
    expect(page).toMatchObject({
      mode: "tail",
      items: [],
      window: {
        state: "empty",
        latestCommittedSequence: null,
        hasEarlier: false,
        hasLater: false
      }
    });
  });

  it("keeps an empty after-poll earlier cursor adjacent to its captured snapshot", async () => {
    const setup = await fixture();
    setup.create("empty-poll-adjacency", 1);
    for (let sequence = 0; sequence < 4; sequence += 1) {
      setup.repository.appendEvent(event(
        "empty-poll-adjacency",
        `empty-poll-${sequence}`,
        sequence
      ));
    }
    setup.database.close();

    const query = service(setup.databasePath, setup.artifactRoot);
    const empty = await query.getEvents("empty-poll-adjacency", {
      limit: 2,
      afterSequence: 3
    });
    expect(empty).toMatchObject({
      items: [],
      window: {
        state: "empty",
        latestCommittedSequence: 3,
        hasEarlier: true
      }
    });
    if (empty.window.state !== "empty" || empty.window.earlierCursor === null) {
      throw new Error("expected an earlier cursor through the empty poll snapshot");
    }

    const previous = await query.getEvents("empty-poll-adjacency", {
      limit: 2,
      cursor: empty.window.earlierCursor
    });
    expect(previous.items.map(({ sequence }) => sequence)).toEqual([2, 3]);
  });

  it("keeps cursor pages on their captured snapshot while polling sees later WAL commits", async () => {
    const setup = await fixture();
    setup.create("active-snapshot", 1);
    for (let sequence = 0; sequence < 4; sequence += 1) {
      setup.repository.appendEvent(event("active-snapshot", `snapshot-${sequence}`, sequence));
    }
    await Promise.all([
      chmod(setup.databasePath, 0o600),
      chmod(`${setup.databasePath}-wal`, 0o600),
      chmod(`${setup.databasePath}-shm`, 0o600)
    ]);

    const query = service(setup.databasePath, setup.artifactRoot);
    const first = await query.getEvents("active-snapshot", { limit: 2, aroundSequence: 0 });
    if (first.window.state !== "nonempty" || first.window.laterCursor === null) {
      throw new Error("expected a snapshot-bound later cursor");
    }
    expect(first.window.latestCommittedSequence).toBe(3);

    setup.repository.appendEvent(event("active-snapshot", "snapshot-4", 4));
    setup.repository.appendEvent(event("active-snapshot", "snapshot-5", 5));

    const captured = await query.getEvents("active-snapshot", {
      limit: 10,
      cursor: first.window.laterCursor
    });
    expect(captured.items.map(({ sequence }) => sequence)).toEqual([2, 3]);
    expect(captured.window.latestCommittedSequence).toBe(3);

    const polled = await query.getEvents("active-snapshot", {
      limit: 10,
      afterSequence: 3
    });
    expect(polled.items.map(({ sequence }) => sequence)).toEqual([4, 5]);
    expect(polled.window.latestCommittedSequence).toBe(5);
    setup.database.close();
  });

  it("normalizes active sidecar snapshot failures without exposing their cause", async () => {
    const setup = await fixture();
    setup.create("active-unavailable", 1);
    setup.database.close();
    await writeFile(`${setup.databasePath}-wal`, "invalid WAL fixture", { mode: 0o600 });
    await writeFile(`${setup.databasePath}-shm`, "invalid SHM fixture", { mode: 0o600 });
    await chmod(setup.databasePath, 0o600);

    const failure = service(setup.databasePath, setup.artifactRoot).listRuns({ limit: 1 });
    await expect(failure).rejects.toMatchObject({ code: "active_snapshot_unavailable" });
    await expect(failure).rejects.not.toThrow(setup.databasePath);
  });

  it("holds one SQLite snapshot across run status, default mode, and event rows", async () => {
    const setup = await fixture();
    setup.create("snapshot-request", 1);
    setup.repository.appendEvent(event("snapshot-request", "before-0", 0));
    setup.repository.appendEvent(event("snapshot-request", "before-1", 1));
    await Promise.all([
      chmod(setup.databasePath, 0o600),
      chmod(`${setup.databasePath}-wal`, 0o600),
      chmod(`${setup.databasePath}-shm`, 0o600)
    ]);

    const original = RunRepository.prototype.getEventWindow;
    let writerCommitted = false;
    vi.spyOn(RunRepository.prototype, "getEventWindow").mockImplementation(function (...args) {
      if (!writerCommitted) {
        writerCommitted = true;
        setup.repository.appendEvent(event("snapshot-request", "after-failure", 2, {
          kind: "error",
          status: "failed",
          provenance: "recorder",
          source: { provider: "codex-exec", correlationId: "snapshot-request" },
          normalizedPayload: { recorderFailure: true }
        }));
        setup.repository.reconcileRun("snapshot-request", {
          eventId: "after-reconciled",
          receivedAt,
          endedAt: 20,
          recorderFailureEventId: "after-failure"
        });
      }
      return original.apply(this, args);
    });

    const page = await service(setup.databasePath, setup.artifactRoot)
      .getEvents("snapshot-request", { limit: 10 });
    expect(writerCommitted).toBe(true);
    expect(page.mode).toBe("tail");
    expect(page.items.map(({ eventId }) => eventId)).toEqual(["before-0", "before-1"]);
    expect(page.window.latestCommittedSequence).toBe(1);
    setup.database.close();
  });

  it("rejects a cursor whose captured snapshot is ahead of durable latest", async () => {
    const setup = await fixture();
    setup.create("cursor-rewind", 1);
    for (let sequence = 0; sequence < 4; sequence += 1) {
      setup.repository.appendEvent(event("cursor-rewind", `rewind-${sequence}`, sequence));
    }
    setup.database.close();

    const query = service(setup.databasePath, setup.artifactRoot);
    const first = await query.getEvents("cursor-rewind", { limit: 2, aroundSequence: 0 });
    if (first.window.state !== "nonempty" || first.window.laterCursor === null) {
      throw new Error("expected rewind fixture cursor");
    }
    expect(first.window.latestCommittedSequence).toBe(3);

    const writable = new FixtureDatabase(setup.databasePath);
    writable.exec("PRAGMA foreign_keys = ON");
    writable.prepare(`
      DELETE FROM event_sources
      WHERE run_id = ? AND event_id IN (
        SELECT id FROM events WHERE run_id = ? AND sequence > ?
      )
    `).run("cursor-rewind", "cursor-rewind", 1);
    writable.prepare("DELETE FROM events WHERE run_id = ? AND sequence > ?")
      .run("cursor-rewind", 1);
    writable.close();

    await expect(query.getEvents("cursor-rewind", {
      limit: 2,
      cursor: first.window.laterCursor
    })).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("uses bounded metadata and exact-event reads without hydrating RunDetail", async () => {
    const setup = await fixture();
    setup.create("bounded-read", 1);
    for (let sequence = 0; sequence < 10; sequence += 1) {
      setup.repository.appendEvent(event("bounded-read", `bounded-${sequence}`, sequence));
    }
    setup.database.close();

    const getRunDetail = vi.spyOn(RunRepository.prototype, "getRunDetail");
    const readEvents = vi.spyOn(RunRepository.prototype, "readEvents");
    const getArtifactForRun = vi.spyOn(RunRepository.prototype, "getArtifactForRun");
    const query = service(setup.databasePath, setup.artifactRoot);

    await expect(query.getRun("bounded-read")).resolves.toMatchObject({
      runId: "bounded-read",
      eventCount: 10,
      anchors: { latestEvent: { eventId: "bounded-9", sequence: 9 } }
    });
    await expect(query.getEvents("bounded-read", { limit: 1, aroundSequence: 5 }))
      .resolves.toMatchObject({ items: [{ eventId: "bounded-5" }] });
    await expect(query.getEvent("bounded-read", "bounded-5"))
      .resolves.toMatchObject({ eventId: "bounded-5" });

    expect(getRunDetail).not.toHaveBeenCalled();
    expect(readEvents).not.toHaveBeenCalled();
    expect(getArtifactForRun).not.toHaveBeenCalled();
  });
});
