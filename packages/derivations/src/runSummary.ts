import type { TraceEventV1 } from "@agentlens/core";

import { classifyTestCommand } from "./classifyTestCommand.js";
import { parseCommandEvidence } from "./commandEvidence.js";
import { derivationIdentity } from "./testDerivations.js";
import type {
  AssessmentNoteProjection,
  HumanAssessmentSummary,
  LikelyTestAttempts,
  LikelyTestsDetectedSummary,
  LikelyTestsSummary,
  ObservedTokenUsage,
  ProviderCapabilityLimitation,
  RunSummary,
  RunSummaryGitReference,
  RunSummaryInput,
  SummaryEvidence,
  TestDerivedKind,
  TestResultOutcome
} from "./types.js";

const DERIVATION_NAME = "test-command";
const DERIVATION_VERSION = "1";
const DERIVATION_ID = "test-command/1";
const IDENTITY_PREFIX = "agentlens-derivation-sha256:";

function asObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}

function compareChronology(left: TraceEventV1, right: TraceEventV1): number {
  return left.sequence - right.sequence ||
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.id.localeCompare(right.id);
}

function terminalCommand(event: TraceEventV1): event is TraceEventV1 & {
  readonly status: "completed" | "failed";
} {
  if (
    event.provenance !== "observed" ||
    event.kind !== "command" ||
    (event.status !== "completed" && event.status !== "failed")
  ) return false;
  if (event.source.itemType !== undefined && event.source.itemType !== "command_execution") {
    return false;
  }
  return event.source.eventType === undefined ||
    event.source.eventType === "item.completed" ||
    event.source.eventType === "item.failed";
}

function terminalFileChange(event: TraceEventV1): boolean {
  if (
    event.provenance !== "observed" ||
    event.kind !== "file.change" ||
    (event.status !== "completed" && event.status !== "failed")
  ) return false;
  if (event.source.itemType !== undefined && event.source.itemType !== "file_change") return false;
  return event.source.eventType === undefined ||
    event.source.eventType === "item.completed" ||
    event.source.eventType === "item.failed";
}

function availableEvidence<T>(
  value: T,
  provenance: NonNullable<SummaryEvidence<T>["provenance"]>,
  supportingEventIds: readonly string[] = [],
  supportingArtifactIds: readonly string[] = []
): SummaryEvidence<T> {
  return {
    value,
    availability: "available",
    provenance,
    supportingEventIds: [...supportingEventIds],
    supportingArtifactIds: [...supportingArtifactIds]
  };
}

function unavailableEvidence<T>(
  provenance: SummaryEvidence<T>["provenance"] = null,
  supportingEventIds: readonly string[] = [],
  supportingArtifactIds: readonly string[] = []
): SummaryEvidence<T> {
  return {
    value: null,
    availability: "unavailable",
    provenance,
    supportingEventIds: [...supportingEventIds],
    supportingArtifactIds: [...supportingArtifactIds]
  };
}

function trackedFinalDiff(
  reference: RunSummaryGitReference | undefined
): SummaryEvidence<"artifact" | "absent"> {
  if (reference === undefined) return unavailableEvidence();
  if (reference.state === "artifact") {
    return availableEvidence("artifact", "git_recovered", [], [reference.artifactId]);
  }
  if (reference.state === "absent") return availableEvidence("absent", "git_recovered");
  return unavailableEvidence("git_recovered");
}

function observedTokenUsage(
  events: readonly TraceEventV1[]
): SummaryEvidence<ObservedTokenUsage> {
  const totals: Record<keyof ObservedTokenUsage, number | null> = {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    cacheWriteInputTokens: null
  };
  const keys = [
    ["inputTokens", "input_tokens"],
    ["cachedInputTokens", "cached_input_tokens"],
    ["outputTokens", "output_tokens"],
    ["reasoningOutputTokens", "reasoning_output_tokens"],
    ["cacheWriteInputTokens", "cache_write_input_tokens"]
  ] as const;
  const supportingEventIds: string[] = [];

  for (const event of [...events].sort(compareChronology)) {
    if (event.provenance !== "observed" || event.kind !== "turn.completed") continue;
    let usage: Readonly<Record<string, unknown>> | undefined;
    try {
      usage = asObject(asObject(event.normalizedPayload)?.usage);
    } catch {
      usage = undefined;
    }
    if (!usage) continue;

    let observed = false;
    for (const [target, source] of keys) {
      const value = usage[source];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      totals[target] = (totals[target] ?? 0) + value;
      observed = true;
    }
    if (observed) supportingEventIds.push(event.id);
  }

  return supportingEventIds.length === 0
    ? unavailableEvidence()
    : availableEvidence({ ...totals }, "observed", supportingEventIds);
}

function capabilityLimitations(
  input: RunSummaryInput["providerCapabilities"]
): readonly ProviderCapabilityLimitation[] {
  const limitations: ProviderCapabilityLimitation[] = [];
  if (!input.sourceTimestamps) {
    limitations.push({ capability: "source_timestamps", availability: "unavailable" });
  }
  if (input.fileReads !== "native") {
    limitations.push({ capability: "file_reads", availability: input.fileReads });
  }
  if (input.toolOutput !== "native") {
    limitations.push({ capability: "tool_output", availability: input.toolOutput });
  }
  if (input.toolDurations !== "native") {
    limitations.push({ capability: "tool_durations", availability: input.toolDurations });
  }
  if (input.interruptionSignal !== "native") {
    limitations.push({
      capability: "interruption_signal",
      availability: input.interruptionSignal
    });
  }
  return limitations;
}

function noteArtifactIds(note: AssessmentNoteProjection): readonly string[] {
  return note.state === "artifact" ? [note.artifactId] : [];
}

function assessment(input: RunSummaryInput["currentAssessment"]): HumanAssessmentSummary {
  if (input === null) {
    return {
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
    };
  }
  return {
    verdict: input.verdict,
    taskCompleted: input.taskCompleted,
    note: { ...input.note },
    state: "explicit",
    availability: "available",
    provenance: "human",
    currentEventId: input.currentEventId,
    reviewedAt: input.reviewedAt,
    updatedAt: input.updatedAt,
    supportingEventIds: [input.currentEventId],
    supportingArtifactIds: noteArtifactIds(input.note)
  };
}

function expectedDerivedIdentity(
  runId: string,
  sourceEventId: string,
  derivedKind: TestDerivedKind
): Readonly<{ identity: string; eventId: string }> {
  const identity = derivationIdentity({
    runId,
    sourceEventId,
    name: DERIVATION_NAME,
    version: DERIVATION_VERSION,
    derivedKind
  });
  return {
    identity,
    eventId: `drv_${identity.slice(IDENTITY_PREFIX.length)}`
  };
}

function hasExactSourceRelationship(event: TraceEventV1, sourceEventId: string): boolean {
  return event.relationships.length === 1 &&
    event.relationships[0]?.type === "derived_from" &&
    event.relationships[0].eventId === sourceEventId &&
    event.derivation?.sourceEventIds.length === 1 &&
    event.derivation.sourceEventIds[0] === sourceEventId;
}

function payloadHasDerivationId(event: TraceEventV1): boolean {
  try {
    return asObject(event.normalizedPayload)?.derivationId === DERIVATION_ID;
  } catch {
    return false;
  }
}

function matchingDerivedEvent(
  events: readonly TraceEventV1[],
  source: TraceEventV1,
  kind: TestDerivedKind
): TraceEventV1 | undefined {
  const expected = expectedDerivedIdentity(source.runId, source.id, kind);
  return events.find((event) =>
    event.id === expected.eventId &&
    event.runId === source.runId &&
    event.kind === kind &&
    event.provenance === "derived" &&
    event.derivation?.name === DERIVATION_NAME &&
    event.derivation.version === DERIVATION_VERSION &&
    event.derivation.identity === expected.identity &&
    hasExactSourceRelationship(event, source.id) &&
    payloadHasDerivationId(event)
  );
}

function numericExitCode(event: TraceEventV1): number | null {
  try {
    const value = asObject(event.normalizedPayload)?.exitCode;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function sourceOutcome(event: TraceEventV1): TestResultOutcome {
  const exitCode = numericExitCode(event);
  if (exitCode === 0) return "passed";
  if (exitCode !== null || event.status === "failed") return "failed";
  return "unknown";
}

function durableOutcome(event: TraceEventV1 | undefined): TestResultOutcome | undefined {
  if (!event) return undefined;
  try {
    const outcome = asObject(event.normalizedPayload)?.outcome;
    return outcome === "passed" || outcome === "failed" || outcome === "unknown"
      ? outcome
      : undefined;
  } catch {
    return undefined;
  }
}

function likelyTests(input: RunSummaryInput): LikelyTestsSummary {
  const sources = input.events.filter(terminalCommand).sort(compareChronology);
  const attempts: Array<{
    sourceId: string;
    outcome: TestResultOutcome;
    derivedIds: readonly string[];
    missingExpected: number;
  }> = [];
  let omittedTerminalCommands = 0;
  let unavailableTerminalCommands = 0;

  for (const source of sources) {
    const commandEvent = matchingDerivedEvent(input.events, source, "test.command");
    const resultEvent = matchingDerivedEvent(input.events, source, "test.result");
    let classified = false;

    if (input.run.capturePolicy === "standard") {
      try {
        const evidence = parseCommandEvidence(source, input.run.capturePolicy);
        if (evidence?.state === "omitted") {
          omittedTerminalCommands += 1;
          unavailableTerminalCommands += 1;
        } else if (evidence?.state === "available") {
          classified = classifyTestCommand({
            command: evidence.redactedCommand,
            exitCode: numericExitCode(source),
            eventStatus: source.status
          }) !== null;
        } else {
          unavailableTerminalCommands += 1;
        }
      } catch {
        unavailableTerminalCommands += 1;
      }
    } else {
      omittedTerminalCommands += 1;
      unavailableTerminalCommands += 1;
    }

    if (!classified && commandEvent === undefined && resultEvent === undefined) continue;

    const derivedIds = [commandEvent?.id, resultEvent?.id]
      .filter((id): id is string => id !== undefined);
    const outcome = durableOutcome(resultEvent) ??
      (input.run.capturePolicy === "standard" && classified
        ? sourceOutcome(source)
        : source.status === "failed" ? "failed" : "unknown");
    attempts.push({
      sourceId: source.id,
      outcome,
      derivedIds,
      missingExpected: 2 - derivedIds.length
    });
  }

  const terminalIds = sources.map(({ id }) => id);
  if (attempts.length === 0) {
    if (input.run.capturePolicy !== "standard" || unavailableTerminalCommands > 0) {
      return {
        state: "unavailable_due_to_capture_policy",
        availability: "unavailable",
        provenance: null,
        supportingEventIds: terminalIds,
        supportingArtifactIds: [],
        omittedTerminalCommands
      };
    }
    return {
      state: "none_detected",
      availability: "available",
      provenance: "derived",
      supportingEventIds: terminalIds,
      supportingArtifactIds: [],
      omittedTerminalCommands
    };
  }

  const outcomes = attempts.map(({ outcome }) => outcome);
  const latest = outcomes.at(-1)!;
  const failed = outcomes.filter((outcome) => outcome === "failed").length;
  const attemptSummary: LikelyTestAttempts = {
    total: attempts.length,
    passed: outcomes.filter((outcome) => outcome === "passed").length,
    failed,
    unknown: outcomes.filter((outcome) => outcome === "unknown").length,
    latest,
    previousFailures: failed - (latest === "failed" ? 1 : 0)
  };
  const sourceEventIds = attempts.map(({ sourceId }) => sourceId);
  const derivedEventIds = attempts.flatMap(({ derivedIds }) => derivedIds);
  const missingExpected = attempts.reduce(
    (total, attempt) => total + attempt.missingExpected,
    0
  );
  const result: LikelyTestsDetectedSummary = {
    state: "detected",
    availability: "available",
    provenance: "derived",
    supportingEventIds: [...terminalIds, ...derivedEventIds],
    supportingArtifactIds: [],
    omittedTerminalCommands,
    attempts: attemptSummary,
    sourceEventIds,
    derivedEventIds,
    derivationId: DERIVATION_ID,
    durability: missingExpected === 0 ? "complete" : "incomplete",
    missingExpected,
    coverage: unavailableTerminalCommands === 0 ? "complete" : "partial"
  };
  return result;
}

export function summarizeRun(input: RunSummaryInput): RunSummary {
  const terminalCommands = input.events.filter(terminalCommand).sort(compareChronology);
  const failedTerminalCommands = terminalCommands.filter(({ status }) => status === "failed");
  const nativeFileChanges = input.events.filter(terminalFileChange).sort(compareChronology);
  const validatedUntracked = input.validatedUntrackedFileCount;
  const elapsed = input.run.endedAt === null
    ? unavailableEvidence<number>()
    : availableEvidence(
        Math.max(0, input.run.endedAt - input.run.startedAt),
        "recorder"
      );

  return {
    terminalCommands: availableEvidence(
      terminalCommands.length,
      "observed",
      terminalCommands.map(({ id }) => id)
    ),
    failedTerminalCommands: availableEvidence(
      failedTerminalCommands.length,
      "observed",
      failedTerminalCommands.map(({ id }) => id)
    ),
    nativeFileChanges: availableEvidence(
      nativeFileChanges.length,
      "observed",
      nativeFileChanges.map(({ id }) => id)
    ),
    trackedFinalDiff: trackedFinalDiff(input.gitEvidence?.trackedFinalDiff),
    untrackedFiles: validatedUntracked === null
      ? unavailableEvidence()
      : availableEvidence(
          validatedUntracked.count,
          "git_recovered",
          [],
          [validatedUntracked.artifactId]
        ),
    elapsedRecorderTimeMs: elapsed,
    observedTokenUsage: observedTokenUsage(input.events),
    likelyTests: likelyTests(input),
    assessment: assessment(input.currentAssessment),
    providerCapabilityLimitations: availableEvidence(
      capabilityLimitations(input.providerCapabilities),
      "provider"
    )
  };
}
