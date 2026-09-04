import { describe, expect, it } from "vitest";

import type { TraceEventV1 } from "@agentlens/core";
import { MAX_COMMAND_EVIDENCE_BYTES, summarizeRun, type RunSummary } from "@agentlens/derivations";
import type { CurrentAssessment, EventWindowRecord, RunListRecord } from "@agentlens/storage";
import type { OwnershipDiagnosis } from "../src/ownership.js";

import {
  createCursorCodec,
  createSourceRefProjector,
  projectCurrentAssessmentV1,
  projectCommandOutputContentV1,
  projectEventDetailV1,
  projectNormalizedContentV1,
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
    expect(() => codec.encodeEvent({
      runId: "run-1",
      direction: "sideways" as never,
      boundarySequence: 4,
      latestCommittedSequence: 9
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
    }), sourceRefs, "standard");
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
    expect(projectTrajectoryEventV1(event({ kind: "recorder.recovery" }), sourceRefs, "standard")
      .presentationClass).toBe("recorder_recovery");
    expect(projectTrajectoryEventV1(event({ kind: "recorder.process_exit" }), sourceRefs, "standard")
      .presentationClass).toBe("recorder");
    expect(projectTrajectoryEventV1(event({ kind: "recorder.stream_diagnostic" }), sourceRefs, "standard")
      .presentationClass).toBe("recorder");
  });

  it("reports content available only when a closed normalized projector can serve it", () => {
    const unavailable = { state: "unavailable", reason: "not_captured" } as const;
    for (const normalizedPayload of [
      null,
      { arbitrary: "value" },
      { command: undefined, exitCode: 0 },
      { command: 42, exitCode: 0 }
    ]) {
      expect(projectEventDetailV1(event({ normalizedPayload }), "standard"))
        .toMatchObject({ presentationClass: "command", content: unavailable });
    }

    for (const aggregatedOutput of [undefined, null, 42, { arbitrary: true }]) {
      const projected = projectEventDetailV1(event({
        normalizedPayload: {
          command: "pnpm test",
          exitCode: 0,
          aggregatedOutput
        }
      }), "standard");
      expect(projected).toMatchObject({
        presentationClass: "command",
        content: { state: "available" },
        output: unavailable
      });
    }

    expect(projectEventDetailV1(event({
      normalizedPayload: { command: "pnpm test", exitCode: 0, aggregatedOutput: "passed" }
    }), "standard")).toMatchObject({
      content: { state: "available" },
      output: { state: "available" }
    });
    expect(projectNormalizedContentV1(event({ normalizedPayload: { arbitrary: true } }), "standard"))
      .toBeNull();
    expect(projectCommandOutputContentV1(event({
      normalizedPayload: { command: "pnpm test", aggregatedOutput: "passed" }
    }), "standard")).toEqual({ kind: "command_output", output: "passed" });
    expect(projectEventDetailV1(event({ kind: "turn.completed" }), "standard"))
      .toMatchObject({ presentationClass: "lifecycle", content: unavailable });
    expect(projectEventDetailV1(event({ kind: "command" }), "metadata-only"))
      .toMatchObject({ content: { state: "unavailable", reason: "capture_policy" } });
  });

  it("projects the bounded durable command evidence retained after standard truncation", () => {
    const truncated = event({
      normalizedPayload: {
        truncated: true,
        exitCode: 17,
        commandEvidence: {
          state: "available",
          redactedCommand: "pnpm test"
        },
        arbitrary: "MUST_NOT_CROSS_HTTP"
      }
    });

    expect(projectNormalizedContentV1(truncated, "standard")).toEqual({
      kind: "command",
      command: "pnpm test",
      exitCode: 17
    });
    expect(projectEventDetailV1(truncated, "standard")).toMatchObject({
      presentationClass: "command",
      content: { state: "available" },
      output: { state: "unavailable", reason: "not_captured" }
    });
    expect(JSON.stringify(projectNormalizedContentV1(truncated, "standard")))
      .not.toContain("MUST_NOT_CROSS_HTTP");
  });

  it.each(["metadata-only", "strict"] as const)(
    "gives %s capture policy precedence over omitted command content and output",
    (capturePolicy) => {
      const omitted = event({
        normalizedPayload: {
          commandEvidence: { state: "omitted", reason: capturePolicy }
        }
      });

      expect(projectNormalizedContentV1(omitted, capturePolicy)).toBeNull();
      expect(projectCommandOutputContentV1(omitted, capturePolicy)).toBeNull();
      expect(projectEventDetailV1(omitted, capturePolicy)).toMatchObject({
        content: { state: "unavailable", reason: "capture_policy" },
        output: { state: "unavailable", reason: "capture_policy" }
      });
    }
  );

  it("rejects malformed or oversized available command evidence at the DTO boundary", () => {
    for (const redactedCommand of [42, "x".repeat(MAX_COMMAND_EVIDENCE_BYTES + 1)]) {
      const malformed = event({
        normalizedPayload: {
          truncated: true,
          exitCode: 17,
          commandEvidence: { state: "available", redactedCommand }
        }
      });

      expect(projectNormalizedContentV1(malformed, "standard")).toBeNull();
      expect(projectEventDetailV1(malformed, "standard")).toMatchObject({
        content: { state: "unavailable", reason: "not_captured" },
        output: { state: "unavailable", reason: "not_captured" }
      });
    }
  });

  it("reports native payload availability only for eligible standard observed evidence", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    expect(projectTrajectoryEventV1(event(), sourceRefs, "standard").nativePayload)
      .toEqual({ state: "available", storage: "inline" });
    expect(projectTrajectoryEventV1(event({
      provenance: "derived",
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["source-event"]
      }
    }), sourceRefs, "standard").nativePayload)
      .toEqual({ state: "unavailable", reason: "not_captured" });
    for (const capturePolicy of ["metadata-only", "strict"] as const) {
      expect(projectTrajectoryEventV1(event(), sourceRefs, capturePolicy).nativePayload)
        .toEqual({ state: "unavailable", reason: "capture_policy" });
    }
  });

  it("groups exact lifecycle siblings across presentation classes only with durable identity", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    const started = projectTrajectoryEventV1(event({
      id: "command-started",
      status: "in_progress",
      source: {
        ...event().source,
        eventType: "item.started"
      }
    }), sourceRefs, "standard");
    const completed = projectTrajectoryEventV1(event({
      id: "command-completed",
      source: {
        ...event().source,
        eventType: "item.completed"
      }
    }), sourceRefs, "standard");
    expect(started.presentationClass).toBe("command");
    expect(started.lifecycleGroupKey).toMatch(/^grp_[a-f0-9]{64}$/);
    expect(completed.lifecycleGroupKey).toBe(started.lifecycleGroupKey);
    expect(started.lifecycle).toEqual({ domain: "item", phase: "started" });
    expect(completed.lifecycle).toEqual({ domain: "item", phase: "completed" });
    expect(projectTrajectoryEventV1(event({
      source: { ...event().source, eventType: "item.progress" }
    }), sourceRefs, "standard").lifecycle).toBeNull();
    const serialized = JSON.stringify([started, completed]);
    for (const raw of [event().source.itemId, event().source.toolId, "item.started", "item.completed"]) {
      if (raw !== undefined) expect(serialized).not.toContain(raw);
    }

    const insufficient = projectTrajectoryEventV1(event({
      source: {
        provider: "codex-exec",
        eventType: "item.started",
        itemType: "command_execution"
      }
    }), sourceRefs, "standard");
    expect(insufficient.lifecycleGroupKey).toBeNull();
  });

  it("never infers a passed test result from event completion", () => {
    const derived = {
      kind: "test.result",
      provenance: "derived",
      relationships: [{ type: "derived_from", eventId: "source-event" }] as const,
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["source-event"],
        identity: "test-id"
      }
    } as const;
    expect(projectEventDetailV1(event({ ...derived, normalizedPayload: undefined }), "standard"))
      .toMatchObject({ presentationClass: "test", result: "unknown" });
    expect(projectEventDetailV1(event({
      ...derived,
      normalizedPayload: { family: "vitest", outcome: 42 }
    }), "standard")).toMatchObject({ presentationClass: "test", result: "unknown" });
    expect(projectEventDetailV1(event({
      ...derived,
      normalizedPayload: { family: "vitest", outcome: "passed" }
    }), "standard")).toMatchObject({ presentationClass: "test", result: "passed" });
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
      const detail = projectEventDetailV1(event(overrides), "standard");
      expect(detail.presentationClass, label).toBe(expected);
    }
  });

  it("returns a structural-only fallback for unknown kinds", () => {
    const projected = projectEventDetailV1(event({
      kind: "future.kind",
      normalizedPayload: { sentinel: "MUST_NOT_CROSS_HTTP" },
      nativePayload: { storage: "inline", redacted: { sentinel: "NATIVE_MUST_NOT_CROSS_HTTP" } }
    }), "standard");
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
      observedTokenUsage: {
        state: "available",
        value: {
          inputTokens: 10,
          cachedInputTokens: null,
          outputTokens: 20,
          reasoningOutputTokens: null,
          cacheWriteInputTokens: null
        },
        availability: "available",
        provenance: "observed",
        supportingEventIds: ["exact-summary-event"],
        supportingArtifactIds: ["exact-summary-artifact"],
        omittedSupportingEventIds: 0
      },
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
    expect(projected.observedTokenUsage).toEqual({
      state: "available",
      value: {
        inputTokens: 10,
        cachedInputTokens: null,
        outputTokens: 20,
        reasoningOutputTokens: null,
        cacheWriteInputTokens: null
      },
      origin: { type: "event", provenance: "observed" },
      supportingEventIds: ["exact-summary-event"],
      supportingArtifactIds: ["exact-summary-artifact"],
      omittedSupportingEventIds: 0
    });
    for (const reason of [
      "not_yet_available",
      "capture_policy",
      "redacted_by_policy",
      "not_captured"
    ] as const) {
      expect(projectRunSummaryV1({
        ...summary,
        observedTokenUsage: {
          state: "unavailable",
          value: null,
          availability: "unavailable",
          provenance: null,
          reason,
          supportingEventIds: [],
          supportingArtifactIds: [],
          omittedSupportingEventIds: 0
        }
      }, "codex-exec").observedTokenUsage).toEqual({
        state: "unavailable",
        reason,
        origin: null,
        supportingEventIds: [],
        supportingArtifactIds: [],
        omittedSupportingEventIds: 0
      });
    }
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
    expect(() => projectRunListItemV1({
      run: { ...run, startedAt: Number.MAX_SAFE_INTEGER },
      summary,
      ownership
    })).toThrow();
  });

  it("projects a fallback provider's unavailable token-usage limitation through the API boundary", () => {
    const summary = summarizeRun({
      run: {
        id: "fallback-run",
        provider: "claude-code",
        capturePolicy: "standard",
        startedAt: 1_000,
        endedAt: 1_500
      },
      events: [],
      gitEvidence: null,
      validatedUntrackedFileCount: null,
      currentAssessment: null,
      providerCapabilities: {
        sourceTimestamps: false,
        fileReads: "unavailable",
        toolOutput: "unavailable",
        toolDurations: "unavailable",
        tokenUsage: "unavailable",
        interruptionSignal: "recorder_only"
      }
    });

    const projected = projectRunSummaryV1(summary, "claude-code");

    expect(projected.providerCapabilityLimitations).toMatchObject({
      state: "available",
      value: expect.arrayContaining([
        { capability: "token_usage", availability: "unavailable" }
      ]),
      origin: {
        type: "provider_capability",
        provider: { state: "known", value: "claude-code" }
      }
    });
  });

  it("projects all token totals with bounded observed supporting-event provenance", () => {
    const events = Array.from({ length: 1_001 }, (_, index) => {
      const sequence = index + 1;
      return event({
        id: `usage-${String(sequence).padStart(4, "0")}`,
        runId: "long-token-run",
        sequence,
        kind: "turn.completed",
        normalizedPayload: { usageCounters: { input: 1 } }
      });
    }).reverse();
    const summary = summarizeRun({
      run: {
        id: "long-token-run",
        provider: "codex-exec",
        capturePolicy: "standard",
        startedAt: 1_000,
        endedAt: 1_500
      },
      events,
      gitEvidence: null,
      validatedUntrackedFileCount: null,
      currentAssessment: null,
      providerCapabilities: {
        sourceTimestamps: false,
        fileReads: "unavailable",
        toolOutput: "partial",
        toolDurations: "unavailable",
        tokenUsage: "native",
        interruptionSignal: "partial"
      }
    });

    const projected = projectRunSummaryV1(summary, "codex-exec");

    expect(projected.observedTokenUsage).toMatchObject({
      state: "available",
      value: { inputTokens: 1_001 },
      omittedSupportingEventIds: 1
    });
    if (projected.observedTokenUsage.state !== "available") {
      throw new Error("Expected available observed token usage.");
    }
    expect(projected.observedTokenUsage.supportingEventIds).toHaveLength(1_000);
    expect(projected.observedTokenUsage.supportingEventIds.at(0)).toBe("usage-0001");
    expect(projected.observedTokenUsage.supportingEventIds.at(-1)).toBe("usage-1000");
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
      cursors,
      capturePolicy: "standard"
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
    }, { runId: "run-1", mode: "after", sourceRefs, cursors, capturePolicy: "standard" });
    expect(empty.window).toEqual({
      state: "empty",
      latestCommittedSequence: 9,
      hasEarlier: true,
      hasLater: false,
      earlierCursor: expect.any(String),
      laterCursor: null
    });
  });

  it("fails closed on contradictory event-window identity and chronology", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    const cursors = createCursorCodec(CURSOR_KEY);
    const context = {
      runId: "run-1",
      mode: "head" as const,
      sourceRefs,
      cursors,
      capturePolicy: "standard" as const
    };
    const invalidWindows: EventWindowRecord[] = [
      {
        events: [event({ runId: "other-run" })],
        latestCommittedSequence: 4,
        hasEarlier: false,
        hasLater: false
      },
      {
        events: [event({ id: "duplicate", sequence: 3 }), event({ id: "duplicate", sequence: 4 })],
        latestCommittedSequence: 4,
        hasEarlier: false,
        hasLater: false
      },
      {
        events: [event({ id: "first", sequence: 4 }), event({ id: "second", sequence: 4 })],
        latestCommittedSequence: 4,
        hasEarlier: false,
        hasLater: false
      },
      {
        events: [event({ id: "first", sequence: 4 }), event({ id: "second", sequence: 3 })],
        latestCommittedSequence: 4,
        hasEarlier: false,
        hasLater: false
      },
      {
        events: [event({ sequence: 5 })],
        latestCommittedSequence: 4,
        hasEarlier: false,
        hasLater: false
      }
    ];
    for (const window of invalidWindows) {
      expect(() => projectTrajectoryPageV1(window, context)).toThrow(/window/i);
    }
  });

  it("serializes no raw IDs, canonical payloads, paths, native content, or key material", () => {
    const sourceRefs = createSourceRefProjector(SOURCE_KEY);
    const cursors = createCursorCodec(CURSOR_KEY);
    const projected = [
      projectTrajectoryEventV1(event(), sourceRefs, "standard"),
      projectEventDetailV1(event(), "standard"),
      projectTrajectoryPageV1({
        events: [event()],
        latestCommittedSequence: 4,
        hasEarlier: false,
        hasLater: false
      }, { runId: "run-1", mode: "head", sourceRefs, cursors, capturePolicy: "standard" })
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
