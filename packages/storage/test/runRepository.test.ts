import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventStatus, TraceEventV1 } from "@agentlens/core";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  RunRepository,
  type CreateRunInput,
  type ReconciliationInput
} from "../src/runRepository.js";

const temporaryRoots: string[] = [];
const runId = "run-001";
const receivedAt = "2026-08-26T20:00:00.000Z";

function setup(): { repository: RunRepository; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-repository-"));
  temporaryRoots.push(root);
  const database = openDatabase(join(root, "agentlens.sqlite"));
  const repository = new RunRepository(database);
  repository.createRun(validRun());
  return { repository, close: () => database.close() };
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
  it("appends recorder recovery without mutating the observed start byte-for-byte", () => {
    const { repository, close } = setup();
    try {
      const started = repository.appendEvent(event("event-start", 0, "in_progress"));
      const rawBefore = repository.database.connection
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(started.id);

      repository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:01:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      });

      const rawAfter = repository.database.connection
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(started.id);
      const events = repository.getRunDetail(runId).events;
      expect(rawAfter).toEqual(rawBefore);
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
      expect(repository.database.connection.prepare("SELECT event_id FROM event_sources WHERE event_id = ?").get("bad-link")).toBeUndefined();
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
      repository.appendEvent(event(processEventId, sequence++, testCase.signal ? "interrupted" : "completed", {
        kind: "recorder.process_exit",
        provenance: "recorder",
        source: { provider: "codex-exec", correlationId: runId },
        summary: "Child process terminal fact"
      }));
      repository.recordProcessFact(runId, {
        exitCode: testCase.exitCode,
        terminatingSignal: testCase.signal,
        eventId: processEventId
      });

      let recorderFailureEventId: string | undefined;
      if (testCase.recorderFailure) {
        recorderFailureEventId = "recorder-failure";
        repository.appendEvent(event(recorderFailureEventId, sequence++, "failed", {
          kind: "error",
          provenance: "recorder",
          source: { provider: "codex-exec", correlationId: runId },
          summary: "Recorder persistence failure"
        }));
      }

      const reconciliation: ReconciliationInput = {
        eventId: "run-reconciled",
        receivedAt: "2026-08-26T20:02:00.000Z",
        endedAt: 1_777_777_778_000,
        providerTerminalKind: testCase.provider,
        providerTerminalEventId,
        recorderFailureEventId,
        explicitInterruption: testCase.explicitInterruption ?? false
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
      expect(detail.events.at(-1)).toMatchObject({
        id: "run-reconciled",
        kind: "run.reconciled",
        provenance: "derived",
        status: testCase.expectedStatus === "completed" ? "completed" : "failed"
      });
      expect(detail.events.at(-1)?.normalizedPayload).toMatchObject({
        status: testCase.expectedStatus,
        providerTerminalKind: testCase.provider,
        exitCode: testCase.exitCode,
        terminatingSignal: testCase.signal,
        contradictionCodes: testCase.expectedContradictions
      });
    } finally {
      close();
    }
  });
});

describe("run and Git evidence reads", () => {
  it("keeps run status distinct from event status and exposes final Git facts", () => {
    const { repository, close } = setup();
    try {
      repository.markRunning(runId, { childPid: 42 });
      repository.saveGitEvidence(runId, {
        initialHead: "a".repeat(40),
        finalHead: "b".repeat(40),
        initialBranch: "main",
        finalBranch: "feature",
        initialStatusArtifactId: null,
        finalStatusArtifactId: null,
        trackedFinalDiffArtifactId: null,
        diffCheckArtifactId: null,
        diffCheckPassed: false,
        untrackedMetadataArtifactId: null,
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
        trackedFinalDiffArtifactId: null,
        untrackedMetadataArtifactId: null
      });
    } finally {
      close();
    }
  });
});
