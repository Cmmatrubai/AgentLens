import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { CompletedArtifact, EventStatus, TraceEventV1 } from "@agentlens/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, openDatabaseReadOnly } from "../src/database.js";
import {
  RunRepository,
  Task7StorageCapabilityError,
  type AppendDerivedEventInput,
  type CreateRecorderOwnershipInput,
  type CreateRunInput,
  type GitEvidenceInput,
  type ReconciliationInput
} from "../src/runRepository.js";

const temporaryRoots: string[] = [];
const runId = "run-001";
const receivedAt = "2026-08-26T20:00:00.000Z";
const execFile = promisify(execFileCallback);

const appendDerivedRaceScript = `
  const { createRequire } = await import("node:module");
  const { existsSync, writeFileSync } = await import("node:fs");
  const raceRequire = createRequire(process.env.AGENTLENS_RACE_STORAGE_MODULE);
  const coreModule = raceRequire.resolve("@agentlens/core");
  const storage = await import(process.env.AGENTLENS_RACE_STORAGE_MODULE);
  const database = storage.openDatabase(process.env.AGENTLENS_RACE_DATABASE);
  const repository = new storage.RunRepository(database, {
    artifactRoot: process.env.AGENTLENS_RACE_ARTIFACT_ROOT
  });
  writeFileSync(process.env.AGENTLENS_RACE_READY, "ready");
  try {
    while (!existsSync(process.env.AGENTLENS_RACE_START)) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const event = repository.appendDerivedEvent(
      JSON.parse(process.env.AGENTLENS_RACE_INPUT)
    );
    process.stdout.write(JSON.stringify({ event, coreModule }));
  } finally {
    database.close();
  }
`;

function setup(runOverrides: Partial<CreateRunInput> = {}): {
  repository: RunRepository;
  databasePath: string;
  artifactRoot: string;
  close: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-repository-"));
  temporaryRoots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(root, "agentlens.sqlite");
  const database = openDatabase(databasePath);
  const repository = new RunRepository(database, { artifactRoot });
  repository.createRun(validRun(runOverrides), validOwnership());
  return { repository, databasePath, artifactRoot, close: () => database.close() };
}

function setupMigration003(): { repository: RunRepository; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-repository-v3-"));
  temporaryRoots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(root, "agentlens.sqlite");
  const priorSqliteUri = process.env.SQLITE_USE_URI;
  process.env.SQLITE_USE_URI = "1";
  let writable: Database.Database;
  try {
    writable = new Database(databasePath);
  } finally {
    if (priorSqliteUri === undefined) delete process.env.SQLITE_USE_URI;
    else process.env.SQLITE_USE_URI = priorSqliteUri;
  }
  writable.pragma("foreign_keys = ON");
  for (const [version, filename] of [
    [1, "001_initial.sql"],
    [2, "002_storage_invariants.sql"],
    [3, "003_recorder_ownership.sql"]
  ] as const) {
    writable.exec(readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8"));
    writable.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(version, version);
  }
  const run = validRun({ id: "legacy-run" });
  writable.prepare(`
    INSERT INTO runs (
      id, schema_version, provider, integration_version, agent_version, status,
      capture_policy, capture_policy_version, redaction_version, label, prompt_source,
      repository_fingerprint, repository_display, started_at
    ) VALUES (
      @id, @schemaVersion, @provider, @integrationVersion, @agentVersion, 'starting',
      @capturePolicy, @capturePolicyVersion, @redactionVersion, NULL, NULL,
      @repositoryFingerprint, @repositoryDisplay, @startedAt
    )
  `).run(run);
  writable.prepare(`
    INSERT INTO run_ownership (
      run_id, recorder_instance_id, recorder_pid, recorder_start_token,
      heartbeat_at, condition, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run("legacy-run", "legacy-recorder", 303, "legacy-start-token", run.startedAt, run.startedAt);
  writable.close();

  const database = openDatabaseReadOnly(databasePath);
  return {
    repository: new RunRepository(database, { artifactRoot }),
    close: () => database.close()
  };
}

function validOwnership(
  overrides: Partial<CreateRecorderOwnershipInput> = {}
): CreateRecorderOwnershipInput {
  return {
    recorderInstanceId: "recorder-instance-1",
    recorderPid: 101,
    recorderStartToken: "start-token-101",
    heartbeatAt: 1_777_777_777_000,
    ...overrides
  };
}

function runningInput(childPid = 42) {
  return {
    recorderInstanceId: "recorder-instance-1",
    childPid,
    childStartToken: `start-token-${childPid}`,
    childProcessGroupId: childPid,
    updatedAt: 1_777_777_777_500
  };
}

function validRun(overrides: Partial<CreateRunInput> = {}): CreateRunInput {
  return {
    id: runId,
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "0.149.0-alpha.4",
    capturePolicy: "standard",
    capturePolicyVersion: "1",
    redactionVersion: "1",
    repositoryFingerprint: "repo-fingerprint",
    repositoryDisplay: "fixture-repository",
    startedAt: 1_777_777_777_000,
    ...overrides
  };
}

function event(
  id: string,
  sequence: number,
  status: EventStatus,
  overrides: Partial<TraceEventV1> = {}
): TraceEventV1 {
  return {
    id,
    runId,
    sequence,
    receivedAt,
    kind: "command",
    status,
    provenance: "observed",
    source: {
      provider: "codex-exec",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      eventType: status === "in_progress" ? "item.started" : "item.completed",
      itemType: "command_execution"
    },
    relationships: [],
    summary: `Command ${status}`,
    normalizedPayload: { status },
    nativePayload: { storage: "inline", redacted: { status } },
    ...overrides
  };
}

function derivedInput(
  kind: "test.command" | "test.result",
  overrides: Partial<AppendDerivedEventInput> = {}
): AppendDerivedEventInput {
  const digest = kind === "test.command"
    ? "2b7fa57722f5615e2528d7bcbebdcd6383149cd393f0128b37e0b6a1392636f3"
    : "3bb5d4c9d15e7db172c2f88549334706cc45009f33106beaa13b60308be3ae7a";
  const result = kind === "test.result";
  return {
    identity: `agentlens-derivation-sha256:${digest}`,
    sourceEventId: "source-event",
    eventId: `drv_${digest}`,
    receivedAt: "2026-08-26T20:00:01.000Z",
    kind,
    status: "completed",
    sourceProvider: "codex-exec",
    summary: result
      ? "Likely pytest test result: passed (high confidence)"
      : "Likely pytest test command (high confidence)",
    normalizedPayload: result
      ? {
          family: "pytest",
          confidence: "high",
          outcome: "passed",
          exitCode: 0,
          derivationId: "test-command/1"
        }
      : {
          family: "pytest",
          confidence: "high",
          derivationId: "test-command/1"
        },
    derivation: {
      name: "test-command",
      version: "1",
      identity: `agentlens-derivation-sha256:${digest}`,
      confidence: "high"
    },
    ...overrides
  };
}

function completedAssessmentNote(
  artifactRoot: string,
  content: string,
  overrides: Partial<CompletedArtifact> = {}
): CompletedArtifact {
  const bytes = Buffer.from(content, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = join(artifactRoot, sha256.slice(0, 2), sha256);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { mode: 0o600 });
  return {
    id: sha256,
    runId,
    kind: "assessment-note",
    mediaType: "text/plain; charset=utf-8",
    path,
    sha256,
    byteLength: bytes.byteLength,
    redactionState: "redacted",
    truncated: false,
    originalByteLength: bytes.byteLength,
    ...overrides
  };
}

function queryRows(
  databasePath: string,
  sql: string,
  ...parameters: readonly unknown[]
): unknown[] {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database.prepare(sql).all(...parameters);
  } finally {
    database.close();
  }
}

function sqliteContains(databasePath: string, value: string): boolean {
  const needle = Buffer.from(value, "utf8");
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .filter(existsSync)
    .some((path) => readFileSync(path).includes(needle));
}

async function waitForFiles(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (paths.every((path) => existsSync(path))) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for concurrent repository connections.");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("append-only events and recovery", () => {
  const providerTerminalCases: readonly {
    name: string;
    started: Pick<TraceEventV1, "kind" | "source">;
    terminal: Pick<TraceEventV1, "kind" | "status" | "source">;
  }[] = [
    {
      name: "a declined item.completed status",
      started: {
        kind: "command",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.started",
          itemType: "command_execution"
        }
      },
      terminal: {
        kind: "command",
        status: "declined",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.completed",
          itemType: "command_execution"
        }
      }
    },
    {
      name: "an item.completed event with unknown canonical status",
      started: {
        kind: "command",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.started",
          itemType: "command_execution"
        }
      },
      terminal: {
        kind: "command",
        status: "unknown",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.completed",
          itemType: "command_execution"
        }
      }
    },
    {
      name: "an item.failed event with unknown canonical status",
      started: {
        kind: "command",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.started",
          itemType: "command_execution"
        }
      },
      terminal: {
        kind: "command",
        status: "unknown",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.failed",
          itemType: "command_execution"
        }
      }
    },
    {
      name: "a tool.completed event with unknown canonical status",
      started: {
        kind: "tool",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          toolId: "tool-1",
          eventType: "tool.started",
          itemType: "mcp_tool_call"
        }
      },
      terminal: {
        kind: "tool",
        status: "unknown",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          toolId: "tool-1",
          eventType: "tool.completed",
          itemType: "mcp_tool_call"
        }
      }
    }
  ];

  it.each([
    {
      name: "thread.started even when it carries an incidental item ID",
      kind: "thread.started",
      source: {
        provider: "codex-exec" as const,
        threadId: "fixture-thread",
        itemId: "incidental-item-id",
        eventType: "thread.started"
      }
    },
    {
      name: "ID-less turn.started",
      kind: "turn.started",
      source: {
        provider: "codex-exec" as const,
        threadId: "fixture-thread",
        turnId: "fixture-turn",
        eventType: "turn.started"
      }
    }
  ])("does not invent recovery for $name", ({ kind, source }) => {
    const { repository, close } = setup();
    try {
      const started = repository.appendEvent(event("provider-start", 0, "in_progress", {
        kind,
        source
      }));

      expect(repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      })).toEqual([]);
      expect(repository.getRunDetail(runId).events).toEqual([started]);
    } finally {
      close();
    }
  });

  it("does not invent recovery after a successful normal provider run", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("thread-start", 0, "in_progress", {
        kind: "thread.started",
        source: {
          provider: "codex-exec",
          threadId: "fixture-thread",
          eventType: "thread.started"
        }
      }));
      repository.appendEvent(event("turn-start", 1, "in_progress", {
        kind: "turn.started",
        source: {
          provider: "codex-exec",
          threadId: "fixture-thread",
          turnId: "fixture-turn",
          eventType: "turn.started"
        }
      }));
      repository.appendEvent(event("turn-complete", 2, "completed", {
        kind: "turn.completed",
        source: {
          provider: "codex-exec",
          threadId: "fixture-thread",
          turnId: "fixture-turn",
          eventType: "turn.completed"
        }
      }));

      expect(repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      })).toEqual([]);
      expect(repository.getRunDetail(runId).events).toHaveLength(3);
    } finally {
      close();
    }
  });

  it("appends recorder recovery without mutating the observed start byte-for-byte", () => {
    const { repository, close } = setup();
    try {
      const started = repository.appendEvent(event("event-start", 0, "in_progress"));
      const recovered = repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      });

      const events = repository.getRunDetail(runId).events;
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({
        id: "recovery-event-start",
        source: {
          provider: "codex-exec",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          itemType: "command_execution",
          eventType: "recorder.recovery"
        },
        relationships: [{ type: "recovers", eventId: started.id }]
      });
      expect(events[0]).toEqual(started);
      expect(events[0]?.status).toBe("in_progress");
      expect(events[1]).toMatchObject({
        kind: "recorder.recovery",
        provenance: "recorder",
        status: "interrupted"
      });
      expect(events[1]?.relationships).toContainEqual({ type: "recovers", eventId: started.id });
    } finally {
      close();
    }
  });

  it("keeps a same-item unknown progress observation open for recovery", () => {
    const { repository, close } = setup();
    try {
      const started = repository.appendEvent(event("event-start", 0, "in_progress"));
      const progress = repository.appendEvent(event("event-progress", 1, "unknown", {
        source: {
          provider: "codex-exec",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.progress",
          itemType: "command_execution"
        }
      }));

      const recovered = repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      });

      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({
        id: "recovery-event-start",
        relationships: [{ type: "recovers", eventId: started.id }]
      });
      expect(repository.getRunDetail(runId).events).toEqual([
        started,
        progress,
        recovered[0]
      ]);
    } finally {
      close();
    }
  });

  it.each(providerTerminalCases)("does not automatically recover after $name", (testCase) => {
    const { repository, close } = setup();
    try {
      const started = repository.appendEvent(event("event-start", 0, "in_progress", testCase.started));
      const terminal = repository.appendEvent(event(
        "event-terminal",
        1,
        testCase.terminal.status,
        testCase.terminal
      ));

      expect(repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      })).toEqual([]);
      expect(repository.getRunDetail(runId).events).toEqual([started, terminal]);
    } finally {
      close();
    }
  });

  it.each(providerTerminalCases)("rejects manual recovery after $name", (testCase) => {
    const { repository, close } = setup();
    try {
      const started = repository.appendEvent(event("event-start", 0, "in_progress", testCase.started));
      const terminal = repository.appendEvent(event(
        "event-terminal",
        1,
        testCase.terminal.status,
        testCase.terminal
      ));
      const manualRecovery = event("manual-recovery", 2, "interrupted", {
        kind: "recorder.recovery",
        provenance: "recorder",
        source: { ...testCase.started.source, eventType: "recorder.recovery" },
        relationships: [{ type: "recovers", eventId: started.id }]
      });

      expect(() => repository.appendEvent(manualRecovery)).toThrow(/observed terminal event/i);
      expect(repository.getRunDetail(runId).events).toEqual([started, terminal]);
    } finally {
      close();
    }
  });

  it("recovers an open provider tool lifecycle with a stable tool identity", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("tool-start", 0, "in_progress", {
        kind: "tool",
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          toolId: "tool-1",
          eventType: "tool.started",
          itemType: "mcp_tool_call"
        }
      }));

      const recovered = repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      });

      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({
        source: { toolId: "tool-1", eventType: "recorder.recovery" },
        relationships: [{ type: "recovers", eventId: "tool-start" }]
      });
    } finally {
      close();
    }
  });

  it.each([
    {
      name: "an item type mismatch does not close the observed item",
      started: {
        kind: "command",
        source: {
          provider: "codex-exec" as const,
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.started",
          itemType: "command_execution"
        }
      },
      terminal: {
        kind: "tool",
        source: {
          provider: "codex-exec" as const,
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.completed",
          itemType: "mcp_tool_call"
        }
      }
    },
    {
      name: "a correlation mismatch does not close the observed item",
      started: {
        kind: "command",
        source: {
          provider: "codex-exec" as const,
          turnId: "turn-1",
          itemId: "item-1",
          correlationId: "correlation-start",
          eventType: "item.started",
          itemType: "command_execution"
        }
      },
      terminal: {
        kind: "command",
        source: {
          provider: "codex-exec" as const,
          turnId: "turn-1",
          itemId: "item-1",
          correlationId: "correlation-other",
          eventType: "item.completed",
          itemType: "command_execution"
        }
      }
    },
    {
      name: "an unrelated event family does not close the observed item",
      started: {
        kind: "command",
        source: {
          provider: "codex-exec" as const,
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "item.started",
          itemType: "command_execution"
        }
      },
      terminal: {
        kind: "command",
        source: {
          provider: "codex-exec" as const,
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "future.completed",
          itemType: "command_execution"
        }
      }
    }
  ])("uses the strongest lifecycle identity: $name", ({ started, terminal }) => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("event-start", 0, "in_progress", started));
      repository.appendEvent(event("other-terminal", 1, "completed", terminal));
      const recovered = repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      });
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.relationships).toEqual([
        { type: "recovers", eventId: "event-start" }
      ]);
    } finally {
      close();
    }
  });

  it("rolls back every recovery when one recovery insertion fails", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("start-one", 0, "in_progress"));
      repository.appendEvent(event("start-two", 1, "in_progress", {
        source: {
          provider: "codex-exec",
          turnId: "turn-1",
          itemId: "item-2",
          eventType: "item.started",
          itemType: "command_execution"
        }
      }));
      expect(() => repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: () => "duplicate-recovery-id"
      })).toThrow();
      expect(repository.getRunDetail(runId).events.filter(({ kind }) => kind === "recorder.recovery")).toEqual([]);
    } finally {
      close();
    }
  });

  it("rejects malformed and duplicate recorder recovery relationships", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("event-start", 0, "in_progress"));
      const malformed = event("malformed-recovery", 1, "interrupted", {
        kind: "recorder.recovery",
        provenance: "recorder",
        relationships: [],
        source: { provider: "codex-exec", correlationId: runId }
      });
      expect(() => repository.appendEvent(malformed)).toThrow(/recovers/);

      const first = event("first-recovery", 1, "interrupted", {
        kind: "recorder.recovery",
        provenance: "recorder",
        relationships: [{ type: "recovers", eventId: "event-start" }],
        source: {
          provider: "codex-exec",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          eventType: "recorder.recovery",
          itemType: "command_execution"
        }
      });
      const duplicate = { ...first, id: "duplicate-recovery", sequence: 2 };
      repository.appendEvent(first);
      expect(() => repository.appendEvent(duplicate)).toThrow(/recover/i);
    } finally {
      close();
    }
  });

  it("rejects relationships whose target belongs to another run", () => {
    const { repository, close } = setup();
    try {
      repository.createRun(
        validRun({ id: "run-other" }),
        validOwnership({ recorderInstanceId: "recorder-instance-other" })
      );
      repository.appendEvent(event("other-source", 0, "completed", { runId: "run-other" }));
      const crossRunDerived = event("cross-run-derived", 0, "completed", {
        provenance: "derived",
        relationships: [{ type: "derived_from", eventId: "other-source" }],
        derivation: { name: "cross-run", version: "1", sourceEventIds: ["other-source"] }
      });
      expect(() => repository.appendEvent(crossRunDerived)).toThrow(/same run|run ownership/i);
      expect(repository.getRunDetail(runId).events).toEqual([]);
    } finally {
      close();
    }
  });

  it("does not append duplicate recovery relationships", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("event-start", 0, "in_progress"));
      const context = {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent: TraceEventV1) => `recovery-${openEvent.id}`
      };
      expect(repository.appendRecoveryForOpenEvents(runId, context)).toHaveLength(1);
      expect(repository.appendRecoveryForOpenEvents(runId, context)).toEqual([]);
      expect(repository.getRunDetail(runId).events).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("does not recover a start that already has a matching observed terminal event", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("event-start", 0, "in_progress"));
      repository.appendEvent(event("event-complete", 1, "completed"));
      expect(repository.appendRecoveryForOpenEvents(runId, {
        receivedAt,
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      })).toEqual([]);
      expect(repository.getRunDetail(runId).events).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("rejects a derived event without an exact derived_from source identity", () => {
    const { repository, close } = setup();
    try {
      const derivedWithoutSource = event("derived", 0, "completed", {
        provenance: "derived",
        relationships: [],
        derivation: { name: "test-command", version: "1", sourceEventIds: ["source-event"] }
      });
      expect(() => repository.appendEvent(derivedWithoutSource)).toThrow(/derived_from/);

      repository.appendEvent(event("source-event", 0, "completed"));
      const mismatched = event("derived", 1, "completed", {
        provenance: "derived",
        relationships: [{ type: "derived_from", eventId: "different-event" }],
        derivation: { name: "test-command", version: "1", sourceEventIds: ["source-event"] }
      });
      expect(() => repository.appendEvent(mismatched)).toThrow(/must match/);
      expect(repository.getRunDetail(runId).events.map(({ id }) => id)).toEqual(["source-event"]);
    } finally {
      close();
    }
  });

  it("inserts each event, source, relationships, and audits atomically", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("source-event", 0, "completed"));
      const derived = event("derived-event", 1, "completed", {
        provenance: "derived",
        relationships: [{ type: "derived_from", eventId: "source-event" }],
        derivation: { name: "test-command", version: "1", sourceEventIds: ["source-event"] }
      });
      repository.appendEvent(derived, [{ reason: "auth-bearer", count: 2 }]);
      const detail = repository.getRunDetail(runId);
      expect(detail.events[1]).toEqual(derived);
      expect(detail.redactionAudits).toContainEqual({
        eventId: "derived-event",
        artifactId: null,
        reason: "auth-bearer",
        count: 2
      });

      expect(() => repository.appendEvent(event("bad-link", 2, "completed", {
        relationships: [{ type: "correlates_with", eventId: "missing-event" }]
      }))).toThrow();
      expect(repository.getRunDetail(runId).events.map(({ id }) => id)).not.toContain("bad-link");
    } finally {
      close();
    }
  });
});

describe("storage schema capabilities", () => {
  it("records every Task 6 table present in the current schema", () => {
    const { repository, close } = setup();
    try {
      expect(repository.schemaCapabilities).toEqual({
        derivationIdentities: true,
        currentAssessments: true,
        eventArtifactBindings: true
      });
    } finally {
      close();
    }
  });

  it("keeps Task 5-schema run reads on the legacy query shape", () => {
    const { repository, close } = setupMigration003();
    try {
      expect(repository.schemaCapabilities).toEqual({
        derivationIdentities: false,
        currentAssessments: false,
        eventArtifactBindings: false
      });
      expect(repository.listRuns()).toEqual([
        expect.objectContaining({ id: "legacy-run", status: "starting" })
      ]);
      expect(repository.getRunDetail("legacy-run")).toMatchObject({
        run: { id: "legacy-run", status: "starting" },
        events: [],
        artifacts: [],
        redactionAudits: [],
        gitEvidence: null
      });
    } finally {
      close();
    }
  });
});

describe("bounded Task 7 storage reads", () => {
  it("reads run existence, bounded detail metadata, anchors, and ownership batches without RunDetail", () => {
    const { repository, databasePath, close } = setup();
    try {
      repository.appendEvent(event("bounded-failure", 0, "failed"));
      repository.appendEvent(event("bounded-latest", 1, "completed", {
        kind: "future.provider.kind"
      }));
      const detail = vi.spyOn(repository, "getRunDetail");
      const events = vi.spyOn(repository, "readEvents");

      expect(repository.getRun(runId)).toMatchObject({ id: runId, status: "starting" });
      expect(repository.getRun("missing-run")).toBeNull();
      expect(repository.getRunReadModel(runId)).toMatchObject({
        run: { id: runId },
        eventCount: 2,
        anchors: {
          firstFailure: { eventId: "bounded-failure", sequence: 0 },
          latestEvent: { eventId: "bounded-latest", sequence: 1 }
        },
        untrackedMetadataArtifact: null
      });
      expect(repository.getOwnershipBatch([runId, "missing-run"]).map(({ runId: id }) => id))
        .toEqual([runId]);
      expect(repository.getOwnershipBatch([])).toEqual([]);
      expect(() => repository.getOwnershipBatch(
        Array.from({ length: 101 }, (_, index) => `run-${index}`)
      )).toThrow(/100/);
      expect(detail).not.toHaveBeenCalled();
      expect(events).not.toHaveBeenCalled();

      const writable = new Database(databasePath);
      try {
        writable.prepare("DELETE FROM run_ownership WHERE run_id = ?").run(runId);
      } finally {
        writable.close();
      }
      expect(repository.getRun(runId)?.id).toBe(runId);
      expect(repository.getRunReadModel(runId)?.ownership).toBeNull();
    } finally {
      close();
    }
  });

  it("paginates duplicate timestamps by descending (startedAt, id) and applies every run filter", async () => {
    const { repository, databasePath, close } = setup({ id: "run-a", startedAt: 100 });
    try {
      for (const input of [
        validRun({ id: "run-b", startedAt: 200, repositoryFingerprint: "repo-one" }),
        validRun({ id: "run-c", startedAt: 200, repositoryFingerprint: "repo-two" }),
        validRun({ id: "run-d", startedAt: 300, repositoryFingerprint: "repo-one" })
      ]) {
        repository.createRun(input, validOwnership({
          recorderInstanceId: `recorder-${input.id}`
        }));
      }
      const writable = new Database(databasePath);
      try {
        writable.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").run("run-b");
        writable.prepare("UPDATE runs SET status = 'failed' WHERE id = ?").run("run-c");
      } finally {
        writable.close();
      }
      await repository.updateAssessment({
        runId: "run-b", eventId: "assessment-b", receivedAt, verdict: "success"
      });
      await repository.updateAssessment({
        runId: "run-c", eventId: "assessment-c", receivedAt, verdict: "failure"
      });

      const first = repository.listRunPage({ limit: 2 });
      const second = repository.listRunPage({
        limit: 2,
        before: {
          startedAt: first.items.at(-1)!.startedAt,
          runId: first.items.at(-1)!.id
        }
      });
      expect(first.items.map(({ id }) => id)).toEqual(["run-d", "run-c"]);
      expect(first.hasMore).toBe(true);
      expect(second.items.map(({ id }) => id)).toEqual(["run-b", "run-a"]);
      expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(4);
      expect(repository.listRunPage({ limit: 10, status: "completed" }).items.map(({ id }) => id))
        .toEqual(["run-b"]);
      expect(repository.listRunPage({ limit: 10, repositoryFingerprint: "repo-one" }).items
        .map(({ id }) => id)).toEqual(["run-d", "run-b"]);
      expect(repository.listRunPage({ limit: 10, assessment: { state: "projected" } }).items
        .map(({ id }) => id)).toEqual(["run-d", "run-a"]);
      expect(repository.listRunPage({ limit: 10, assessment: { state: "explicit" } }).items
        .map(({ id }) => id)).toEqual(["run-c", "run-b"]);
      expect(repository.listRunPage({
        limit: 10, assessment: { state: "explicit", verdict: "success" }
      }).items.map(({ id }) => id)).toEqual(["run-b"]);
      expect(repository.listRunPage({
        limit: 10,
        status: "completed",
        repositoryFingerprint: "repo-one",
        assessment: { state: "explicit", verdict: "success" }
      }).items.map(({ id }) => id)).toEqual(["run-b"]);
      expect(() => repository.listRunPage({ limit: 0 })).toThrow(/limit/i);
      expect(() => repository.listRunPage({ limit: 101 })).toThrow(/limit/i);
    } finally {
      close();
    }
  });

  it("returns chronological bounded head, tail, after, around, and before event windows", () => {
    const { repository, close } = setup();
    try {
      for (let sequence = 0; sequence <= 1_000; sequence += 1) {
        repository.appendEvent(event(`window-${sequence}`, sequence, "completed", {
          relationships: sequence === 1_000
            ? [{ type: "correlates_with", eventId: "window-999" }]
            : []
        }));
      }
      const sequences = (mode: Parameters<RunRepository["getEventWindow"]>[1]) =>
        repository.getEventWindow(runId, mode).events.map(({ sequence }) => sequence);
      expect(sequences({ mode: "head", limit: 3 })).toEqual([0, 1, 2]);
      expect(sequences({ mode: "tail", limit: 3 })).toEqual([998, 999, 1_000]);
      expect(sequences({ mode: "after", sequence: 500, limit: 3 })).toEqual([501, 502, 503]);
      expect(sequences({ mode: "around", sequence: 500, limit: 5 })).toEqual([498, 499, 500, 501, 502]);
      expect(sequences({ mode: "before", sequence: 500, limit: 3 })).toEqual([497, 498, 499]);
      const tail = repository.getEventWindow(runId, { mode: "tail", limit: 3 });
      expect(tail).toMatchObject({ latestCommittedSequence: 1_000, hasEarlier: true, hasLater: false });
      expect(tail.events.at(-1)?.relationships).toEqual([
        { type: "correlates_with", eventId: "window-999" }
      ]);
      expect(repository.getEventWindow(runId, {
        mode: "after", sequence: 1_000, limit: 3
      })).toEqual({
        events: [], latestCommittedSequence: 1_000, hasEarlier: true, hasLater: false
      });
      expect(() => repository.getEventWindow(runId, { mode: "head", limit: 251 }))
        .toThrow(/limit/i);
    } finally {
      close();
    }
  });

  it("rejects every malformed Task 7.3 public ID and fingerprint before querying", () => {
    const { repository, close } = setup();
    try {
      const malformed = [42, null, {}, []] as const;
      for (const value of malformed) {
        expect(() => repository.listRunPage({
          limit: 1,
          before: { startedAt: 1, runId: value } as never
        })).toThrow(/run page boundary run ID must be a non-empty string/i);
        expect(() => repository.listRunPage({
          limit: 1,
          repositoryFingerprint: value
        } as never)).toThrow(/repository fingerprint must be a non-empty string/i);

        expect(() => repository.getEvent(value as never, "event-id"))
          .toThrow(/run ID must be a non-empty string/i);
        expect(() => repository.getEvent(runId, value as never))
          .toThrow(/event ID must be a non-empty string/i);
        expect(() => repository.getEventArtifactBinding(
          value as never, "event-id", "assessment_note"
        )).toThrow(/run ID must be a non-empty string/i);
        expect(() => repository.getEventArtifactBinding(
          runId, value as never, "assessment_note"
        )).toThrow(/event ID must be a non-empty string/i);
        expect(() => repository.getArtifactForRun(value as never, "artifact-id"))
          .toThrow(/run ID must be a non-empty string/i);
        expect(() => repository.getArtifactForRun(runId, value as never))
          .toThrow(/artifact ID must be a non-empty string/i);
      }
    } finally {
      close();
    }
  });

  it("preserves null empty-window semantics and same-run event lookup", () => {
    const { repository, close } = setup();
    try {
      repository.createRun(validRun({ id: "empty-run" }), validOwnership({
        recorderInstanceId: "empty-recorder"
      }));
      repository.createRun(validRun({ id: "other-run" }), validOwnership({
        recorderInstanceId: "other-recorder"
      }));
      repository.appendEvent(event("other-event", 0, "completed", { runId: "other-run" }));
      expect(repository.getEventWindow("empty-run", { mode: "head", limit: 10 })).toEqual({
        events: [], latestCommittedSequence: null, hasEarlier: false, hasLater: false
      });
      expect(repository.getEvent(runId, "other-event")).toBeNull();
      expect(repository.getEvent("other-run", "other-event")?.id).toBe("other-event");
    } finally {
      close();
    }
  });

  it("resolves only the exact same-run standard assessment-note binding", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      const note = completedAssessmentNote(artifactRoot, "bound note");
      await repository.updateAssessment({
        runId, eventId: "bound-assessment", receivedAt, verdict: "partial",
        note: { state: "artifact", artifact: note }
      });
      expect(repository.getEventArtifactBinding(runId, "bound-assessment", "assessment_note"))
        .toMatchObject({ runId, eventId: "bound-assessment", role: "assessment_note", artifact: { id: note.id } });
      expect(repository.getArtifactForRun(runId, note.id)?.id).toBe(note.id);
      expect(repository.getEventArtifactBinding("missing-run", "bound-assessment", "assessment_note"))
        .toBeNull();
      expect(repository.getArtifactForRun("missing-run", note.id)).toBeNull();

      const writable = new Database(databasePath);
      try {
        writable.prepare("UPDATE runs SET capture_policy = 'metadata-only' WHERE id = ?").run(runId);
      } finally {
        writable.close();
      }
      expect(repository.getEventArtifactBinding(runId, "bound-assessment", "assessment_note"))
        .toBeNull();

      const secondWritable = new Database(databasePath);
      try {
        secondWritable.prepare("UPDATE runs SET capture_policy = 'standard' WHERE id = ?").run(runId);
        secondWritable.prepare("UPDATE artifacts SET kind = 'native-payload' WHERE id = ? AND run_id = ?")
          .run(note.id, runId);
      } finally {
        secondWritable.close();
      }
      expect(repository.getEventArtifactBinding(runId, "bound-assessment", "assessment_note"))
        .toBeNull();
    } finally {
      close();
    }
  });

  it("batches only the frozen summary evidence classes without detail N+1", async () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("source-event", 0, "completed"));
      repository.appendEvent(event("summary-file", 1, "completed", {
        kind: "file.change", source: { provider: "codex-exec", eventType: "item.completed", itemType: "file_change" }
      }));
      repository.appendEvent(event("summary-usage", 2, "completed", {
        kind: "turn.completed", source: { provider: "codex-exec", eventType: "turn.completed" },
        normalizedPayload: { usage: { input_tokens: 4 } }
      }));
      repository.appendEvent(event("summary-diagnostic", 3, "failed", {
        kind: "error", provenance: "recorder", source: { provider: "codex-exec", correlationId: runId }
      }));
      repository.appendEvent(event("summary-noise", 4, "completed", { kind: "message" }));
      const testCommand = repository.appendDerivedEvent(derivedInput("test.command"));
      const testResult = repository.appendDerivedEvent(derivedInput("test.result"));
      await repository.updateAssessment({
        runId, eventId: "summary-assessment", receivedAt: "2026-08-26T20:10:00.000Z", verdict: "success"
      });
      repository.saveGitEvidence(runId, {
        initialHead: "a".repeat(40), finalHead: "a".repeat(40), initialBranch: "main", finalBranch: "main",
        initialStatus: { state: "omitted", reason: "metadata-only" }, finalStatus: { state: "omitted", reason: "metadata-only" },
        trackedFinalDiff: { state: "absent" }, diffCheck: { state: "omitted", reason: "metadata-only" },
        diffCheckPassed: true, untrackedMetadata: { state: "absent" }, headChanged: false, branchChanged: false,
        capturedAt: 1_777_777_778_000
      });
      const detail = vi.spyOn(repository, "getRunDetail");
      const [summary] = repository.getRunSummaryBatch([runId]);
      expect(detail).not.toHaveBeenCalled();
      expect(summary?.summaryEvents.map(({ id }) => id)).toEqual([
        "source-event", "summary-file", "summary-usage", "summary-diagnostic",
        testCommand.id, testResult.id
      ]);
      expect(summary?.gitEvidence?.runId).toBe(runId);
      expect(summary?.currentAssessment).toMatchObject({ state: "explicit", verdict: "success" });
      expect(repository.getRunSummaryBatch(["missing-run", runId]).map(({ runId: id }) => id))
        .toEqual([runId]);
      expect(() => repository.getRunSummaryBatch(Array.from({ length: 101 }, (_, index) => `run-${index}`)))
        .toThrow(/100/);
    } finally {
      close();
    }
  });

  it("fails Task 7 capability-dependent reads explicitly on a Task 5 schema", () => {
    const { repository, close } = setupMigration003();
    try {
      expect(() => repository.listRunPage({ limit: 10, assessment: { state: "projected" } }))
        .toThrow(Task7StorageCapabilityError);
      expect(() => repository.getRunSummaryBatch(["legacy-run"]))
        .toThrow(Task7StorageCapabilityError);
      expect(() => repository.getEventArtifactBinding("legacy-run", "event", "assessment_note"))
        .toThrow(Task7StorageCapabilityError);
      expect(repository.getEventWindow("legacy-run", { mode: "head", limit: 10 }))
        .toEqual({ events: [], latestCommittedSequence: null, hasEarlier: false, hasLater: false });
    } finally {
      close();
    }
  });
});

describe("append-only human assessment storage", () => {
  it("projects a Task 5-schema run as unreviewed without querying Task 6 tables", () => {
    const { repository, close } = setupMigration003();
    try {
      expect(repository.getCurrentAssessment("legacy-run")).toEqual({
        runId: "legacy-run",
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        state: "projected",
        provenance: null,
        currentEventId: null,
        reviewedAt: null,
        updatedAt: null
      });
    } finally {
      close();
    }
  });

  it("creates the first explicit assessment with default uncertain and absent fields", async () => {
    const { repository, databasePath, close } = setup();
    try {
      const assessedAt = "2026-08-26T20:10:00.000Z";
      const current = await repository.updateAssessment({
        runId,
        eventId: "assessment-first",
        receivedAt: assessedAt,
        verdict: "success"
      });

      expect(current).toEqual({
        runId,
        verdict: "success",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        state: "explicit",
        provenance: "human",
        currentEventId: "assessment-first",
        reviewedAt: Date.parse(assessedAt),
        updatedAt: Date.parse(assessedAt)
      });
      expect(repository.getCurrentAssessment(runId)).toEqual(current);

      const [assessmentEvent] = repository.getRunDetail(runId).events;
      expect(assessmentEvent).toEqual({
        id: "assessment-first",
        runId,
        sequence: 0,
        receivedAt: assessedAt,
        kind: "assessment.updated",
        status: "completed",
        provenance: "human",
        source: { provider: "codex-exec" },
        relationships: [],
        summary: "Human assessment updated",
        normalizedPayload: {
          verdict: "success",
          taskCompleted: "uncertain",
          note: { state: "absent" }
        }
      });
      expect(queryRows(databasePath, "SELECT * FROM current_assessments")).toHaveLength(1);
      expect(queryRows(databasePath, "SELECT * FROM event_artifact_bindings")).toEqual([]);
      expect(queryRows(databasePath, `
        SELECT session_id, thread_id, turn_id, item_id, tool_id, event_type,
          item_type, correlation_id
        FROM event_sources WHERE event_id = ?
      `, "assessment-first")).toEqual([{
        session_id: null,
        thread_id: null,
        turn_id: null,
        item_id: null,
        tool_id: null,
        event_type: null,
        item_type: null,
        correlation_id: null
      }]);
    } finally {
      close();
    }
  });

  it("preserves reviewedAt while advancing append-only history and replacing omitted note with absent", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      const note = completedAssessmentNote(artifactRoot, "first durable reviewer note");
      const firstAt = "2026-08-26T20:10:00.000Z";
      const secondAt = "2026-08-26T20:11:00.000Z";
      const thirdAt = "2026-08-26T20:12:00.000Z";
      await repository.updateAssessment({
        runId,
        eventId: "assessment-with-note",
        receivedAt: firstAt,
        verdict: "partial",
        taskCompleted: "no",
        note: { state: "artifact", artifact: note }
      });
      await repository.updateAssessment({
        runId,
        eventId: "assessment-without-note",
        receivedAt: secondAt,
        verdict: "success",
        taskCompleted: "yes"
      });
      const current = await repository.updateAssessment({
        runId,
        eventId: "assessment-identical-repeat",
        receivedAt: thirdAt,
        verdict: "success",
        taskCompleted: "yes"
      });

      expect(current).toMatchObject({
        currentEventId: "assessment-identical-repeat",
        verdict: "success",
        taskCompleted: "yes",
        note: { state: "absent" },
        reviewedAt: Date.parse(firstAt),
        updatedAt: Date.parse(thirdAt)
      });
      expect(repository.getRunDetail(runId).events.map(({ id }) => id)).toEqual([
        "assessment-with-note",
        "assessment-without-note",
        "assessment-identical-repeat"
      ]);
      expect(queryRows(databasePath, `
        SELECT event_id, artifact_id, role, created_at
        FROM event_artifact_bindings ORDER BY event_id
      `)).toEqual([{
        event_id: "assessment-with-note",
        artifact_id: note.id,
        role: "assessment_note",
        created_at: Date.parse(firstAt)
      }]);
      expect(queryRows(databasePath, `
        SELECT id, run_id, sha256 FROM artifacts WHERE id = ?
      `, note.id)).toEqual([{ id: note.id, run_id: runId, sha256: note.sha256 }]);
    } finally {
      close();
    }
  });

  it("rejects an earlier assessment timestamp without changing any durable assessment state", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      const firstAt = "2026-08-26T20:10:00.000Z";
      await repository.updateAssessment({
        runId,
        eventId: "assessment-timestamp-first",
        receivedAt: firstAt,
        verdict: "partial"
      });
      const before = repository.getCurrentAssessment(runId);
      const note = completedAssessmentNote(artifactRoot, "rejected-earlier-timestamp-note");

      await expect(repository.updateAssessment({
        runId,
        eventId: "assessment-timestamp-earlier",
        receivedAt: "2026-08-26T20:09:00.000Z",
        verdict: "failure",
        taskCompleted: "no",
        note: { state: "artifact", artifact: note }
      })).rejects.toThrow(/timestamp.*regress|regress.*timestamp/i);

      expect(repository.getCurrentAssessment(runId)).toEqual(before);
      expect(repository.getRunDetail(runId).events.map(({ id }) => id)).toEqual([
        "assessment-timestamp-first"
      ]);
      expect(queryRows(databasePath, "SELECT * FROM artifacts")).toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM redaction_audits")).toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM event_artifact_bindings")).toEqual([]);
    } finally {
      close();
    }
  });

  it("appends a distinct action at the same timestamp and advances only currentEventId", async () => {
    const { repository, close } = setup();
    try {
      const sharedAt = "2026-08-26T20:10:00.000Z";
      await repository.updateAssessment({
        runId,
        eventId: "assessment-equal-first",
        receivedAt: sharedAt,
        verdict: "partial"
      });
      const current = await repository.updateAssessment({
        runId,
        eventId: "assessment-equal-second",
        receivedAt: sharedAt,
        verdict: "success",
        taskCompleted: "yes"
      });

      expect(current).toMatchObject({
        currentEventId: "assessment-equal-second",
        reviewedAt: Date.parse(sharedAt),
        updatedAt: Date.parse(sharedAt)
      });
      expect(repository.getRunDetail(runId).events.map(({ id, sequence, receivedAt }) => ({
        id,
        sequence,
        receivedAt
      }))).toEqual([
        { id: "assessment-equal-first", sequence: 0, receivedAt: sharedAt },
        { id: "assessment-equal-second", sequence: 1, receivedAt: sharedAt }
      ]);
    } finally {
      close();
    }
  });

  it("accepts a strictly later assessment timestamp while preserving the first reviewedAt", async () => {
    const { repository, close } = setup();
    try {
      const firstAt = "2026-08-26T20:10:00.000Z";
      const laterAt = "2026-08-26T20:11:00.000Z";
      await repository.updateAssessment({
        runId,
        eventId: "assessment-later-first",
        receivedAt: firstAt,
        verdict: "partial"
      });
      const current = await repository.updateAssessment({
        runId,
        eventId: "assessment-later-second",
        receivedAt: laterAt,
        verdict: "success",
        taskCompleted: "yes"
      });

      expect(current).toMatchObject({
        currentEventId: "assessment-later-second",
        reviewedAt: Date.parse(firstAt),
        updatedAt: Date.parse(laterAt)
      });
      expect(repository.getRunDetail(runId).events.map(({ id }) => id)).toEqual([
        "assessment-later-first",
        "assessment-later-second"
      ]);
    } finally {
      close();
    }
  });

  it("rejects yes/no for explicit unreviewed but accepts uncertain with a content-free note reference", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      for (const taskCompleted of ["yes", "no"] as const) {
        await expect(repository.updateAssessment({
          runId,
          eventId: `invalid-unreviewed-${taskCompleted}`,
          receivedAt,
          verdict: "unreviewed",
          taskCompleted
        })).rejects.toThrow(/unreviewed.*uncertain|uncertain.*unreviewed/i);
      }
      expect(repository.getCurrentAssessment(runId).state).toBe("projected");

      const rawNote = "review-note-sentinel-7ee5197b";
      const note = completedAssessmentNote(artifactRoot, rawNote);
      const current = await repository.updateAssessment({
        runId,
        eventId: "explicit-unreviewed",
        receivedAt,
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "artifact", artifact: note }
      });

      expect(current).toMatchObject({
        state: "explicit",
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "artifact", artifactId: note.id }
      });
      const stored = repository.getRunDetail(runId).events[0];
      expect(stored).toMatchObject({
        source: { provider: "codex-exec" },
        relationships: [],
        summary: "Human assessment updated",
        normalizedPayload: {
          verdict: "unreviewed",
          taskCompleted: "uncertain",
          note: { state: "artifact", artifactId: note.id }
        }
      });
      expect(stored).not.toHaveProperty("nativePayload");
      expect(stored).not.toHaveProperty("sourceOccurredAt");
      expect(stored).not.toHaveProperty("derivation");
      expect(JSON.stringify(stored)).not.toContain(rawNote);
      expect(sqliteContains(databasePath, rawNote)).toBe(false);
    } finally {
      close();
    }
  });

  it.each(["metadata-only", "strict"] as const)(
    "stores %s note omission without an artifact or binding",
    async (reason) => {
      const { repository, databasePath, close } = setup({ capturePolicy: reason });
      try {
        const current = await repository.updateAssessment({
          runId,
          eventId: `assessment-${reason}`,
          receivedAt,
          verdict: "failure",
          taskCompleted: "no",
          note: { state: "omitted", reason }
        });
        expect(current.note).toEqual({ state: "omitted", reason });
        expect(repository.getRunDetail(runId).events[0]?.normalizedPayload).toEqual({
          verdict: "failure",
          taskCompleted: "no",
          note: { state: "omitted", reason }
        });
        expect(queryRows(databasePath, "SELECT * FROM artifacts")).toEqual([]);
        expect(queryRows(databasePath, "SELECT * FROM redaction_audits")).toEqual([]);
        expect(queryRows(databasePath, "SELECT * FROM event_artifact_bindings")).toEqual([]);
      } finally {
        close();
      }
    }
  );

  it.each(["metadata-only", "strict"] as const)(
    "allows an absent note under the %s capture policy",
    async (capturePolicy) => {
      const { repository, close } = setup({ capturePolicy });
      try {
        const current = await repository.updateAssessment({
          runId,
          eventId: `assessment-${capturePolicy}-absent`,
          receivedAt,
          verdict: "success"
        });
        expect(current.note).toEqual({ state: "absent" });
      } finally {
        close();
      }
    }
  );

  it.each([
    { capturePolicy: "standard", note: { state: "omitted", reason: "metadata-only" } },
    { capturePolicy: "standard", note: { state: "omitted", reason: "strict" } },
    { capturePolicy: "metadata-only", note: { state: "omitted", reason: "strict" } },
    { capturePolicy: "strict", note: { state: "omitted", reason: "metadata-only" } }
  ] as const)(
    "rejects $note.state/$note.reason under the $capturePolicy capture policy",
    async ({ capturePolicy, note }) => {
      const { repository, databasePath, close } = setup({ capturePolicy });
      try {
        await expect(repository.updateAssessment({
          runId,
          eventId: `assessment-${capturePolicy}-${note.reason}`,
          receivedAt,
          verdict: "failure",
          note
        })).rejects.toThrow(/capture policy/i);
        expect(repository.getCurrentAssessment(runId).state).toBe("projected");
        expect(queryRows(databasePath, "SELECT * FROM events")).toEqual([]);
      } finally {
        close();
      }
    }
  );

  it.each(["metadata-only", "strict"] as const)(
    "rejects an artifact note under the %s capture policy before opening the artifact file",
    async (capturePolicy) => {
      const { repository, databasePath, artifactRoot, close } = setup({ capturePolicy });
      try {
        const note = completedAssessmentNote(artifactRoot, `${capturePolicy}-forbidden-note`);
        unlinkSync(note.path);
        await expect(repository.updateAssessment({
          runId,
          eventId: `assessment-${capturePolicy}-artifact`,
          receivedAt,
          verdict: "failure",
          note: { state: "artifact", artifact: note }
        })).rejects.toThrow(/capture policy/i);
        expect(repository.getCurrentAssessment(runId).state).toBe("projected");
        expect(queryRows(databasePath, "SELECT * FROM artifacts")).toEqual([]);
        expect(queryRows(databasePath, "SELECT * FROM events")).toEqual([]);
      } finally {
        close();
      }
    }
  );

  it("leaves observed, derived, recorder, Git, run, and ownership evidence logically unchanged", async () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("source-event", 0, "completed"));
      repository.appendDerivedEvent(derivedInput("test.command"));
      repository.appendEvent(event("recorder-event", 2, "failed", {
        kind: "error",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { recorderFailure: true }
      }));
      repository.saveGitEvidence(runId, {
        initialHead: "a".repeat(40),
        finalHead: "b".repeat(40),
        initialBranch: "main",
        finalBranch: "feature",
        initialStatus: { state: "omitted", reason: "metadata-only" },
        finalStatus: { state: "omitted", reason: "metadata-only" },
        trackedFinalDiff: { state: "absent" },
        diffCheck: { state: "omitted", reason: "metadata-only" },
        diffCheckPassed: false,
        untrackedMetadata: { state: "absent" },
        headChanged: true,
        branchChanged: true,
        capturedAt: 1_777_777_778_000
      });
      const before = repository.getRunDetail(runId);

      await repository.updateAssessment({
        runId,
        eventId: "assessment-after-evidence",
        receivedAt: "2026-08-26T20:13:00.000Z",
        verdict: "partial",
        taskCompleted: "uncertain"
      });
      const after = repository.getRunDetail(runId);

      expect(after.run).toEqual(before.run);
      expect(after.ownership).toEqual(before.ownership);
      expect(after.gitEvidence).toEqual(before.gitEvidence);
      expect(after.events.filter(({ provenance }) => provenance !== "human")).toEqual(before.events);
      expect(after.events.filter(({ provenance }) => provenance === "human")).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("validates and reuses one same-run content-addressed note while appending distinct actions", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      const note = completedAssessmentNote(artifactRoot, "same redacted note");
      const audits = [{ reason: "assignment-secret", count: 2 }];
      await repository.updateAssessment({
        runId,
        eventId: "assessment-reuse-one",
        receivedAt: "2026-08-26T20:14:00.000Z",
        verdict: "partial",
        note: { state: "artifact", artifact: note }
      }, audits);
      await repository.updateAssessment({
        runId,
        eventId: "assessment-reuse-two",
        receivedAt: "2026-08-26T20:15:00.000Z",
        verdict: "partial",
        note: { state: "artifact", artifact: note }
      }, audits);

      expect(queryRows(databasePath, "SELECT id FROM artifacts WHERE id = ?", note.id)).toHaveLength(1);
      expect(queryRows(databasePath, `
        SELECT reason, count FROM redaction_audits WHERE artifact_id = ? ORDER BY id
      `, note.id)).toEqual([{ reason: "assignment-secret", count: 2 }]);
      expect(queryRows(databasePath, `
        SELECT event_id, artifact_id FROM event_artifact_bindings ORDER BY created_at
      `)).toEqual([
        { event_id: "assessment-reuse-one", artifact_id: note.id },
        { event_id: "assessment-reuse-two", artifact_id: note.id }
      ]);
      expect(repository.getRunDetail(runId).events.filter(({ kind }) =>
        kind === "assessment.updated"
      )).toHaveLength(2);

      unlinkSync(note.path);
      const beforeFailedReuse = repository.getCurrentAssessment(runId);
      await expect(repository.updateAssessment({
        runId,
        eventId: "assessment-reuse-missing-file",
        receivedAt: "2026-08-26T20:16:00.000Z",
        verdict: "partial",
        note: { state: "artifact", artifact: note }
      }, audits)).rejects.toThrow(/not available|missing/i);
      expect(repository.getCurrentAssessment(runId)).toEqual(beforeFailedReuse);
    } finally {
      close();
    }
  });

  it("binds identical assessment-note bytes independently to two runs", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    const otherRunId = "run-other";
    try {
      repository.createRun(
        validRun({ id: otherRunId }),
        validOwnership({ recorderInstanceId: "recorder-instance-other" })
      );
      const note = completedAssessmentNote(artifactRoot, "shared redacted note");
      const otherNote = completedAssessmentNote(artifactRoot, "shared redacted note", {
        runId: otherRunId
      });
      const audits = [{ reason: "assignment-secret", count: 2 }];

      await repository.updateAssessment({
        runId,
        eventId: "assessment-shared-run-one",
        receivedAt: "2026-08-26T20:14:00.000Z",
        verdict: "partial",
        note: { state: "artifact", artifact: note }
      }, audits);
      await repository.updateAssessment({
        runId: otherRunId,
        eventId: "assessment-shared-run-two",
        receivedAt: "2026-08-26T20:15:00.000Z",
        verdict: "partial",
        note: { state: "artifact", artifact: otherNote }
      }, audits);

      expect(otherNote.id).toBe(note.id);
      expect(queryRows(databasePath, `
        SELECT id, run_id FROM artifacts WHERE id = ? ORDER BY run_id
      `, note.id)).toEqual([
        { id: note.id, run_id: runId },
        { id: note.id, run_id: otherRunId }
      ]);
      expect(queryRows(databasePath, `
        SELECT run_id, event_id, artifact_id, reason, count
        FROM redaction_audits WHERE artifact_id = ? ORDER BY run_id
      `, note.id)).toEqual([
        {
          run_id: runId,
          event_id: null,
          artifact_id: note.id,
          reason: "assignment-secret",
          count: 2
        },
        {
          run_id: otherRunId,
          event_id: null,
          artifact_id: note.id,
          reason: "assignment-secret",
          count: 2
        }
      ]);
      expect(queryRows(databasePath, `
        SELECT event_id, run_id, artifact_id
        FROM event_artifact_bindings ORDER BY run_id
      `)).toEqual([
        { event_id: "assessment-shared-run-one", run_id: runId, artifact_id: note.id },
        { event_id: "assessment-shared-run-two", run_id: otherRunId, artifact_id: note.id }
      ]);
      for (const [assessedRunId, eventId] of [
        [runId, "assessment-shared-run-one"],
        [otherRunId, "assessment-shared-run-two"]
      ] as const) {
        expect(repository.getRunDetail(assessedRunId).events.filter(({ provenance }) =>
          provenance === "human"
        ).map(({ id }) => id)).toEqual([eventId]);
        expect(repository.getCurrentAssessment(assessedRunId)).toMatchObject({
          runId: assessedRunId,
          currentEventId: eventId,
          note: { state: "artifact", artifactId: note.id },
          state: "explicit",
          provenance: "human"
        });
      }
      expect(queryRows(databasePath, `
        SELECT run_id, current_event_id FROM current_assessments ORDER BY run_id
      `)).toEqual([
        { run_id: runId, current_event_id: "assessment-shared-run-one" },
        { run_id: otherRunId, current_event_id: "assessment-shared-run-two" }
      ]);
    } finally {
      close();
    }
  });

  it("rejects cross-run artifact ownership and event identity without partial writes", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      repository.createRun(
        validRun({ id: "run-other" }),
        validOwnership({ recorderInstanceId: "recorder-instance-other" })
      );
      const crossRunNote = completedAssessmentNote(artifactRoot, "other run note", {
        runId: "run-other"
      });
      await repository.commitArtifactMetadata(crossRunNote);
      await expect(repository.updateAssessment({
        runId,
        eventId: "assessment-cross-run-artifact",
        receivedAt,
        verdict: "failure",
        note: { state: "artifact", artifact: crossRunNote }
      })).rejects.toThrow(/same run|run ownership|belong|owned/i);

      repository.appendEvent(event("event-owned-by-other-run", 0, "completed", {
        runId: "run-other"
      }));
      await expect(repository.updateAssessment({
        runId,
        eventId: "event-owned-by-other-run",
        receivedAt,
        verdict: "failure"
      })).rejects.toThrow(/another run|owned|unique|constraint/i);
      expect(repository.getCurrentAssessment(runId).state).toBe("projected");
      expect(repository.getRunDetail(runId).events).toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM artifacts WHERE run_id = ?", runId)).toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM redaction_audits WHERE run_id = ?", runId))
        .toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM event_artifact_bindings WHERE run_id = ?", runId))
        .toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM current_assessments WHERE run_id = ?", runId))
        .toEqual([]);
    } finally {
      close();
    }
  });

  it("rolls back artifact metadata, audits, event, binding, and projection on transaction failure", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      await repository.updateAssessment({
        runId,
        eventId: "assessment-before-failure",
        receivedAt: "2026-08-26T20:17:00.000Z",
        verdict: "partial"
      });
      const before = repository.getCurrentAssessment(runId);
      const note = completedAssessmentNote(artifactRoot, "orphan file after database rollback");
      const triggerDatabase = new Database(databasePath);
      try {
        triggerDatabase.exec(`
          CREATE TRIGGER fail_assessment_insert
          BEFORE INSERT ON current_assessments
          BEGIN SELECT RAISE(ABORT, 'forced assessment failure'); END;
          CREATE TRIGGER fail_assessment_update
          BEFORE UPDATE ON current_assessments
          BEGIN SELECT RAISE(ABORT, 'forced assessment failure'); END;
        `);
      } finally {
        triggerDatabase.close();
      }

      await expect(repository.updateAssessment({
        runId,
        eventId: "assessment-rolled-back",
        receivedAt: "2026-08-26T20:18:00.000Z",
        verdict: "failure",
        taskCompleted: "no",
        note: { state: "artifact", artifact: note }
      }, [{ reason: "assignment-secret", count: 1 }])).rejects.toThrow(/forced assessment failure/i);

      expect(existsSync(note.path)).toBe(true);
      expect(repository.getCurrentAssessment(runId)).toEqual(before);
      expect(repository.getRunDetail(runId).events.map(({ id }) => id)).toEqual([
        "assessment-before-failure"
      ]);
      expect(queryRows(databasePath, "SELECT id FROM artifacts WHERE id = ?", note.id)).toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM redaction_audits")).toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM event_artifact_bindings")).toEqual([]);
    } finally {
      close();
    }
  });

  it("rejects malformed enums, timestamps, and note tuples before mutation", async () => {
    const { repository, artifactRoot, close } = setup();
    try {
      const artifact = completedAssessmentNote(artifactRoot, "tuple fixture");
      const malformed = [
        { verdict: "maybe" },
        { verdict: "success", taskCompleted: "maybe" },
        { verdict: "success", receivedAt: "not-a-timestamp" }
      ] as const;
      for (const [index, candidate] of malformed.entries()) {
        await expect(repository.updateAssessment({
          runId,
          eventId: `malformed-structured-${index}`,
          receivedAt,
          ...candidate
        } as never)).rejects.toThrow();
      }
      const invalidNotes = [
        { state: "absent", artifact },
        { state: "artifact" },
        { state: "omitted", reason: "standard" },
        { state: "omitted", reason: "strict", artifact },
        { state: "absent", rawNote: "must-not-be-accepted" }
      ];
      for (const [index, note] of invalidNotes.entries()) {
        await expect(repository.updateAssessment({
          runId,
          eventId: `malformed-note-${index}`,
          receivedAt,
          verdict: "success",
          note
        } as never)).rejects.toThrow(/note|state|tuple|artifact|reason/i);
      }
      expect(repository.getCurrentAssessment(runId).state).toBe("projected");
      expect(repository.getRunDetail(runId).events).toEqual([]);
    } finally {
      close();
    }
  });

  it.each([
    {
      name: "non-canonical path",
      mutate: (artifact: CompletedArtifact, artifactRoot: string) => {
        const path = join(dirname(artifactRoot), "noncanonical", artifact.id);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "artifact path fixture");
        return { ...artifact, path };
      }
    },
    {
      name: "missing file",
      mutate: (artifact: CompletedArtifact) => {
        unlinkSync(artifact.path);
        return artifact;
      }
    },
    {
      name: "symbolic link",
      mutate: (artifact: CompletedArtifact, artifactRoot: string) => {
        const target = join(dirname(artifactRoot), "symlink-target");
        writeFileSync(target, "artifact path fixture");
        unlinkSync(artifact.path);
        symlinkSync(target, artifact.path);
        return artifact;
      }
    },
    {
      name: "digest mismatch",
      mutate: (artifact: CompletedArtifact) => {
        writeFileSync(artifact.path, "tampered-digest");
        return artifact;
      }
    },
    {
      name: "byte-length mismatch",
      mutate: (artifact: CompletedArtifact) => ({
        ...artifact,
        byteLength: artifact.byteLength + 1
      })
    },
    {
      name: "artifact kind mismatch",
      mutate: (artifact: CompletedArtifact) => ({ ...artifact, kind: "native-payload" })
    },
    {
      name: "artifact media mismatch",
      mutate: (artifact: CompletedArtifact) => ({ ...artifact, mediaType: "application/json" })
    },
    {
      name: "artifact redaction mismatch",
      mutate: (artifact: CompletedArtifact) => ({
        ...artifact,
        redactionState: "unredacted"
      } as unknown as CompletedArtifact)
    }
  ])("rejects an assessment note with $name", async ({ mutate }) => {
    const { repository, artifactRoot, close } = setup();
    try {
      const artifact = mutate(
        completedAssessmentNote(artifactRoot, "artifact path fixture"),
        artifactRoot
      );
      await expect(repository.updateAssessment({
        runId,
        eventId: "assessment-invalid-artifact",
        receivedAt,
        verdict: "partial",
        note: { state: "artifact", artifact }
      })).rejects.toThrow(/artifact|path|symbolic|length|digest|media|redaction|available/i);
      expect(repository.getCurrentAssessment(runId).state).toBe("projected");
    } finally {
      close();
    }
  });

  it.each([
    {
      name: "untruncated original length smaller than stored length",
      mutate: (artifact: CompletedArtifact) => ({
        ...artifact,
        originalByteLength: artifact.byteLength - 1
      })
    },
    {
      name: "untruncated original length greater than stored length",
      mutate: (artifact: CompletedArtifact) => ({
        ...artifact,
        originalByteLength: artifact.byteLength + 1
      })
    },
    {
      name: "truncated original length equal to stored length",
      mutate: (artifact: CompletedArtifact) => ({
        ...artifact,
        truncated: true,
        originalByteLength: artifact.byteLength
      })
    },
    {
      name: "truncated original length smaller than stored length",
      mutate: (artifact: CompletedArtifact) => ({
        ...artifact,
        truncated: true,
        originalByteLength: artifact.byteLength - 1
      })
    },
    {
      name: "negative stored length",
      mutate: (artifact: CompletedArtifact) => ({ ...artifact, byteLength: -1 })
    },
    {
      name: "non-integer stored length",
      mutate: (artifact: CompletedArtifact) => ({ ...artifact, byteLength: 1.5 })
    },
    {
      name: "negative original length",
      mutate: (artifact: CompletedArtifact) => ({ ...artifact, originalByteLength: -1 })
    },
    {
      name: "non-integer original length",
      mutate: (artifact: CompletedArtifact) => ({ ...artifact, originalByteLength: 1.5 })
    }
  ])("rejects invalid assessment artifact length metadata: $name", async ({ mutate }) => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      const artifact = mutate(completedAssessmentNote(artifactRoot, "length metadata fixture"));
      await expect(repository.updateAssessment({
        runId,
        eventId: "assessment-invalid-length-metadata",
        receivedAt,
        verdict: "partial",
        note: { state: "artifact", artifact }
      })).rejects.toThrow(/artifact length metadata is invalid/i);
      expect(repository.getCurrentAssessment(runId).state).toBe("projected");
      expect(queryRows(databasePath, "SELECT * FROM artifacts")).toEqual([]);
      expect(queryRows(databasePath, "SELECT * FROM events")).toEqual([]);
    } finally {
      close();
    }
  });

  it.each([
    {
      name: "untruncated",
      mutate: (artifact: CompletedArtifact) => artifact
    },
    {
      name: "truncated",
      mutate: (artifact: CompletedArtifact) => ({
        ...artifact,
        truncated: true,
        originalByteLength: artifact.byteLength + 17
      })
    }
  ])("accepts valid $name assessment artifact length metadata", async ({ name, mutate }) => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      const artifact = mutate(completedAssessmentNote(artifactRoot, `${name} length fixture`));
      const current = await repository.updateAssessment({
        runId,
        eventId: `assessment-valid-length-${name}`,
        receivedAt,
        verdict: "partial",
        note: { state: "artifact", artifact }
      });
      expect(current.note).toEqual({ state: "artifact", artifactId: artifact.id });
      expect(queryRows(databasePath, `
        SELECT byte_length, truncated, original_byte_length
        FROM artifacts WHERE id = ?
      `, artifact.id)).toEqual([{
        byte_length: artifact.byteLength,
        truncated: artifact.truncated ? 1 : 0,
        original_byte_length: artifact.originalByteLength
      }]);
    } finally {
      close();
    }
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid note audit count %s without partial persistence",
    async (count) => {
      const { repository, databasePath, artifactRoot, close } = setup();
      try {
        const note = completedAssessmentNote(artifactRoot, `audit-count-${String(count)}`);
        await expect(repository.updateAssessment({
          runId,
          eventId: `assessment-invalid-audit-${String(count)}`,
          receivedAt,
          verdict: "partial",
          note: { state: "artifact", artifact: note }
        }, [{ reason: "fixture", count }])).rejects.toThrow(/positive integer/i);
        expect(repository.getCurrentAssessment(runId).state).toBe("projected");
        expect(queryRows(databasePath, "SELECT * FROM artifacts")).toEqual([]);
        expect(queryRows(databasePath, "SELECT * FROM redaction_audits")).toEqual([]);
      } finally {
        close();
      }
    }
  );
});

describe("derived event identity storage", () => {
  it("fills a split-write gap and makes every retry a no-op", () => {
    const { repository, close } = setup();
    try {
      const source = repository.appendEvent(event("source-event", 0, "completed", {
        normalizedPayload: {
          commandEvidence: { state: "available", redactedCommand: "pytest -q" },
          exitCode: 0
        }
      }));
      const commandInput = derivedInput("test.command");
      const resultInput = derivedInput("test.result");

      const firstCommand = repository.appendDerivedEvent(commandInput);
      expect(repository.appendDerivedEvent(commandInput)).toEqual(firstCommand);
      expect(repository.getRunDetail(runId).events.map(({ kind }) => kind)).toEqual([
        "command",
        "test.command"
      ]);

      const firstResult = repository.appendDerivedEvent(resultInput);
      expect(repository.appendDerivedEvent(commandInput)).toEqual(firstCommand);
      expect(repository.appendDerivedEvent(resultInput)).toEqual(firstResult);

      const events = repository.getRunDetail(runId).events;
      expect(events.map(({ id, sequence }) => ({ id, sequence }))).toEqual([
        { id: "source-event", sequence: 0 },
        { id: commandInput.eventId, sequence: 1 },
        { id: resultInput.eventId, sequence: 2 }
      ]);
      expect(events[0]).toEqual(source);
      expect(events.slice(1).map(({ relationships }) => relationships)).toEqual([
        [{ type: "derived_from", eventId: "source-event" }],
        [{ type: "derived_from", eventId: "source-event" }]
      ]);
    } finally {
      close();
    }
  });

  it("rejects a repeated natural tuple whose deterministic payload changed", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("source-event", 0, "completed"));
      repository.appendDerivedEvent(derivedInput("test.command"));

      expect(() => repository.appendDerivedEvent(derivedInput("test.command", {
        summary: "Changed summary"
      }))).toThrow(/existing derived event.*requested|does not match/i);
      expect(() => repository.appendDerivedEvent(derivedInput("test.command", {
        normalizedPayload: {
          family: "pytest",
          confidence: "high",
          derivationId: "test-command/1",
          copiedCommand: "pytest -q"
        }
      }))).toThrow(/existing derived event.*requested|does not match/i);
      expect(repository.getRunDetail(runId).events).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("rejects a deterministic event already owned by a source in another run", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("source-event", 0, "completed"));
      const input = derivedInput("test.command");
      repository.createRun(
        validRun({ id: "run-other" }),
        validOwnership({ recorderInstanceId: "recorder-instance-other" })
      );
      repository.appendEvent(event("other-source", 0, "completed", { runId: "run-other" }));

      expect(() => repository.appendDerivedEvent({
        ...input,
        sourceEventId: "other-source"
      })).toThrow(/same run|run ownership|another run/i);
      expect(repository.getRunDetail("run-other").events.map(({ id }) => id)).toEqual([
        "other-source"
      ]);
    } finally {
      close();
    }
  });

  it("converges two racing repository connections on the same durable winner", async () => {
    const { repository, databasePath, artifactRoot, close } = setup();
    try {
      repository.appendEvent(event("source-event", 0, "completed"));
      const input = derivedInput("test.command");
      const raceRoot = dirname(databasePath);
      const start = join(raceRoot, "race-start");
      const ready = [join(raceRoot, "race-ready-1"), join(raceRoot, "race-ready-2")];
      const storageModule = pathToFileURL(join(
        process.cwd(),
        "packages/storage/src/index.ts"
      )).href;
      const race = (readyPath: string) => execFile(
        process.execPath,
        [
          "--conditions=development",
          "--import", "tsx",
          "--input-type=module",
          "--eval", appendDerivedRaceScript
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            AGENTLENS_RACE_STORAGE_MODULE: storageModule,
            AGENTLENS_RACE_DATABASE: databasePath,
            AGENTLENS_RACE_ARTIFACT_ROOT: artifactRoot,
            AGENTLENS_RACE_READY: readyPath,
            AGENTLENS_RACE_START: start,
            AGENTLENS_RACE_INPUT: JSON.stringify(input)
          }
        }
      );
      const racers = ready.map(race);
      try {
        await waitForFiles(ready);
      } finally {
        writeFileSync(start, "start");
      }
      const results = await Promise.all(racers);
      const raced = results.map(({ stdout }) => JSON.parse(stdout) as {
        event: TraceEventV1;
        coreModule: string;
      });
      expect(raced.map(({ coreModule }) => coreModule)).toEqual([
        join(process.cwd(), "packages/core/src/index.ts"),
        join(process.cwd(), "packages/core/src/index.ts")
      ]);
      const winners = raced.map(({ event: winner }) => winner);

      expect(winners[1]).toEqual(winners[0]);
      expect(repository.getRunDetail(runId).events.filter(({ kind }) =>
        kind === "test.command"
      )).toEqual([winners[0]]);
    } finally {
      close();
    }
  });

  it("rehydrates the exact durable identities after closing and reopening", () => {
    const fixture = setup();
    const commandInput = derivedInput("test.command");
    const resultInput = derivedInput("test.result");
    try {
      fixture.repository.appendEvent(event("source-event", 0, "completed"));
      fixture.repository.appendDerivedEvent(commandInput);
      fixture.repository.appendDerivedEvent(resultInput);
      fixture.close();

      const reopenedDatabase = openDatabase(fixture.databasePath);
      try {
        const reopened = new RunRepository(reopenedDatabase, {
          artifactRoot: fixture.artifactRoot
        });
        expect(reopened.getRunDetail(runId).events.slice(1).map((stored) =>
          stored.derivation?.identity
        )).toEqual([commandInput.identity, resultInput.identity]);
      } finally {
        reopenedDatabase.close();
      }
    } finally {
      fixture.close();
    }
  });
});

describe("run-fact reconciliation", () => {
  const cases: readonly {
    name: string;
    provider: "completed" | "failed" | null;
    exitCode: number | null;
    signal: string | null;
    recorderFailure: boolean;
    explicitInterruption?: boolean;
    expectedStatus: "completed" | "failed" | "interrupted" | "recorder_error";
    expectedReason: string;
    expectedContradictions: string[];
  }[] = [
    {
      name: "recorder failure outranks otherwise successful facts",
      provider: "completed", exitCode: 0, signal: null, recorderFailure: true,
      expectedStatus: "recorder_error", expectedReason: "recorder_failure",
      expectedContradictions: ["provider_completed_but_recorder_failed"]
    },
    {
      name: "signal interruption outranks provider completion",
      provider: "completed", exitCode: null, signal: "SIGTERM", recorderFailure: false,
      expectedStatus: "interrupted", expectedReason: "child_signal",
      expectedContradictions: ["provider_completed_but_interrupted"]
    },
    {
      name: "explicit interruption outranks a zero exit",
      provider: null, exitCode: 0, signal: null, recorderFailure: false, explicitInterruption: true,
      expectedStatus: "interrupted", expectedReason: "explicit_interruption",
      expectedContradictions: ["zero_exit_but_interrupted"]
    },
    {
      name: "provider failure outranks a zero exit",
      provider: "failed", exitCode: 0, signal: null, recorderFailure: false,
      expectedStatus: "failed", expectedReason: "provider_failed",
      expectedContradictions: ["provider_failed_with_zero_exit"]
    },
    {
      name: "nonzero exit outranks provider completion",
      provider: "completed", exitCode: 7, signal: null, recorderFailure: false,
      expectedStatus: "failed", expectedReason: "child_exit_nonzero",
      expectedContradictions: ["provider_completed_with_nonzero_exit"]
    },
    {
      name: "matching provider completion and zero exit completes",
      provider: "completed", exitCode: 0, signal: null, recorderFailure: false,
      expectedStatus: "completed", expectedReason: "provider_completed_and_zero_exit",
      expectedContradictions: []
    },
    {
      name: "zero exit without provider terminal evidence fails closed",
      provider: null, exitCode: 0, signal: null, recorderFailure: false,
      expectedStatus: "failed", expectedReason: "incomplete_provider_stream",
      expectedContradictions: []
    },
    {
      name: "nonzero exit without provider terminal evidence fails",
      provider: null, exitCode: 3, signal: null, recorderFailure: false,
      expectedStatus: "failed", expectedReason: "child_exit_nonzero",
      expectedContradictions: []
    },
    {
      name: "unresolved facts become recorder error",
      provider: null, exitCode: null, signal: null, recorderFailure: false,
      expectedStatus: "recorder_error", expectedReason: "unreconciled_terminal_facts",
      expectedContradictions: []
    }
  ];

  it.each(cases)("$name", (testCase) => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      let sequence = 0;
      let providerTerminalEventId: string | undefined;
      if (testCase.provider) {
        providerTerminalEventId = "provider-terminal";
        repository.appendEvent(event(providerTerminalEventId, sequence++, testCase.provider, {
          kind: testCase.provider === "completed" ? "turn.completed" : "turn.failed",
          source: {
            provider: "codex-exec",
            threadId: "thread-1",
            turnId: "turn-1",
            eventType: testCase.provider === "completed" ? "turn.completed" : "turn.failed"
          }
        }));
      }

      const processEventId = "process-fact";
      const processStatus = testCase.signal
        ? "interrupted"
        : testCase.exitCode === null
          ? "unknown"
          : testCase.exitCode === 0 ? "completed" : "failed";
      repository.appendEvent(event(processEventId, sequence++, processStatus, {
        kind: "recorder.process_exit",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        summary: "Child process terminal fact",
        normalizedPayload: {
          exitCode: testCase.exitCode,
          terminatingSignal: testCase.signal
        }
      }));
      repository.recordProcessFact(runId, { eventId: processEventId });

      let recorderFailureEventId: string | undefined;
      if (testCase.recorderFailure) {
        recorderFailureEventId = "recorder-failure";
        repository.appendEvent(event(recorderFailureEventId, sequence++, "failed", {
          kind: "error",
          provenance: "recorder",
          source: { provider: "codex-exec", correlationId: runId },
          summary: "Recorder persistence failure",
          normalizedPayload: { recorderFailure: true }
        }));
      }

      let interruptionEventId: string | undefined;
      if (testCase.explicitInterruption) {
        interruptionEventId = "explicit-interruption";
        repository.appendEvent(event(interruptionEventId, sequence++, "interrupted", {
          kind: "recorder.interruption",
          provenance: "recorder",
          source: { provider: "codex-exec", correlationId: runId },
          summary: "Explicit interruption",
          normalizedPayload: { explicitInterruption: true }
        }));
      }

      const reconciliation: ReconciliationInput = {
        eventId: "run-reconciled",
        receivedAt: "2026-08-26T20:02:00.000Z",
        endedAt: 1_777_777_778_000,
        providerTerminalEventId,
        recorderFailureEventId,
        interruptionEventId
      };
      const result = repository.reconcileRun(runId, reconciliation);
      expect(result).toMatchObject({
        status: testCase.expectedStatus,
        terminalReason: testCase.expectedReason,
        contradictionCodes: testCase.expectedContradictions,
        exitCode: testCase.exitCode,
        terminatingSignal: testCase.signal,
        providerTerminalKind: testCase.provider
      });

      const detail = repository.getRunDetail(runId);
      expect(detail.run).toMatchObject(result);
      const expectedReconciliationEventStatus = {
        completed: "completed",
        failed: "failed",
        interrupted: "interrupted",
        recorder_error: "failed"
      } as const;
      expect(detail.events.at(-1)).toMatchObject({
        id: "run-reconciled",
        kind: "run.reconciled",
        provenance: "derived",
        status: expectedReconciliationEventStatus[testCase.expectedStatus]
      });
      expect(detail.events.at(-1)?.normalizedPayload).toMatchObject({
        status: testCase.expectedStatus,
        providerTerminalKind: testCase.provider,
        exitCode: testCase.exitCode,
        terminatingSignal: testCase.signal,
        contradictionCodes: testCase.expectedContradictions
      });
      const expectedSupport = [
        providerTerminalEventId,
        processEventId,
        recorderFailureEventId,
        interruptionEventId
      ].filter((value): value is string => value !== undefined);
      expect(new Set(detail.events.at(-1)?.relationships.map(({ eventId }) => eventId)))
        .toEqual(new Set(expectedSupport));
    } finally {
      close();
    }
  });

  it.each([
    {
      name: "recorder failure",
      supportId: "pre-spawn-recorder-failure",
      status: "failed" as const,
      kind: "error",
      normalizedPayload: { recorderFailure: true },
      reconciliation: { recorderFailureEventId: "pre-spawn-recorder-failure" },
      expectedStatus: "recorder_error",
      expectedReason: "recorder_failure"
    },
    {
      name: "explicit interruption",
      supportId: "pre-spawn-interruption",
      status: "interrupted" as const,
      kind: "recorder.interruption",
      normalizedPayload: { explicitInterruption: true },
      reconciliation: { interruptionEventId: "pre-spawn-interruption" },
      expectedStatus: "interrupted",
      expectedReason: "explicit_interruption"
    }
  ])("terminalizes a starting run from validated pre-spawn $name evidence", (testCase) => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event(testCase.supportId, 0, testCase.status, {
        kind: testCase.kind,
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: testCase.normalizedPayload
      }));

      const result = repository.reconcileRun(runId, {
        eventId: "pre-spawn-reconciliation",
        receivedAt,
        endedAt: 1_777_777_778_000,
        ...testCase.reconciliation
      });

      expect(result).toMatchObject({
        status: testCase.expectedStatus,
        terminalReason: testCase.expectedReason,
        childPid: null,
        exitCode: null,
        terminatingSignal: null,
        providerTerminalKind: null,
        contradictionCodes: []
      });
      const reconciliation = repository.getRunDetail(runId).events.at(-1);
      expect(reconciliation).toMatchObject({
        id: "pre-spawn-reconciliation",
        relationships: [{ type: "derived_from", eventId: testCase.supportId }],
        normalizedPayload: {
          providerTerminalKind: null,
          exitCode: null,
          terminatingSignal: null,
          supportingEventIds: [testCase.supportId]
        }
      });
    } finally {
      close();
    }
  });

  it("does not reconcile a starting run from provider or process evidence", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("provider-terminal-before-spawn", 0, "completed", {
        kind: "turn.completed",
        source: {
          provider: "codex-exec",
          threadId: "thread-1",
          turnId: "turn-1",
          eventType: "turn.completed"
        }
      }));
      repository.appendEvent(event("process-before-spawn", 1, "failed", {
        kind: "recorder.process_exit",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { exitCode: 9, terminatingSignal: null }
      }));

      expect(() => repository.recordProcessFact(runId, { eventId: "process-before-spawn" }))
        .toThrow(/running/i);
      expect(() => repository.reconcileRun(runId, {
        eventId: "unsupported-pre-spawn-reconciliation",
        receivedAt,
        endedAt: 1_777_777_778_000,
        providerTerminalEventId: "provider-terminal-before-spawn"
      })).toThrow();
      expect(repository.getRunDetail(runId)).toMatchObject({
        run: {
          status: "starting",
          childPid: null,
          exitCode: null,
          terminatingSignal: null,
          providerTerminalKind: null
        }
      });
      expect(repository.getRunDetail(runId).events.some(({ kind }) => kind === "run.reconciled"))
        .toBe(false);
    } finally {
      close();
    }
  });

  it("requires valid recorder terminal support before reconciling a starting run", () => {
    const { repository, close } = setup();
    try {
      expect(() => repository.reconcileRun(runId, {
        eventId: "unsupported-pre-spawn-reconciliation",
        receivedAt,
        endedAt: 1_777_777_778_000
      })).toThrow();

      repository.appendEvent(event("invalid-pre-spawn-failure", 0, "failed", {
        kind: "error",
        provenance: "observed",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { recorderFailure: true }
      }));
      expect(() => repository.reconcileRun(runId, {
        eventId: "invalid-pre-spawn-reconciliation",
        receivedAt,
        endedAt: 1_777_777_778_000,
        recorderFailureEventId: "invalid-pre-spawn-failure"
      })).toThrow();
      expect(repository.getRunDetail(runId).run.status).toBe("starting");
    } finally {
      close();
    }
  });

  it("keeps a pre-spawn recorder terminal reconciliation immutable", () => {
    const { repository, close } = setup();
    try {
      repository.appendEvent(event("pre-spawn-recorder-failure", 0, "failed", {
        kind: "error",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { recorderFailure: true }
      }));
      repository.reconcileRun(runId, {
        eventId: "pre-spawn-reconciliation",
        receivedAt,
        endedAt: 1_777_777_778_000,
        recorderFailureEventId: "pre-spawn-recorder-failure"
      });
      const terminal = repository.getRunDetail(runId);

      expect(() => repository.reconcileRun(runId, {
        eventId: "conflicting-pre-spawn-reconciliation",
        receivedAt: "2026-08-26T20:03:00.000Z",
        endedAt: 1_777_777_779_000,
        interruptionEventId: "pre-spawn-recorder-failure"
      })).toThrow(/terminal|already reconciled/i);
      expect(() => repository.markRunning(runId, runningInput())).toThrow(/starting/i);
      expect(repository.getRunDetail(runId)).toEqual(terminal);
    } finally {
      close();
    }
  });

  it("rejects a process fact whose stored event semantics do not match recorder evidence", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      repository.appendEvent(event("invalid-process", 0, "completed", {
        kind: "recorder.process_exit",
        provenance: "observed",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { exitCode: 0, terminatingSignal: null }
      }));
      expect(() => repository.recordProcessFact(runId, { eventId: "invalid-process" }))
        .toThrow(/recorder|provenance|semantics/i);
    } finally {
      close();
    }
  });

  it("derives provider terminal classification from an observed terminal event", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      repository.appendEvent(event("provider-terminal", 0, "completed", {
        kind: "turn.completed",
        provenance: "recorder",
        source: { provider: "codex-exec", turnId: "turn-1", eventType: "turn.completed" }
      }));
      repository.appendEvent(event("process-fact", 1, "completed", {
        kind: "recorder.process_exit",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { exitCode: 0, terminatingSignal: null }
      }));
      repository.recordProcessFact(runId, { eventId: "process-fact" });
      expect(() => repository.reconcileRun(runId, {
        eventId: "run-reconciled",
        receivedAt,
        endedAt: 1_777_777_778_000,
        providerTerminalEventId: "provider-terminal"
      })).toThrow(/observed provider|provider terminal semantics/i);
    } finally {
      close();
    }
  });

  it("requires validated recorder failure and explicit interruption support", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      repository.appendEvent(event("process-fact", 0, "completed", {
        kind: "recorder.process_exit",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { exitCode: 0, terminatingSignal: null }
      }));
      repository.recordProcessFact(runId, { eventId: "process-fact" });
      repository.appendEvent(event("not-recorder-failure", 1, "failed"));

      expect(() => repository.reconcileRun(runId, {
        eventId: "bad-failure-reconciliation",
        receivedAt,
        endedAt: 1_777_777_778_000,
        recorderFailureEventId: "not-recorder-failure"
      })).toThrow(/recorder failure semantics/i);

      repository.appendEvent(event("invalid-interruption", 2, "interrupted", {
        kind: "command",
        provenance: "observed",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { explicitInterruption: true }
      }));
      expect(() => repository.reconcileRun(runId, {
        eventId: "unsupported-interruption",
        receivedAt,
        endedAt: 1_777_777_778_000,
        interruptionEventId: "invalid-interruption"
      })).toThrow(/interruption.*support/i);
    } finally {
      close();
    }
  });

  it("does not overwrite process or reconciliation facts after the run is terminal", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      repository.appendEvent(event("provider-terminal", 0, "completed", {
        kind: "turn.completed",
        source: { provider: "codex-exec", turnId: "turn-1", eventType: "turn.completed" }
      }));
      repository.appendEvent(event("process-fact", 1, "completed", {
        kind: "recorder.process_exit",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { exitCode: 0, terminatingSignal: null }
      }));
      repository.recordProcessFact(runId, { eventId: "process-fact" });
      repository.reconcileRun(runId, {
        eventId: "run-reconciled",
        receivedAt,
        endedAt: 1_777_777_778_000,
        providerTerminalEventId: "provider-terminal"
      });
      const terminalDetail = repository.getRunDetail(runId);

      repository.appendEvent(event("late-process", 3, "failed", {
        kind: "recorder.process_exit",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        normalizedPayload: { exitCode: 9, terminatingSignal: null }
      }));
      expect(() => repository.recordProcessFact(runId, { eventId: "late-process" }))
        .toThrow(/terminal/i);
      expect(() => repository.reconcileRun(runId, {
        eventId: "second-reconciliation",
        receivedAt: "2026-08-26T20:03:00.000Z",
        endedAt: 1_777_777_779_000
      })).toThrow(/terminal|already reconciled/i);
      expect(() => repository.markRunning(runId, runningInput(99))).toThrow(/starting/i);

      const after = repository.getRunDetail(runId);
      expect(after.run).toEqual(terminalDetail.run);
      expect(after.events.filter(({ kind }) => kind === "run.reconciled")).toEqual(
        terminalDetail.events.filter(({ kind }) => kind === "run.reconciled")
      );
    } finally {
      close();
    }
  });
});

describe("run and Git evidence reads", () => {
  it("persists recorder ownership, heartbeat, child identity, and release state", () => {
    const { repository, close } = setup();
    try {
      expect(repository.getRunDetail(runId).ownership).toEqual({
        runId,
        recorderInstanceId: "recorder-instance-1",
        recorderPid: 101,
        recorderStartToken: "start-token-101",
        childPid: null,
        childStartToken: null,
        childProcessGroupId: null,
        heartbeatAt: 1_777_777_777_000,
        condition: "active",
        ownershipLostEventId: null,
        updatedAt: 1_777_777_777_000
      });

      expect(repository.refreshOwnership(runId, {
        recorderInstanceId: "wrong-instance",
        heartbeatAt: 1_777_777_777_250
      })).toBe(false);
      expect(repository.refreshOwnership(runId, {
        recorderInstanceId: "recorder-instance-1",
        heartbeatAt: 1_777_777_777_250
      })).toBe(true);

      repository.markRunning(runId, runningInput());
      expect(repository.getRunDetail(runId).ownership).toMatchObject({
        childPid: 42,
        childStartToken: "start-token-42",
        childProcessGroupId: 42,
        heartbeatAt: 1_777_777_777_250,
        condition: "active",
        updatedAt: 1_777_777_777_500
      });

      expect(repository.releaseOwnership(runId, {
        recorderInstanceId: "wrong-instance",
        updatedAt: 1_777_777_778_000
      })).toBe(false);
      expect(repository.releaseOwnership(runId, {
        recorderInstanceId: "recorder-instance-1",
        updatedAt: 1_777_777_778_000
      })).toBe(true);
      expect(repository.getRunDetail(runId).ownership?.condition).toBe("released");
    } finally {
      close();
    }
  });

  it("stores a direct-child fallback without inventing a process-group identity", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, {
        ...runningInput(),
        childProcessGroupId: null
      });

      expect(repository.getRunDetail(runId).ownership).toMatchObject({
        childPid: 42,
        childStartToken: "start-token-42",
        childProcessGroupId: null
      });
    } finally {
      close();
    }
  });

  it("claims stale ownership once and keeps recorder-crash recovery append-only", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      const started = repository.appendEvent(event("provider-open", 0, "in_progress"));
      const original = JSON.stringify(started);

      const firstLoss = repository.appendOwnershipLossIfCurrent(runId, {
        expectedRecorderInstanceId: "recorder-instance-1",
        eventId: "ownership-lost",
        receivedAt: "2026-08-26T20:01:00.000Z"
      });
      expect(firstLoss.kind).toBe("recorded");
      if (firstLoss.kind !== "recorded") throw new Error("ownership loss was not recorded");
      const lost = firstLoss.event;
      const repeated = repository.appendOwnershipLossIfCurrent(runId, {
        expectedRecorderInstanceId: "recorder-instance-1",
        eventId: "ownership-lost-duplicate",
        receivedAt: "2026-08-26T20:01:01.000Z"
      });
      expect(repeated).toMatchObject({ kind: "already_lost", event: { id: lost.id } });
      expect(repository.markOrphanChildActive(runId, {
        recorderInstanceId: "recorder-instance-1",
        updatedAt: 1_777_777_778_100
      })).toBe(true);
      expect(repository.getRunDetail(runId).ownership?.condition).toBe("orphan_child_active");

      expect(repository.claimRecoveryOwnership(runId, {
        expectedRecorderInstanceId: "recorder-instance-1",
        recovery: validOwnership({
          recorderInstanceId: "recovery-instance-1",
          recorderPid: 202,
          recorderStartToken: "start-token-202",
          heartbeatAt: 1_777_777_778_200
        })
      })).toBe(true);
      expect(repository.claimRecoveryOwnership(runId, {
        expectedRecorderInstanceId: "recorder-instance-1",
        recovery: validOwnership({
          recorderInstanceId: "recovery-instance-2",
          recorderPid: 303,
          recorderStartToken: "start-token-303",
          heartbeatAt: 1_777_777_778_300
        })
      })).toBe(false);

      const recoveries = repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:02.000Z",
        eventIdFor: () => "provider-open-recovery"
      });
      expect(recoveries).toHaveLength(1);
      expect(repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:03.000Z",
        eventIdFor: () => "provider-open-recovery-duplicate"
      })).toEqual([]);

      const run = repository.reconcileRun(runId, {
        eventId: "run-reconciled-after-crash",
        receivedAt: "2026-08-26T20:01:04.000Z",
        endedAt: 1_777_777_778_400,
        recorderCrashEventId: lost.id
      });
      const detail = repository.getRunDetail(runId);

      expect(run).toMatchObject({
        status: "interrupted",
        terminalReason: "recorder_crash",
        exitCode: null,
        terminatingSignal: null,
        providerTerminalKind: null
      });
      expect(detail.ownership?.condition).toBe("released");
      expect(JSON.stringify(detail.events.find(({ id }) => id === started.id))).toBe(original);
      expect(detail.events.filter(({ kind }) => kind === "recorder.ownership_lost")).toHaveLength(1);
      expect(detail.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
      expect(detail.events.filter(({ kind }) => kind === "run.reconciled")).toHaveLength(1);
      expect(detail.events.some(({ kind }) => kind === "recorder.process_exit")).toBe(false);
      expect(detail.events.some(({ kind }) => kind.startsWith("turn.") && kind.endsWith("completed")))
        .toBe(false);
    } finally {
      close();
    }
  });

  it("treats changed or terminal ownership snapshots as explicit no-op outcomes", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      expect(repository.claimRecoveryOwnership(runId, {
        expectedRecorderInstanceId: "recorder-instance-1",
        recovery: validOwnership({
          recorderInstanceId: "new-recorder-instance",
          recorderPid: 202,
          recorderStartToken: "start-token-202",
          heartbeatAt: 1_777_777_778_000
        })
      })).toBe(true);

      expect(repository.appendOwnershipLossIfCurrent(runId, {
        expectedRecorderInstanceId: "recorder-instance-1",
        eventId: "stale-ownership-loss",
        receivedAt: "2026-08-26T20:01:00.000Z"
      })).toEqual({ kind: "ownership_changed" });
      expect(repository.getRunDetail(runId).events).toHaveLength(0);

      const process = repository.appendEvent({
        id: "process-exit-after-transfer",
        runId,
        sequence: 0,
        receivedAt: "2026-08-26T20:01:01.000Z",
        kind: "recorder.process_exit",
        status: "completed",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        relationships: [],
        summary: "Child process terminal fact",
        normalizedPayload: { exitCode: 0, terminatingSignal: null }
      });
      repository.recordProcessFact(runId, { eventId: process.id });
      repository.reconcileRun(runId, {
        eventId: "normal-terminal-reconciliation",
        receivedAt: "2026-08-26T20:01:02.000Z",
        endedAt: 1_777_777_778_200
      });

      expect(repository.appendOwnershipLossIfCurrent(runId, {
        expectedRecorderInstanceId: "new-recorder-instance",
        eventId: "terminal-ownership-loss",
        receivedAt: "2026-08-26T20:01:03.000Z"
      })).toEqual({ kind: "already_terminal" });
      expect(repository.getRunDetail(runId).events.some(({ kind }) =>
        kind === "recorder.ownership_lost"
      )).toBe(false);
    } finally {
      close();
    }
  });

  it("does not record ownership loss after the matching owner released a nonterminal run", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      expect(repository.releaseOwnership(runId, {
        recorderInstanceId: "recorder-instance-1",
        updatedAt: 1_777_777_778_000
      })).toBe(true);

      expect(repository.appendOwnershipLossIfCurrent(runId, {
        expectedRecorderInstanceId: "recorder-instance-1",
        eventId: "released-ownership-loss",
        receivedAt: "2026-08-26T20:01:00.000Z"
      })).toEqual({ kind: "ownership_changed" });
      expect(repository.getRunDetail(runId).events).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("keeps run status distinct from event status and exposes final Git facts", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, runningInput());
      repository.saveGitEvidence(runId, {
        initialHead: "a".repeat(40),
        finalHead: "b".repeat(40),
        initialBranch: "main",
        finalBranch: "feature",
        initialStatus: { state: "omitted", reason: "metadata-only" },
        finalStatus: { state: "omitted", reason: "metadata-only" },
        trackedFinalDiff: { state: "absent" },
        diffCheck: { state: "omitted", reason: "metadata-only" },
        diffCheckPassed: false,
        untrackedMetadata: { state: "absent" },
        headChanged: true,
        branchChanged: true,
        capturedAt: 1_777_777_778_000
      });
      const [listed] = repository.listRuns({ limit: 10 });
      expect(listed).toMatchObject({
        id: runId,
        status: "running",
        childPid: 42,
        headChanged: true,
        branchChanged: true
      });
      expect(repository.getRunDetail(runId).gitEvidence).toMatchObject({
        initialHead: "a".repeat(40),
        finalHead: "b".repeat(40),
        headChanged: true,
        branchChanged: true,
        initialStatus: { state: "omitted", reason: "metadata-only" },
        finalStatus: { state: "omitted", reason: "metadata-only" },
        trackedFinalDiff: { state: "absent" },
        diffCheck: { state: "omitted", reason: "metadata-only" },
        untrackedMetadata: { state: "absent" }
      });
    } finally {
      close();
    }
  });

  it("rejects bare nulls for required Git capture evidence", () => {
    const { repository, close } = setup();
    try {
      const legacyNullableInput = {
        initialHead: "a".repeat(40),
        finalHead: "a".repeat(40),
        initialBranch: "main",
        finalBranch: "main",
        initialStatusArtifactId: null,
        finalStatusArtifactId: null,
        trackedFinalDiffArtifactId: null,
        diffCheckArtifactId: null,
        diffCheckPassed: true,
        untrackedMetadataArtifactId: null,
        headChanged: false,
        branchChanged: false,
        capturedAt: 1_777_777_778_000
      } as unknown as GitEvidenceInput;
      expect(() => repository.saveGitEvidence(runId, legacyNullableInput))
        .toThrow(/initial status|omitted|evidence state/i);
      expect(repository.getRunDetail(runId).gitEvidence).toBeNull();
    } finally {
      close();
    }
  });
});
