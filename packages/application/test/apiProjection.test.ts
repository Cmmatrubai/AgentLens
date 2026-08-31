import { describe, expect, it } from "vitest";

import type { TraceEventV1 } from "@agentlens/core";
import type { RunSummary } from "@agentlens/derivations";
import type { CurrentAssessment, EventWindowRecord, RunListRecord } from "@agentlens/storage";
import type { OwnershipDiagnosis } from "../src/ownership.js";

import {
  createCursorCodec,
  createSourceRefProjector,
  projectCurrentAssessmentV1,
  projectEventDetailV1,
  projectRunListItemV1,
  projectRunSummaryV1,
  projectTrajectoryEventV1,
  projectTrajectoryPageV1,
  sanitizeUnsupportedToken
} from "../src/index.js";

const SOURCE_KEY = Buffer.alloc(32, 0x11);
const CURSOR_KEY = Buffer.alloc(32, 0x22);

function event(overrides: Partial<TraceEventV1> = {}): TraceEventV1 {
  return {
    id: "event-1",
    runId: "run-1",
    sequence: 4,
    receivedAt: "2026-08-30T12:00:00.000Z",
    sourceOccurredAt: "2026-08-30T11:59:59.000Z",
    kind: "command",
    status: "completed",
    provenance: "observed",
    source: {
      provider: "codex-exec",
      sessionId: "RAW_SESSION_MUST_NOT_CROSS_HTTP",
      turnId: "RAW_TURN_MUST_NOT_CROSS_HTTP",
      itemId: "RAW_ITEM_MUST_NOT_CROSS_HTTP",
      correlationId: "RAW_CORRELATION_MUST_NOT_CROSS_HTTP",
      eventType: "item.completed",
      itemType: "command_execution"
    },
    relationships: [{ type: "derived_from", eventId: "source-event" }],
    summary: "Command completed",
    normalizedPayload: {
      command: "NORMALIZED_SENTINEL_MUST_NOT_CROSS_HTTP",
      aggregatedOutput: "NORMALIZED_OUTPUT_MUST_NOT_CROSS_HTTP",
      exitCode: 0,
      storagePath: "/private/NORMALIZED_PATH_MUST_NOT_CROSS_HTTP"
    },
    nativePayload: {
      storage: "inline",
      redacted: { sentinel: "NATIVE_SENTINEL_MUST_NOT_CROSS_HTTP" }
    },
    ...overrides
  };
}

describe("process-local source references", () => {
  it("is stable for an exact length-delimited source tuple without exposing its fields", () => {
    const projector = createSourceRefProjector(SOURCE_KEY);
    const source = event().source;
    const first = projector.project(source);
    const second = projector.project({ ...source });

    expect(first).toEqual(second);
    expect(first.opaqueRef).toMatch(/^src_[a-f0-9]{64}$/);
    expect(first).toMatchObject({
      provider: { state: "known", value: "codex-exec" },
      hasSessionOrThread: true,
      hasTurn: true,
      hasItemOrTool: true,
      hasCorrelation: true
    });
    const serialized = JSON.stringify(first);
    for (const raw of [source.sessionId, source.turnId, source.itemId, source.correlationId]) {
      expect(serialized).not.toContain(raw!);
    }
  });

  it("uses domain-separated source and lifecycle HMACs and unambiguous tuples", () => {
    const projector = createSourceRefProjector(SOURCE_KEY);
    const first = event().source;
    const second = { ...first, sessionId: "RAW_SESSION_MUST_NOT_CROSS_HTTPx" };
    expect(projector.project(first).opaqueRef).not.toBe(projector.project(second).opaqueRef);
    expect(projector.lifecycleGroup(first)).not.toBe(projector.project(first).opaqueRef);
    expect(projector.lifecycleGroup(first)).toMatch(/^grp_[a-f0-9]{64}$/);
    expect(projector.lifecycleGroup({ ...first, eventType: "item.started" }))
      .toBe(projector.lifecycleGroup({ ...first, eventType: "item.completed" }));

    const ambiguousLeft = { provider: "codex-exec", sessionId: "ab", turnId: "c" } as const;
    const ambiguousRight = { provider: "codex-exec", sessionId: "a", turnId: "bc" } as const;
    expect(projector.project(ambiguousLeft).opaqueRef)
      .not.toBe(projector.project(ambiguousRight).opaqueRef);
  });

  it("projects future providers only as bounded sanitized tokens", () => {
    const projector = createSourceRefProjector(SOURCE_KEY);
    const projected = projector.project({ provider: " Future Provider / RAW " } as never);
    expect(projected.provider).toEqual({ state: "unsupported", safeToken: "future_provider_raw" });
    expect(JSON.stringify(projected)).not.toContain("Future Provider");
  });
});

describe("opaque authenticated cursors", () => {
  it("round-trips run cursors only for the exact filters and boundary", () => {
    const codec = createCursorCodec(CURSOR_KEY);
    const filters = {
      status: "running",
      repositoryFingerprint: "repo-fingerprint",
      assessment: { state: "explicit", verdict: "success" }
    } as const;
    const cursor = codec.encodeRun({ filters, boundary: { startedAt: 42, runId: "run-1" } });
    expect(cursor).not.toContain("repo-fingerprint");
    expect(codec.decodeRun(cursor, filters)).toEqual({
      ok: true,
      value: { startedAt: 42, runId: "run-1" }
    });
    expect(codec.decodeRun(cursor, { ...filters, status: "completed" })).toEqual({
      ok: false,
      error: "invalid_cursor"
    });
  });

  it("binds event cursors to run, direction, boundary, and committed snapshot", () => {
    const codec = createCursorCodec(CURSOR_KEY);
    const cursor = codec.encodeEvent({
      runId: "run-1",
      direction: "earlier",
      boundarySequence: 4,
      latestCommittedSequence: 9
    });
    expect(codec.decodeEvent(cursor, {
      runId: "run-1",
      direction: "earlier",
      latestCommittedSequence: 9
    })).toEqual({
      ok: true,
      value: {
        direction: "earlier",
        mode: "before",
        boundarySequence: 4,
        latestCommittedSequence: 9
      }
    });
    for (const mismatch of [
      { runId: "other-run", direction: "earlier", latestCommittedSequence: 9 },
      { runId: "run-1", direction: "later", latestCommittedSequence: 9 },
      { runId: "run-1", direction: "earlier", latestCommittedSequence: 10 }
    ] as const) {
      expect(codec.decodeEvent(cursor, mismatch)).toEqual({ ok: false, error: "invalid_cursor" });
    }
  });

  it("rejects tampered, malformed, badly bounded, and oversized cursor text", () => {
    const codec = createCursorCodec(CURSOR_KEY);
    const cursor = codec.encodeEvent({
      runId: "run-1",
      direction: "later",
      boundarySequence: 4,
      latestCommittedSequence: 9
    });
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    for (const candidate of [tampered, "not-a-cursor", "x".repeat(4097)]) {
      expect(codec.decodeEvent(candidate, { runId: "run-1" })).toEqual({
        ok: false,
        error: "invalid_cursor"
      });
    }
    expect(() => codec.encodeEvent({
      runId: "run-1",
      direction: "later",
      boundarySequence: -1,
      latestCommittedSequence: 9
    })).toThrow(/cursor/i);
    expect(() => codec.encodeRun({
      filters: {},
      boundary: { startedAt: Number.NaN, runId: "run-1" }
    })).toThrow(/cursor/i);
  });
});

describe("browser-safe projectors", () => {
  it("sanitizes future tokens into the frozen bounded alphabet", () => {
    expect(sanitizeUnsupportedToken(" Future Status / RAW ")).toBe("future_status_raw");
    expect(sanitizeUnsupportedToken("!!!")).toBe("unsupported");
    expect(sanitizeUnsupportedToken("x".repeat(100))).toHaveLength(64);
  });

  it("preserves exact relationships and derivation source AgentLens IDs", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    const projected = projectTrajectoryEventV1(event({
      kind: "test.result",
      provenance: "derived",
      relationships: [{ type: "derived_from", eventId: "exact-source-event" }],
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["exact-source-event"],
        confidence: "high",
        identity: "exact-derivation-identity"
      }
    }), sourceRefs);
    expect(projected.relationships).toEqual([
      { type: "derived_from", eventId: "exact-source-event" }
    ]);
    expect(projected.derivation).toMatchObject({
      sourceEventIds: ["exact-source-event"],
      identity: "exact-derivation-identity"
    });
  });

  it("maps only the exact recovery kind to recorder_recovery", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    expect(projectTrajectoryEventV1(event({ kind: "recorder.recovery" }), sourceRefs)
      .presentationClass).toBe("recorder_recovery");
    expect(projectTrajectoryEventV1(event({ kind: "recorder.process_exit" }), sourceRefs)
      .presentationClass).toBe("recorder");
    expect(projectTrajectoryEventV1(event({ kind: "recorder.stream_diagnostic" }), sourceRefs)
      .presentationClass).toBe("recorder");
  });

  it("projects every frozen presentation class without copying canonical objects", () => {
    const fixtures: Array<[string, Partial<TraceEventV1>, string]> = [
      ["lifecycle", { kind: "turn.completed" }, "lifecycle"],
      ["message", { kind: "message.agent" }, "message"],
      ["reasoning", { kind: "reasoning.summary" }, "reasoning"],
      ["command", { kind: "command" }, "command"],
      ["file change", { kind: "file.change" }, "file_change"],
      ["tool", { kind: "tool" }, "tool"],
      ["plan", { kind: "plan.updated" }, "plan"],
      ["Git", { kind: "git.final_evidence", provenance: "git_recovered" }, "git"],
      ["recorder", { kind: "recorder.process_exit", provenance: "recorder" }, "recorder"],
      ["recovery", { kind: "recorder.recovery", provenance: "recorder", relationships: [{ type: "recovers", eventId: "open-event" }] }, "recorder_recovery"],
      ["test", { kind: "test.result", provenance: "derived", relationships: [{ type: "derived_from", eventId: "source-event" }], derivation: { name: "test-command", version: "1", sourceEventIds: ["source-event"], identity: "test-id" } }, "test"],
      ["assessment", { kind: "assessment.updated", provenance: "human" }, "assessment"],
      ["error", { kind: "error", status: "failed" }, "error"],
      ["unknown", { kind: "future.kind" }, "unknown"]
    ];
    for (const [label, overrides, expected] of fixtures) {
      const detail = projectEventDetailV1(event(overrides));
      expect(detail.presentationClass, label).toBe(expected);
    }
  });

  it("returns a structural-only fallback for unknown kinds", () => {
    const projected = projectEventDetailV1(event({
      kind: "future.kind",
      normalizedPayload: { sentinel: "MUST_NOT_CROSS_HTTP" },
      nativePayload: { storage: "inline", redacted: { sentinel: "NATIVE_MUST_NOT_CROSS_HTTP" } }
    }));
    expect(projected).toEqual({
      schemaVersion: 1,
      presentationClass: "unknown",
      eventId: "event-1",
      runId: "run-1",
      sequence: 4,
      kind: "future.kind",
      status: { state: "known", value: "completed" },
      provenance: "observed",
      relationships: [{ type: "derived_from", eventId: "source-event" }],
      content: { state: "unavailable", reason: "unsupported_kind" }
    });
  });

  it("preserves projected and explicit assessment provenance", () => {
    const projected: CurrentAssessment = {
      runId: "run-1",
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "absent" },
      state: "projected",
      provenance: null,
      currentEventId: null,
      reviewedAt: null,
      updatedAt: null
    };
    const explicit: CurrentAssessment = {
      runId: "run-1",
      verdict: "success",
      taskCompleted: "yes",
      note: { state: "artifact", artifactId: "note-artifact" },
      state: "explicit",
      provenance: "human",
      currentEventId: "assessment-event",
      reviewedAt: 1_000,
      updatedAt: 1_100
    };
    expect(projectCurrentAssessmentV1(projected)).toMatchObject({
      state: "projected",
      provenance: null,
      currentEventId: null
    });
    expect(projectCurrentAssessmentV1(explicit)).toMatchObject({
      state: "explicit",
      provenance: "human",
      currentEventId: "assessment-event",
      note: { state: "available" }
    });
  });

  it("projects Task 6 summary evidence without reinterpreting supporting IDs", () => {
    const available = <T>(value: T) => ({
      value,
      availability: "available" as const,
      provenance: "derived" as const,
      supportingEventIds: ["exact-summary-event"],
      supportingArtifactIds: ["exact-summary-artifact"]
    });
    const summary: RunSummary = {
      terminalCommands: available(2),
      failedTerminalCommands: available(1),
      nativeFileChanges: available(3),
      trackedFinalDiff: available("artifact"),
      untrackedFiles: available(4),
      elapsedRecorderTimeMs: available(500),
      observedTokenUsage: available({
        inputTokens: 10,
        cachedInputTokens: null,
        outputTokens: 20,
        reasoningOutputTokens: null,
        cacheWriteInputTokens: null
      }),
      likelyTests: {
        state: "none_detected",
        availability: "available",
        provenance: "derived",
        supportingEventIds: ["exact-summary-event"],
        supportingArtifactIds: [],
        omittedTerminalCommands: 0
      },
      assessment: {
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        state: "projected",
        availability: "available",
        provenance: null,
        currentEventId: null,
        reviewedAt: null,
        updatedAt: null,
        supportingEventIds: [],
        supportingArtifactIds: []
      },
      providerCapabilityLimitations: available([])
    };
    Object.assign(summary.likelyTests, {
      sentinel: "SUMMARY_SENTINEL_MUST_NOT_CROSS_HTTP"
    });
    Object.assign(summary.observedTokenUsage.value!, {
      sentinel: "USAGE_SENTINEL_MUST_NOT_CROSS_HTTP"
    });
    const projected = projectRunSummaryV1(summary, "codex-exec");
    expect(projected.terminalCommands).toMatchObject({
      state: "available",
      value: 2,
      supportingEventIds: ["exact-summary-event"],
      supportingArtifactIds: ["exact-summary-artifact"]
    });
    expect(projected.assessment).toMatchObject({ state: "projected", provenance: null });
    expect(JSON.stringify(projected)).not.toContain("SENTINEL_MUST_NOT_CROSS_HTTP");

    const run: RunListRecord = {
      id: "run-1",
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "AGENT_VERSION_MUST_NOT_CROSS_HTTP",
      status: "completed",
      capturePolicy: "standard",
      capturePolicyVersion: "1",
      redactionVersion: "1",
      label: "Reviewed run",
      promptSource: "/private/PROMPT_SOURCE_MUST_NOT_CROSS_HTTP",
      repositoryFingerprint: "repo-fingerprint",
      repositoryDisplay: "repository",
      startedAt: 1_000,
      endedAt: 1_500,
      childPid: null,
      exitCode: 0,
      terminatingSignal: null,
      providerTerminalKind: "completed",
      terminalReason: "provider completion",
      contradictionCodes: ["provider_process_contradiction"],
      headChanged: true,
      branchChanged: false,
      ownershipCondition: "released"
    };
    const ownership: OwnershipDiagnosis = {
      storedCondition: "released",
      diagnosis: "released"
    };
    const listItem = projectRunListItemV1({ run, summary, ownership });
    expect(listItem).toMatchObject({
      schemaVersion: 1,
      runId: "run-1",
      label: "Reviewed run",
      finalGitEvidence: { state: "available", headChanged: true, branchChanged: false },
      ownership,
      contradictionCodes: ["provider_process_contradiction"]
    });
    expect(JSON.stringify(listItem)).not.toContain("MUST_NOT_CROSS_HTTP");
  });

  it("projects empty and nonempty windows with authenticated page cursors", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    const cursors = createCursorCodec(CURSOR_KEY);
    const nonempty: EventWindowRecord = {
      events: [event({ sequence: 4 }), event({ id: "event-2", sequence: 5 })],
      latestCommittedSequence: 9,
      hasEarlier: true,
      hasLater: true
    };
    const page = projectTrajectoryPageV1(nonempty, {
      runId: "run-1",
      mode: "around",
      sourceRefs,
      cursors
    });
    expect(page.window).toMatchObject({
      state: "nonempty",
      minSequence: 4,
      maxSequence: 5,
      latestCommittedSequence: 9,
      hasEarlier: true,
      hasLater: true
    });
    expect(page.window.earlierCursor).toEqual(expect.any(String));
    expect(page.window.laterCursor).toEqual(expect.any(String));

    const empty = projectTrajectoryPageV1({
      events: [],
      latestCommittedSequence: 9,
      hasEarlier: true,
      hasLater: false
    }, { runId: "run-1", mode: "after", sourceRefs, cursors });
    expect(empty.window).toEqual({
      state: "empty",
      latestCommittedSequence: 9,
      hasEarlier: true,
      hasLater: false,
      earlierCursor: expect.any(String),
      laterCursor: null
    });
  });

  it("serializes no raw IDs, canonical payloads, paths, native content, or key material", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    const cursors = createCursorCodec(CURSOR_KEY);
    const projected = [
      projectTrajectoryEventV1(event(), sourceRefs),
      projectEventDetailV1(event()),
      projectTrajectoryPageV1({
        events: [event()],
        latestCommittedSequence: 4,
        hasEarlier: false,
        hasLater: false
      }, { runId: "run-1", mode: "head", sourceRefs, cursors })
    ];
    const serialized = JSON.stringify(projected);
    for (const forbidden of [
      "RAW_SESSION_MUST_NOT_CROSS_HTTP",
      "RAW_TURN_MUST_NOT_CROSS_HTTP",
      "RAW_ITEM_MUST_NOT_CROSS_HTTP",
      "RAW_CORRELATION_MUST_NOT_CROSS_HTTP",
      "NORMALIZED_SENTINEL_MUST_NOT_CROSS_HTTP",
      "NORMALIZED_OUTPUT_MUST_NOT_CROSS_HTTP",
      "NORMALIZED_PATH_MUST_NOT_CROSS_HTTP",
      "NATIVE_SENTINEL_MUST_NOT_CROSS_HTTP",
      SOURCE_KEY.toString("hex"),
      CURSOR_KEY.toString("hex")
    ]) expect(serialized).not.toContain(forbidden);
  });
});
