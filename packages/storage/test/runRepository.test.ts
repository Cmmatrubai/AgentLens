import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventStatus, TraceEventV1 } from "@agentlens/core";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  RunRepository,
  type CreateRecorderOwnershipInput,
  type CreateRunInput,
  type GitEvidenceInput,
  type ReconciliationInput
} from "../src/runRepository.js";

const temporaryRoots: string[] = [];
const runId = "run-001";
const receivedAt = "2026-08-26T20:00:00.000Z";

function setup(): { repository: RunRepository; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-repository-"));
  temporaryRoots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const database = openDatabase(join(root, "agentlens.sqlite"));
  const repository = new RunRepository(database, { artifactRoot });
  repository.createRun(validRun(), validOwnership());
  return { repository, close: () => database.close() };
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
