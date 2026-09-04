import type {
  AdapterCapabilities,
  CapturePolicy,
  TraceEventV1
} from "@agentlens/core";
import { codexExecCapabilities } from "@agentlens/core";
import { describe, expect, it } from "vitest";

import {
  buildTestDerivationDrafts,
  derivationIdentity,
  summarizeRun,
  type RunSummaryInput
} from "../src/index.js";

const RUN_ID = "run-summary-001";
const STARTED_AT = Date.parse("2026-08-30T12:00:00.000Z");

const providerCapabilities: AdapterCapabilities = {
  sourceTimestamps: false,
  fileReads: "unavailable",
  toolOutput: "partial",
  toolDurations: "unavailable",
  tokenUsage: "native",
  interruptionSignal: "partial"
};

function event(
  overrides: Partial<TraceEventV1> & Pick<TraceEventV1, "id" | "sequence" | "kind">
): TraceEventV1 {
  return {
    id: overrides.id,
    runId: RUN_ID,
    sequence: overrides.sequence,
    receivedAt: new Date(STARTED_AT + overrides.sequence * 1_000).toISOString(),
    kind: overrides.kind,
    status: "completed",
    provenance: "observed",
    source: { provider: "codex-exec" },
    relationships: [],
    summary: "Fixture event",
    ...overrides
  };
}

function command(options: {
  id: string;
  sequence: number;
  command?: string;
  status?: "completed" | "failed";
  exitCode?: number | null;
  omission?: "metadata-only" | "strict" | "capture-bound";
  normalizedPayload?: unknown;
}): TraceEventV1 {
  const status = options.status ?? "completed";
  const commandEvidence = options.omission === undefined
    ? options.command === undefined
      ? undefined
      : { state: "available" as const, redactedCommand: options.command }
    : { state: "omitted" as const, reason: options.omission };
  const normalizedPayload = options.normalizedPayload ?? {
    ...(commandEvidence === undefined ? {} : { commandEvidence }),
    ...(options.exitCode === undefined ? {} : { exitCode: options.exitCode })
  };

  return event({
    id: options.id,
    sequence: options.sequence,
    kind: "command",
    status,
    source: {
      provider: "codex-exec",
      eventType: status === "failed" ? "item.failed" : "item.completed",
      itemType: "command_execution",
      itemId: options.id
    },
    normalizedPayload
  });
}

function durableTestEvents(
  source: TraceEventV1,
  exitCode: number | null
): readonly [TraceEventV1, TraceEventV1] {
  if (source.status !== "completed" && source.status !== "failed") {
    throw new Error("Fixture source must be terminal.");
  }
  const drafts = buildTestDerivationDrafts({
    runId: source.runId,
    sourceEventId: source.id,
    sourceProvider: source.source.provider,
    eventStatus: source.status,
    exitCode,
    classification: {
      family: "pnpm",
      confidence: "high",
      commandShape: "direct",
      outcomeAttribution: "source_exit",
      derivationVersion: "test-command/2"
    }
  });
  return drafts.map((draft, index) => ({
    ...draft,
    sequence: 100 + source.sequence * 2 + index,
    receivedAt: new Date(STARTED_AT + (100 + source.sequence * 2 + index) * 1_000)
      .toISOString()
  })) as unknown as readonly [TraceEventV1, TraceEventV1];
}

function legacyDurableTestEvents(
  source: TraceEventV1,
  exitCode: number | null
): readonly [TraceEventV1, TraceEventV1] {
  const outcome = exitCode === 0 ? "passed" : exitCode !== null || source.status === "failed" ? "failed" : "unknown";
  const resultStatus = outcome === "passed" ? "completed" : outcome === "failed" ? "failed" : "unknown";
  const draft = (derivedKind: "test.command" | "test.result", normalizedPayload: Record<string, unknown>, status: TraceEventV1["status"]): TraceEventV1 => {
    const identity = derivationIdentity({
      runId: source.runId,
      sourceEventId: source.id,
      name: "test-command",
      version: "1",
      derivedKind
    });
    return {
      id: `drv_${identity.slice("agentlens-derivation-sha256:".length)}`,
      runId: source.runId,
      sequence: 100 + source.sequence * 2 + (derivedKind === "test.command" ? 0 : 1),
      receivedAt: new Date(STARTED_AT + (100 + source.sequence * 2) * 1_000).toISOString(),
      kind: derivedKind,
      status,
      provenance: "derived",
      source: { provider: source.source.provider },
      relationships: [{ type: "derived_from", eventId: source.id }],
      summary: "Legacy test derivation",
      normalizedPayload,
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: [source.id],
        confidence: "high",
        identity
      }
    };
  };

  return [
    draft("test.command", {
      family: "pnpm",
      confidence: "high",
      derivationId: "test-command/1"
    }, source.status),
    draft("test.result", {
      family: "pnpm",
      confidence: "high",
      outcome,
      ...(exitCode === null ? {} : { exitCode }),
      derivationId: "test-command/1"
    }, resultStatus)
  ];
}

function input(
  overrides: Partial<RunSummaryInput> = {}
): RunSummaryInput {
  return {
    run: {
      id: RUN_ID,
      provider: "codex-exec",
      capturePolicy: "standard",
      startedAt: STARTED_AT,
      endedAt: STARTED_AT + 2_500
    },
    events: [],
    gitEvidence: null,
    validatedUntrackedFileCount: null,
    currentAssessment: null,
    providerCapabilities,
    ...overrides
  };
}

describe("run summary evidence fields", () => {
  it("projects durable observed, Git, recorder, human, and provider evidence without collapsing provenance", () => {
    const completedCommand = command({
      id: "command-completed",
      sequence: 1,
      command: "echo ready",
      exitCode: 0
    });
    const failedCommand = command({
      id: "command-failed",
      sequence: 2,
      command: "command-that-failed",
      status: "failed",
      exitCode: 7
    });
    const fileChange = event({
      id: "file-change-completed",
      sequence: 3,
      kind: "file.change",
      source: {
        provider: "codex-exec",
        eventType: "item.completed",
        itemType: "file_change"
      },
      normalizedPayload: {
        changes: [{ path: "src/example.ts", kind: "modify" }]
      }
    });
    const usage = event({
      id: "turn-completed-with-usage",
      sequence: 4,
      kind: "turn.completed",
      normalizedPayload: {
        usageCounters: {
          input: 101,
          cachedInput: 11,
          output: 202,
          reasoningOutput: 31,
          cacheWriteInput: 7
        }
      }
    });

    const summary = summarizeRun(input({
      events: [usage, failedCommand, fileChange, completedCommand],
      gitEvidence: {
        trackedFinalDiff: { state: "artifact", artifactId: "artifact-diff" },
        untrackedMetadata: { state: "artifact", artifactId: "artifact-untracked" }
      },
      validatedUntrackedFileCount: {
        count: 2,
        artifactId: "artifact-untracked"
      },
      currentAssessment: {
        currentEventId: "assessment-current",
        verdict: "partial",
        taskCompleted: "uncertain",
        note: { state: "artifact", artifactId: "artifact-note" },
        reviewedAt: STARTED_AT + 2_000,
        updatedAt: STARTED_AT + 2_250
      }
    }));

    expect(summary.terminalCommands).toEqual({
      value: 2,
      availability: "available",
      provenance: "observed",
      supportingEventIds: ["command-completed", "command-failed"],
      supportingArtifactIds: []
    });
    expect(summary.failedTerminalCommands).toEqual({
      value: 1,
      availability: "available",
      provenance: "observed",
      supportingEventIds: ["command-failed"],
      supportingArtifactIds: []
    });
    expect(summary.nativeFileChanges).toEqual({
      value: 1,
      availability: "available",
      provenance: "observed",
      supportingEventIds: ["file-change-completed"],
      supportingArtifactIds: []
    });
    expect(summary.trackedFinalDiff).toEqual({
      value: "artifact",
      availability: "available",
      provenance: "git_recovered",
      supportingEventIds: [],
      supportingArtifactIds: ["artifact-diff"]
    });
    expect(summary.untrackedFiles).toEqual({
      value: 2,
      availability: "available",
      provenance: "git_recovered",
      supportingEventIds: [],
      supportingArtifactIds: ["artifact-untracked"]
    });
    expect(summary.elapsedRecorderTimeMs).toEqual({
      value: 2_500,
      availability: "available",
      provenance: "recorder",
      supportingEventIds: [],
      supportingArtifactIds: []
    });
    expect(summary.observedTokenUsage).toEqual({
      state: "available",
      value: {
        inputTokens: 101,
        cachedInputTokens: 11,
        outputTokens: 202,
        reasoningOutputTokens: 31,
        cacheWriteInputTokens: 7
      },
      availability: "available",
      provenance: "observed",
      supportingEventIds: ["turn-completed-with-usage"],
      supportingArtifactIds: [],
      omittedSupportingEventIds: 0
    });
    expect(summary.assessment).toMatchObject({
      state: "explicit",
      availability: "available",
      provenance: "human",
      currentEventId: "assessment-current",
      supportingEventIds: ["assessment-current"],
      supportingArtifactIds: ["artifact-note"]
    });
    expect(summary.providerCapabilityLimitations).toEqual({
      value: [
        { capability: "source_timestamps", availability: "unavailable" },
        { capability: "file_reads", availability: "unavailable" },
        { capability: "tool_output", availability: "partial" },
        { capability: "tool_durations", availability: "unavailable" },
        { capability: "interruption_signal", availability: "partial" }
      ],
      availability: "available",
      provenance: "provider",
      supportingEventIds: [],
      supportingArtifactIds: []
    });
  });

  it("sums each approved counter across chronological turn completions", () => {
    const later = event({
      id: "usage-later",
      sequence: 9,
      kind: "turn.completed",
      normalizedPayload: {
        usageCounters: {
          input: 3,
          cachedInput: 13,
          output: 19,
          reasoningOutput: 29,
          cacheWriteInput: 37
        }
      }
    });
    const earlier = event({
      id: "usage-earlier",
      sequence: 2,
      kind: "turn.completed",
      normalizedPayload: {
        usageCounters: {
          input: 2,
          cachedInput: 5,
          output: 7,
          reasoningOutput: 11,
          cacheWriteInput: 17
        }
      }
    });

    expect(summarizeRun(input({ events: [later, earlier] })).observedTokenUsage).toEqual({
      state: "available",
      value: {
        inputTokens: 5,
        cachedInputTokens: 18,
        outputTokens: 26,
        reasoningOutputTokens: 40,
        cacheWriteInputTokens: 54
      },
      availability: "available",
      provenance: "observed",
      supportingEventIds: ["usage-earlier", "usage-later"],
      supportingArtifactIds: [],
      omittedSupportingEventIds: 0
    });
  });

  it("preserves token totals while bounding observed supporting IDs in canonical chronology", () => {
    const events = Array.from({ length: 1_001 }, (_, index) => {
      const sequence = index + 1;
      return event({
        id: `usage-${String(sequence).padStart(4, "0")}`,
        sequence,
        kind: "turn.completed",
        normalizedPayload: { usageCounters: { input: 1 } }
      });
    }).reverse();

    const usage = summarizeRun(input({ events })).observedTokenUsage;

    expect(usage).toMatchObject({
      state: "available",
      value: {
        inputTokens: 1_001,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningOutputTokens: null,
        cacheWriteInputTokens: null
      },
      omittedSupportingEventIds: 1
    });
    expect(usage.supportingEventIds).toHaveLength(1_000);
    expect(usage.supportingEventIds.at(0)).toBe("usage-0001");
    expect(usage.supportingEventIds.at(-1)).toBe("usage-1000");
  });

  it("leaves never-emitted counters null and ignores invalid or overflow counters", () => {
    const usage = event({
      id: "usage-partial-and-invalid",
      sequence: 2,
      kind: "turn.completed",
      normalizedPayload: {
        usageCounters: {
          input: -1,
          cachedInput: 0.5,
          output: 9,
          reasoningOutput: Number.MAX_SAFE_INTEGER + 1,
          cacheWriteInput: Number.NaN
        }
      }
    });

    expect(summarizeRun(input({ events: [usage] })).observedTokenUsage).toEqual({
      state: "available",
      value: {
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: 9,
        reasoningOutputTokens: null,
        cacheWriteInputTokens: null
      },
      availability: "available",
      provenance: "observed",
      supportingEventIds: ["usage-partial-and-invalid"],
      supportingArtifactIds: [],
      omittedSupportingEventIds: 0
    });
  });

  it("reports an active standard run as waiting for provider usage", () => {
    const summary = summarizeRun(input({
      run: { ...input().run, endedAt: null }
    }));

    expect(summary.observedTokenUsage).toEqual({
      state: "unavailable",
      value: null,
      availability: "unavailable",
      provenance: null,
      reason: "not_yet_available",
      supportingEventIds: [],
      supportingArtifactIds: [],
      omittedSupportingEventIds: 0
    });
    expect(summary.untrackedFiles).toEqual({
      value: null,
      availability: "unavailable",
      provenance: null,
      supportingEventIds: [],
      supportingArtifactIds: []
    });
  });

  it.each(["metadata-only", "strict"] as const)(
    "reports %s token usage as unavailable by capture policy",
    (capturePolicy) => {
      const summary = summarizeRun(input({
        run: { ...input().run, capturePolicy },
        events: [event({
          id: `${capturePolicy}-usage`,
          sequence: 1,
          kind: "turn.completed",
          normalizedPayload: { usageCounters: { input: 10 } }
        })]
      }));

      expect(summary.observedTokenUsage).toEqual({
        state: "unavailable",
        value: null,
        availability: "unavailable",
        provenance: null,
        reason: "capture_policy",
        supportingEventIds: [],
        supportingArtifactIds: [],
        omittedSupportingEventIds: 0
      });
    }
  );

  it("recognizes legacy redaction markers only to report token usage redacted by policy", () => {
    const legacy = event({
      id: "legacy-redacted-usage",
      sequence: 2,
      kind: "turn.completed",
      normalizedPayload: {
        usage: {
          input_tokens: "[[REDACTED:json-usage:hmac-sha256:0123456789abcdef0123456789abcdef]]"
        }
      }
    });

    expect(summarizeRun(input({
      run: { ...input().run, endedAt: STARTED_AT + 2_000 },
      events: [legacy]
    })).observedTokenUsage).toEqual({
      state: "unavailable",
      value: null,
      availability: "unavailable",
      provenance: null,
      reason: "redacted_by_policy",
      supportingEventIds: ["legacy-redacted-usage"],
      supportingArtifactIds: [],
      omittedSupportingEventIds: 0
    });
  });

  it("bounds redacted token-usage supporting IDs in canonical chronology", () => {
    const events = Array.from({ length: 1_001 }, (_, index) => {
      const sequence = index + 1;
      return event({
        id: `redacted-usage-${String(sequence).padStart(4, "0")}`,
        sequence,
        kind: "turn.completed",
        normalizedPayload: {
          usage: {
            input_tokens: "[[REDACTED:json-usage:hmac-sha256:0123456789abcdef0123456789abcdef]]"
          }
        }
      });
    }).reverse();

    const usage = summarizeRun(input({ events })).observedTokenUsage;

    expect(usage).toMatchObject({
      state: "unavailable",
      reason: "redacted_by_policy",
      omittedSupportingEventIds: 1
    });
    expect(usage.supportingEventIds).toHaveLength(1_000);
    expect(usage.supportingEventIds.at(0)).toBe("redacted-usage-0001");
    expect(usage.supportingEventIds.at(-1)).toBe("redacted-usage-1000");
  });

  it("reports a terminal standard run without provider usage as not captured", () => {
    const completed = event({
      id: "terminal-without-usage",
      sequence: 2,
      kind: "turn.completed"
    });

    expect(summarizeRun(input({ events: [completed] })).observedTokenUsage).toEqual({
      state: "unavailable",
      value: null,
      availability: "unavailable",
      provenance: null,
      reason: "not_captured",
      supportingEventIds: [],
      supportingArtifactIds: [],
      omittedSupportingEventIds: 0
    });
  });

  it("declares Codex token usage native once normalized usage counters exist", () => {
    expect(codexExecCapabilities).toMatchObject({ tokenUsage: "native" });
    expect(summarizeRun(input()).providerCapabilityLimitations.value)
      .not.toContainEqual({ capability: "token_usage", availability: "unavailable" });
  });

  it("distinguishes an absent tracked diff from unavailable Git evidence", () => {
    const absent = summarizeRun(input({
      gitEvidence: {
        trackedFinalDiff: { state: "absent" },
        untrackedMetadata: { state: "absent" }
      }
    }));
    const unavailable = summarizeRun(input());

    expect(absent.trackedFinalDiff).toMatchObject({
      value: "absent",
      availability: "available",
      provenance: "git_recovered"
    });
    expect(unavailable.trackedFinalDiff).toMatchObject({
      value: null,
      availability: "unavailable",
      provenance: null
    });
  });
});

describe("likely-test summaries", () => {
  it("returns none_detected for clean standard evidence with no recognized tests", () => {
    const source = command({
      id: "ordinary-command",
      sequence: 1,
      command: "echo ready",
      exitCode: 0
    });

    expect(summarizeRun(input({ events: [source] })).likelyTests).toMatchObject({
      state: "none_detected",
      availability: "available",
      provenance: "derived",
      supportingEventIds: ["ordinary-command"],
      supportingArtifactIds: []
    });
  });

  it.each(["metadata-only", "strict"] as const)(
    "returns unavailable for %s without inspecting omitted command content",
    (capturePolicy: CapturePolicy) => {
      const normalizedPayload = Object.defineProperty({}, "command", {
        enumerable: true,
        get(): never {
          throw new Error("omitted command content was inspected");
        }
      });
      const source = command({
        id: `${capturePolicy}-command`,
        sequence: 1,
        normalizedPayload
      });

      expect(summarizeRun(input({
        run: { ...input().run, capturePolicy },
        events: [source]
      })).likelyTests).toMatchObject({
        state: "unavailable_due_to_capture_policy",
        availability: "unavailable",
        provenance: null
      });
    }
  );

  it("returns unavailable when standard evidence is only capture-bound", () => {
    const source = command({
      id: "capture-bound-command",
      sequence: 1,
      omission: "capture-bound",
      exitCode: 0
    });

    expect(summarizeRun(input({ events: [source] })).likelyTests).toMatchObject({
      state: "unavailable_due_to_capture_policy",
      omittedTerminalCommands: 1
    });
  });

  it("returns unavailable for available non-test evidence mixed with omission", () => {
    const ordinary = command({
      id: "ordinary-command",
      sequence: 1,
      command: "echo ready",
      exitCode: 0
    });
    const omitted = command({
      id: "omitted-command",
      sequence: 2,
      omission: "capture-bound",
      exitCode: 0
    });

    expect(summarizeRun(input({ events: [ordinary, omitted] })).likelyTests)
      .toMatchObject({
        state: "unavailable_due_to_capture_policy",
        omittedTerminalCommands: 1
      });
  });

  it.each([
    { name: "pass", status: "completed" as const, exitCode: 0, outcome: "passed" },
    { name: "failure", status: "failed" as const, exitCode: 7, outcome: "failed" }
  ])("detects a durable test $name", ({ status, exitCode, outcome }) => {
    const source = command({
      id: `test-${outcome}`,
      sequence: 1,
      command: "pnpm test",
      status,
      exitCode
    });
    const durable = durableTestEvents(source, exitCode);

    expect(summarizeRun(input({ events: [source, ...durable] })).likelyTests)
      .toMatchObject({
        state: "detected",
        attempts: {
          total: 1,
          passed: outcome === "passed" ? 1 : 0,
          failed: outcome === "failed" ? 1 : 0,
          unknown: 0,
          latest: outcome,
          previousFailures: 0
        },
        sourceEventIds: [source.id],
        derivedEventIds: [durable[0].id, durable[1].id],
        derivationId: "test-command/2",
        durability: "complete",
        missingExpected: 0,
        coverage: "complete",
        omittedTerminalCommands: 0
      });
  });

  it("keeps persisted v1 evidence readable without requiring v2 payload fields", () => {
    const source = command({
      id: "legacy-test-source",
      sequence: 1,
      command: "pnpm test",
      exitCode: 0
    });
    const legacy = legacyDurableTestEvents(source, 0);

    expect(summarizeRun(input({ events: [source, ...legacy] })).likelyTests).toMatchObject({
      state: "detected",
      derivationId: "test-command/1",
      sourceEventIds: [source.id],
      derivedEventIds: [legacy[0].id, legacy[1].id],
      attempts: { total: 1, passed: 1, failed: 0, unknown: 0, latest: "passed" },
      durability: "complete",
      missingExpected: 0
    });
  });

  it("selects persisted v2 evidence over v1 for one source event without double counting", () => {
    const source = command({
      id: "versioned-test-source",
      sequence: 1,
      command: "pnpm test",
      exitCode: 0
    });
    const legacy = legacyDurableTestEvents(source, 0);
    const current = durableTestEvents(source, 0);

    expect(summarizeRun(input({ events: [source, ...legacy, ...current] })).likelyTests).toMatchObject({
      state: "detected",
      derivationId: "test-command/2",
      sourceEventIds: [source.id],
      derivedEventIds: [current[0].id, current[1].id],
      attempts: { total: 1, passed: 1, failed: 0, unknown: 0, latest: "passed" },
      durability: "complete",
      missingExpected: 0
    });
  });

  it("derives v2 at read time for a classifiable standard source without appending evidence", () => {
    const source = command({
      id: "read-time-v2-source",
      sequence: 1,
      command: "pnpm test",
      exitCode: 0
    });
    const events = [source] as const;
    const summary = summarizeRun(input({ events }));

    expect(summary.likelyTests).toMatchObject({
      state: "detected",
      derivationId: "test-command/2",
      sourceEventIds: [source.id],
      derivedEventIds: [],
      attempts: { total: 1, passed: 1, failed: 0, unknown: 0, latest: "passed" },
      durability: "incomplete",
      missingExpected: 2
    });
    expect(events).toEqual([source]);
  });

  it("does not attribute a compound shell's aggregate exit to its individual test result", () => {
    const source = command({
      id: "compound-test-source",
      sequence: 1,
      command: "/bin/zsh -lc \"pnpm vitest --run a.test.ts && pnpm typecheck\"",
      exitCode: 0
    });

    expect(summarizeRun(input({ events: [source] })).likelyTests).toMatchObject({
      state: "detected",
      derivationId: "test-command/2",
      attempts: { total: 1, passed: 0, failed: 0, unknown: 1, latest: "unknown" },
      durability: "incomplete",
      missingExpected: 2
    });
  });

  it.each([
    {
      name: "failed then passed",
      firstStatus: "failed" as const,
      firstExit: 1,
      secondStatus: "completed" as const,
      secondExit: 0,
      latest: "passed",
      previousFailures: 1
    },
    {
      name: "passed then failed",
      firstStatus: "completed" as const,
      firstExit: 0,
      secondStatus: "failed" as const,
      secondExit: 1,
      latest: "failed",
      previousFailures: 0
    }
  ])("projects $name without an unqualified success claim", (fixture) => {
    const first = command({
      id: "test-first",
      sequence: 1,
      command: "pnpm test",
      status: fixture.firstStatus,
      exitCode: fixture.firstExit
    });
    const second = command({
      id: "test-second",
      sequence: 2,
      command: "pnpm test",
      status: fixture.secondStatus,
      exitCode: fixture.secondExit
    });
    const firstDurable = durableTestEvents(first, fixture.firstExit);
    const secondDurable = durableTestEvents(second, fixture.secondExit);

    const likelyTests = summarizeRun(input({
      events: [first, ...firstDurable, second, ...secondDurable]
    })).likelyTests;

    expect(likelyTests).toMatchObject({
      state: "detected",
      attempts: {
        total: 2,
        passed: 1,
        failed: 1,
        unknown: 0,
        latest: fixture.latest,
        previousFailures: fixture.previousFailures
      },
      durability: "complete",
      missingExpected: 0,
      coverage: "complete",
      omittedTerminalCommands: 0,
      derivationId: "test-command/2"
    });
    expect(JSON.stringify(likelyTests)).not.toMatch(/tests passed/i);
  });

  it("keeps a durable detection while marking omitted command coverage partial", () => {
    const source = command({
      id: "test-source",
      sequence: 1,
      command: "pnpm test",
      exitCode: 0
    });
    const omitted = command({
      id: "omitted-source",
      sequence: 2,
      omission: "capture-bound",
      exitCode: 0
    });
    const durable = durableTestEvents(source, 0);

    expect(summarizeRun(input({ events: [source, ...durable, omitted] })).likelyTests)
      .toMatchObject({
        state: "detected",
        coverage: "partial",
        omittedTerminalCommands: 1
      });
  });

  it.each([
    { name: "neither derived event", include: 0, missingExpected: 2, durability: "incomplete" },
    { name: "only test.command", include: 1, missingExpected: 1, durability: "incomplete" },
    { name: "both derived events", include: 2, missingExpected: 0, durability: "complete" }
  ] as const)("reports durability when $name is durable", (fixture) => {
    const source = command({
      id: "test-source",
      sequence: 1,
      command: "pnpm test",
      exitCode: 0
    });
    const durable = durableTestEvents(source, 0);

    expect(summarizeRun(input({
      events: [source, ...durable.slice(0, fixture.include)]
    })).likelyTests).toMatchObject({
      state: "detected",
      durability: fixture.durability,
      missingExpected: fixture.missingExpected
    });
  });

  it("orders attempts and durable IDs by source chronology instead of row order", () => {
    const earlier = command({
      id: "source-earlier",
      sequence: 10,
      command: "pnpm test",
      status: "failed",
      exitCode: 1
    });
    const later = command({
      id: "source-later",
      sequence: 20,
      command: "pnpm test",
      exitCode: 0
    });
    const earlierDurable = durableTestEvents(earlier, 1);
    const laterDurable = durableTestEvents(later, 0);

    const likelyTests = summarizeRun(input({
      events: [
        laterDurable[1],
        later,
        earlierDurable[1],
        earlier,
        laterDurable[0],
        earlierDurable[0]
      ]
    })).likelyTests;

    expect(likelyTests).toMatchObject({
      state: "detected",
      sourceEventIds: ["source-earlier", "source-later"],
      derivedEventIds: [
        earlierDurable[0].id,
        earlierDurable[1].id,
        laterDurable[0].id,
        laterDurable[1].id
      ],
      attempts: {
        latest: "passed",
        previousFailures: 1
      }
    });
  });

  it("does not accept a deterministic derived ID with an unrelated source relationship", () => {
    const source = command({
      id: "test-source",
      sequence: 1,
      command: "pnpm test",
      exitCode: 0
    });
    const [commandDraft, resultDraft] = durableTestEvents(source, 0);
    const unrelated = {
      ...resultDraft,
      relationships: [{ type: "derived_from" as const, eventId: "other-source" }],
      derivation: {
        ...resultDraft.derivation!,
        sourceEventIds: ["other-source"]
      }
    } as TraceEventV1;

    expect(summarizeRun(input({ events: [source, commandDraft, unrelated] })).likelyTests)
      .toMatchObject({
        state: "detected",
        durability: "incomplete",
        missingExpected: 1,
        derivedEventIds: [commandDraft.id]
      });
  });

  it.each([
    {
      forgedField: "family",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        normalizedPayload: {
          ...(derived.normalizedPayload as Record<string, unknown>),
          family: "jest"
        }
      })
    },
    {
      forgedField: "confidence",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        normalizedPayload: {
          ...(derived.normalizedPayload as Record<string, unknown>),
          confidence: "medium"
        }
      })
    },
    {
      forgedField: "status",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        status: "completed"
      })
    },
    {
      forgedField: "provider",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        source: { provider: "claude-code" }
      })
    }
  ])("rejects test.command with forged $forgedField semantics", ({ mutate }) => {
    const source = command({
      id: "failed-test-source",
      sequence: 1,
      command: "pnpm test",
      status: "failed",
      exitCode: 7
    });
    const [commandDraft, resultDraft] = durableTestEvents(source, 7);

    expect(summarizeRun(input({
      events: [source, mutate(commandDraft), resultDraft]
    })).likelyTests).toMatchObject({
      state: "detected",
      attempts: {
        passed: 0,
        failed: 1,
        unknown: 0,
        latest: "failed"
      },
      durability: "incomplete",
      missingExpected: 1,
      derivedEventIds: [resultDraft.id]
    });
  });

  it.each([
    {
      forgedField: "family",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        normalizedPayload: {
          ...(derived.normalizedPayload as Record<string, unknown>),
          family: "jest"
        }
      })
    },
    {
      forgedField: "confidence",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        normalizedPayload: {
          ...(derived.normalizedPayload as Record<string, unknown>),
          confidence: "medium"
        }
      })
    },
    {
      forgedField: "outcome",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        normalizedPayload: {
          ...(derived.normalizedPayload as Record<string, unknown>),
          outcome: "passed"
        }
      })
    },
    {
      forgedField: "status",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        status: "completed"
      })
    },
    {
      forgedField: "exitCode",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        normalizedPayload: {
          ...(derived.normalizedPayload as Record<string, unknown>),
          exitCode: 0
        }
      })
    },
    {
      forgedField: "provider",
      mutate: (derived: TraceEventV1): TraceEventV1 => ({
        ...derived,
        source: { provider: "claude-code" }
      })
    }
  ])("rejects test.result with forged $forgedField semantics", ({ mutate }) => {
    const source = command({
      id: "failed-test-source",
      sequence: 1,
      command: "pnpm test",
      status: "failed",
      exitCode: 7
    });
    const [commandDraft, resultDraft] = durableTestEvents(source, 7);

    expect(summarizeRun(input({
      events: [source, commandDraft, mutate(resultDraft)]
    })).likelyTests).toMatchObject({
      state: "detected",
      attempts: {
        passed: 0,
        failed: 1,
        unknown: 0,
        latest: "failed"
      },
      durability: "incomplete",
      missingExpected: 1,
      derivedEventIds: [commandDraft.id]
    });
  });

  it.each([
    { nativeField: "sessionId", extraSource: { sessionId: "session-native" } },
    { nativeField: "threadId", extraSource: { threadId: "thread-native" } },
    { nativeField: "turnId", extraSource: { turnId: "turn-native" } },
    { nativeField: "itemId", extraSource: { itemId: "item-native" } },
    { nativeField: "toolId", extraSource: { toolId: "tool-native" } },
    { nativeField: "eventType", extraSource: { eventType: "item.failed" } },
    { nativeField: "itemType", extraSource: { itemType: "command_execution" } },
    { nativeField: "correlationId", extraSource: { correlationId: "correlation-native" } }
  ] satisfies readonly {
    nativeField: string;
    extraSource: Partial<TraceEventV1["source"]>;
  }[])("rejects derived evidence with native source $nativeField", ({ extraSource }) => {
    const source = command({
      id: "native-source-context",
      sequence: 1,
      command: "pnpm test",
      status: "failed",
      exitCode: 7
    });
    const [commandDraft, resultDraft] = durableTestEvents(source, 7);
    const forgedResult = {
      ...resultDraft,
      source: { ...resultDraft.source, ...extraSource }
    } as TraceEventV1;

    expect(summarizeRun(input({
      events: [source, commandDraft, forgedResult]
    })).likelyTests).toMatchObject({
      state: "detected",
      attempts: {
        passed: 0,
        failed: 1,
        unknown: 0,
        latest: "failed"
      },
      durability: "incomplete",
      missingExpected: 1,
      derivedEventIds: [commandDraft.id]
    });
  });

  it.each([
    {
      nativeForm: "inline payload",
      nativePayload: { storage: "inline", redacted: { type: "item.failed" } }
    },
    {
      nativeForm: "artifact reference",
      nativePayload: { storage: "artifact", artifactId: "native-artifact" }
    },
    {
      nativeForm: "omission reference",
      nativePayload: { storage: "omitted", reason: "strict" }
    }
  ] satisfies readonly {
    nativeForm: string;
    nativePayload: NonNullable<TraceEventV1["nativePayload"]>;
  }[])("rejects derived evidence with native $nativeForm", ({ nativePayload }) => {
    const source = command({
      id: "native-payload-context",
      sequence: 1,
      command: "pnpm test",
      status: "failed",
      exitCode: 7
    });
    const [commandDraft, resultDraft] = durableTestEvents(source, 7);
    const forgedResult = { ...resultDraft, nativePayload } as TraceEventV1;

    expect(summarizeRun(input({
      events: [source, commandDraft, forgedResult]
    })).likelyTests).toMatchObject({
      state: "detected",
      attempts: {
        passed: 0,
        failed: 1,
        unknown: 0,
        latest: "failed"
      },
      durability: "incomplete",
      missingExpected: 1,
      derivedEventIds: [commandDraft.id]
    });
  });

  it("validates derived source provider against the run provider", () => {
    const source = {
      ...command({
        id: "provider-mismatch-source",
        sequence: 1,
        command: "pnpm test",
        status: "failed",
        exitCode: 7
      }),
      source: {
        provider: "claude-code" as const,
        eventType: "item.failed",
        itemType: "command_execution",
        itemId: "provider-mismatch-source"
      }
    };
    const durable = durableTestEvents(source, 7);

    expect(summarizeRun(input({ events: [source, ...durable] })).likelyTests)
      .toMatchObject({
        state: "detected",
        attempts: { latest: "failed" },
        durability: "incomplete",
        missingExpected: 2,
        derivedEventIds: []
      });
  });

  it("uses a valid durable detection under metadata-only without reading command content", () => {
    const normalizedPayload = Object.defineProperty({ exitCode: 0 }, "commandEvidence", {
      enumerable: true,
      get(): never {
        throw new Error("metadata-only command evidence was inspected");
      }
    });
    const source = command({
      id: "metadata-test-source",
      sequence: 1,
      normalizedPayload
    });
    const durable = durableTestEvents(source, 0);

    expect(summarizeRun(input({
      run: { ...input().run, capturePolicy: "metadata-only" },
      events: [source, ...durable]
    })).likelyTests).toMatchObject({
      state: "detected",
      attempts: { latest: "passed" },
      durability: "complete",
      missingExpected: 0,
      coverage: "partial",
      omittedTerminalCommands: 1
    });
  });
});

describe("human assessment projection", () => {
  it("projects missing assessment as unreviewed without inventing human evidence", () => {
    expect(summarizeRun(input()).assessment).toEqual({
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "absent" },
      state: "projected",
      availability: "unavailable",
      provenance: null,
      currentEventId: null,
      reviewedAt: null,
      updatedAt: null,
      supportingEventIds: [],
      supportingArtifactIds: []
    });
  });

  it("keeps explicit unreviewed distinguishable as timestamped human evidence", () => {
    expect(summarizeRun(input({
      currentAssessment: {
        currentEventId: "assessment-unreviewed",
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "artifact", artifactId: "assessment-note" },
        reviewedAt: STARTED_AT + 1_000,
        updatedAt: STARTED_AT + 2_000
      }
    })).assessment).toEqual({
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "artifact", artifactId: "assessment-note" },
      state: "explicit",
      availability: "available",
      provenance: "human",
      currentEventId: "assessment-unreviewed",
      reviewedAt: STARTED_AT + 1_000,
      updatedAt: STARTED_AT + 2_000,
      supportingEventIds: ["assessment-unreviewed"],
      supportingArtifactIds: ["assessment-note"]
    });
  });
});

describe("recorder elapsed-time evidence", () => {
  it("keeps an invalid negative span unavailable while preserving a known zero span", () => {
    const invalid = summarizeRun(input({
      run: {
        ...input().run,
        startedAt: STARTED_AT + 10,
        endedAt: STARTED_AT
      }
    }));
    const zero = summarizeRun(input({
      run: {
        ...input().run,
        startedAt: STARTED_AT,
        endedAt: STARTED_AT
      }
    }));

    expect(invalid.elapsedRecorderTimeMs).toEqual({
      value: null,
      availability: "unavailable",
      provenance: null,
      supportingEventIds: [],
      supportingArtifactIds: []
    });
    expect(zero.elapsedRecorderTimeMs).toEqual({
      value: 0,
      availability: "available",
      provenance: "recorder",
      supportingEventIds: [],
      supportingArtifactIds: []
    });
  });
});
