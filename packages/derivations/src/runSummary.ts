import type { TraceEventV1 } from "@agentlens/core";

import { classifyTestCommand } from "./classifyTestCommand.js";
import { parseCommandEvidence } from "./commandEvidence.js";
import {
  buildTestDerivationDrafts,
  derivationIdentity
} from "./testDerivations.js";
import type {
  AssessmentNoteProjection,
  HumanAssessmentSummary,
  LikelyTestAttempts,
  LikelyTestsDetectedSummary,
  LikelyTestsSummary,
  ObservedTokenUsage,
  ObservedTokenUsageSummary,
  ProviderCapabilityLimitation,
  RunSummary,
  RunSummaryGitReference,
  RunSummaryInput,
  SummaryEvidence,
  TestCommandClassification,
  TestCommandClassificationV1,
  TestDerivationDraft,
  TestDerivedKind,
  TestResultOutcome
} from "./types.js";

const DERIVATION_NAME = "test-command";
const DERIVATION_V1_VERSION = "1";
const DERIVATION_V2_VERSION = "2";
const DERIVATION_V1_ID = "test-command/1";
const DERIVATION_V2_ID = "test-command/2";
const IDENTITY_PREFIX = "agentlens-derivation-sha256:";
const TEST_FAMILIES = new Set<TestCommandClassification["family"]>([
  "pytest",
  "jest",
  "vitest",
  "npm",
  "pnpm",
  "yarn",
  "cargo",
  "go",
  "maven",
  "gradle"
]);

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

const TOKEN_USAGE_COUNTER_KEYS = [
  ["inputTokens", "input"],
  ["cachedInputTokens", "cachedInput"],
  ["outputTokens", "output"],
  ["reasoningOutputTokens", "reasoningOutput"],
  ["cacheWriteInputTokens", "cacheWriteInput"]
] as const;
const MAX_TOKEN_USAGE_SUPPORTING_EVENT_IDS = 1_000;

const LEGACY_TOKEN_USAGE_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "cache_write_input_tokens"
] as const;

const LEGACY_REDACTION_MARKER = /^\[\[REDACTED:[a-z0-9_-]+(?::hmac-sha256:[a-f0-9]{32})?\]\]$/;

function legacyUsageHasRedactionMarker(event: TraceEventV1): boolean {
  let usage: Readonly<Record<string, unknown>> | undefined;
  try {
    usage = asObject(asObject(event.normalizedPayload)?.usage);
  } catch {
    usage = undefined;
  }
  if (usage === undefined) return false;
  return LEGACY_TOKEN_USAGE_KEYS.some((key) => {
    const value = usage[key];
    return typeof value === "string" && LEGACY_REDACTION_MARKER.test(value);
  });
}

function boundedTokenUsageSupportingEventIds(eventIds: readonly string[]) {
  return {
    supportingEventIds: eventIds.slice(0, MAX_TOKEN_USAGE_SUPPORTING_EVENT_IDS),
    omittedSupportingEventIds: Math.max(0, eventIds.length - MAX_TOKEN_USAGE_SUPPORTING_EVENT_IDS)
  };
}

function observedTokenUsage(input: RunSummaryInput): ObservedTokenUsageSummary {
  const totals: Record<keyof ObservedTokenUsage, number | null> = {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    cacheWriteInputTokens: null
  };
  const supportingEventIds: string[] = [];

  if (input.run.capturePolicy !== "standard") {
    return {
      state: "unavailable",
      value: null,
      availability: "unavailable",
      provenance: null,
      reason: "capture_policy",
      supportingEventIds: [],
      supportingArtifactIds: [],
      omittedSupportingEventIds: 0
    };
  }

  const observedTurnCompletions = [...input.events]
    .sort(compareChronology)
    .filter((event) => event.provenance === "observed" && event.kind === "turn.completed");

  for (const event of observedTurnCompletions) {
    let usageCounters: Readonly<Record<string, unknown>> | undefined;
    try {
      usageCounters = asObject(asObject(event.normalizedPayload)?.usageCounters);
    } catch {
      usageCounters = undefined;
    }

    let observed = false;
    for (const [target, source] of TOKEN_USAGE_COUNTER_KEYS) {
      const value = usageCounters?.[source];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) continue;
      const next = (totals[target] ?? 0) + value;
      if (!Number.isSafeInteger(next)) continue;
      totals[target] = next;
      observed = true;
    }
    if (observed) supportingEventIds.push(event.id);
  }

  if (supportingEventIds.length > 0) {
    return {
      state: "available",
      value: { ...totals },
      availability: "available",
      provenance: "observed",
      ...boundedTokenUsageSupportingEventIds(supportingEventIds),
      supportingArtifactIds: []
    };
  }
  const redactedEventIds = observedTurnCompletions
    .filter(legacyUsageHasRedactionMarker)
    .map(({ id }) => id);
  if (redactedEventIds.length > 0) {
    return {
      state: "unavailable",
      value: null,
      availability: "unavailable",
      provenance: null,
      reason: "redacted_by_policy",
      ...boundedTokenUsageSupportingEventIds(redactedEventIds),
      supportingArtifactIds: []
    };
  }
  return {
    state: "unavailable",
    value: null,
    availability: "unavailable",
    provenance: null,
    reason: input.run.endedAt === null ? "not_yet_available" : "not_captured",
    supportingEventIds: [],
    supportingArtifactIds: [],
    omittedSupportingEventIds: 0
  };
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
  if (input.tokenUsage !== "native") {
    limitations.push({ capability: "token_usage", availability: input.tokenUsage });
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
  version: "1" | "2",
  derivedKind: TestDerivedKind
): Readonly<{ identity: string; eventId: string }> {
  const identity = derivationIdentity({
    runId,
    sourceEventId,
    name: DERIVATION_NAME,
    version,
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

function structurallyMatchingDerivedEvent(
  events: readonly TraceEventV1[],
  source: TraceEventV1,
  version: "1" | "2",
  kind: TestDerivedKind
): TraceEventV1 | undefined {
  const expected = expectedDerivedIdentity(source.runId, source.id, version, kind);
  return events.find((event) =>
    event.id === expected.eventId &&
    event.runId === source.runId &&
    event.kind === kind &&
    event.provenance === "derived" &&
    event.derivation?.name === DERIVATION_NAME &&
    event.derivation.version === version &&
    event.derivation.identity === expected.identity &&
    hasExactSourceRelationship(event, source.id)
  );
}

function classificationFromDerivedEvent(
  event: TraceEventV1 | undefined,
  version: "1" | "2"
): TestCommandClassificationV1 | TestCommandClassification | undefined {
  if (!event) return undefined;
  try {
    const payload = asObject(event.normalizedPayload);
    const family = payload?.family;
    const confidence = payload?.confidence;
    if (
      typeof family !== "string" ||
      !TEST_FAMILIES.has(family as TestCommandClassification["family"]) ||
      (confidence !== "high" && confidence !== "medium") ||
      event.derivation?.confidence !== confidence
    ) return undefined;
    if (version === "1") {
      if (payload?.derivationId !== DERIVATION_V1_ID) return undefined;
      return {
        family: family as TestCommandClassification["family"],
        confidence,
        derivationVersion: DERIVATION_V1_ID
      };
    }
    const commandShape = payload?.commandShape;
    const outcomeAttribution = payload?.outcomeAttribution;
    if (
      payload?.derivationId !== DERIVATION_V2_ID ||
      (commandShape !== "direct" && commandShape !== "shell_wrapped" && commandShape !== "compound") ||
      (outcomeAttribution !== "source_exit" && outcomeAttribution !== "unavailable") ||
      (commandShape === "compound") !== (outcomeAttribution === "unavailable")
    ) return undefined;
    return {
      family: family as TestCommandClassification["family"],
      confidence,
      commandShape,
      outcomeAttribution,
      derivationVersion: DERIVATION_V2_ID
    };
  } catch {
    return undefined;
  }
}

function sameClassification(
  left: TestCommandClassificationV1 | TestCommandClassification,
  right: TestCommandClassificationV1 | TestCommandClassification
): boolean {
  return left.family === right.family &&
    left.confidence === right.confidence &&
    left.derivationVersion === right.derivationVersion &&
    (left.derivationVersion === DERIVATION_V1_ID || (
      right.derivationVersion === DERIVATION_V2_ID &&
      left.commandShape === right.commandShape &&
      left.outcomeAttribution === right.outcomeAttribution
    ));
}

function durableClassification(
  commandEvent: TraceEventV1 | undefined,
  resultEvent: TraceEventV1 | undefined,
  version: "1" | "2"
): TestCommandClassificationV1 | TestCommandClassification | undefined {
  const command = classificationFromDerivedEvent(commandEvent, version);
  const result = classificationFromDerivedEvent(resultEvent, version);
  if (command && result && !sameClassification(command, result)) return undefined;
  return command ?? result;
}

function hasExactFlatPayload(actualValue: unknown, expectedValue: unknown): boolean {
  try {
    const actual = asObject(actualValue);
    const expected = asObject(expectedValue);
    if (!actual || !expected) return false;
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) =>
        key === expectedKeys[index] && actual[key] === expected[key]
      );
  } catch {
    return false;
  }
}

function hasExpectedSemantics(
  event: TraceEventV1 | undefined,
  expected: TestDerivationDraft
): event is TraceEventV1 {
  return event !== undefined &&
    hasExactFlatPayload(event.source, expected.source) &&
    event.nativePayload === undefined &&
    event.status === expected.status &&
    event.derivation?.confidence === expected.derivation.confidence &&
    hasExactFlatPayload(event.normalizedPayload, expected.normalizedPayload);
}

function legacySourceOutcome(event: TraceEventV1): TestResultOutcome {
  const exitCode = numericExitCode(event);
  if (exitCode === 0) return "passed";
  if (exitCode !== null || event.status === "failed") return "failed";
  return "unknown";
}

function legacyResultStatus(outcome: TestResultOutcome): TraceEventV1["status"] {
  return outcome === "passed" ? "completed" : outcome === "failed" ? "failed" : "unknown";
}

function hasExpectedLegacySemantics(
  event: TraceEventV1 | undefined,
  source: TraceEventV1,
  sourceProvider: RunSummaryInput["run"]["provider"],
  kind: TestDerivedKind,
  classification: TestCommandClassificationV1
): event is TraceEventV1 {
  const outcome = legacySourceOutcome(source);
  const payload = kind === "test.command"
    ? {
        family: classification.family,
        confidence: classification.confidence,
        derivationId: DERIVATION_V1_ID
      }
    : {
        family: classification.family,
        confidence: classification.confidence,
        outcome,
        ...(numericExitCode(source) === null ? {} : { exitCode: numericExitCode(source)! }),
        derivationId: DERIVATION_V1_ID
      };
  const status = kind === "test.command" ? source.status : legacyResultStatus(outcome);
  return event !== undefined &&
    hasExactFlatPayload(event.source, { provider: sourceProvider }) &&
    event.nativePayload === undefined &&
    event.status === status &&
    event.derivation?.confidence === classification.confidence &&
    hasExactFlatPayload(event.normalizedPayload, payload);
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
  return legacySourceOutcome(event);
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
    derivationId: "test-command/1" | "test-command/2";
    testCommandDetail?: Readonly<{
      sourceEventId: string;
      commandShape: TestCommandClassification["commandShape"];
      outcomeAttribution: TestCommandClassification["outcomeAttribution"];
    }>;
  }> = [];
  let omittedTerminalCommands = 0;
  let unavailableTerminalCommands = 0;

  for (const source of sources) {
    const v1CommandCandidate = structurallyMatchingDerivedEvent(
      input.events,
      source,
      DERIVATION_V1_VERSION,
      "test.command"
    );
    const v1ResultCandidate = structurallyMatchingDerivedEvent(
      input.events,
      source,
      DERIVATION_V1_VERSION,
      "test.result"
    );
    const v2CommandCandidate = structurallyMatchingDerivedEvent(
      input.events,
      source,
      DERIVATION_V2_VERSION,
      "test.command"
    );
    const v2ResultCandidate = structurallyMatchingDerivedEvent(
      input.events,
      source,
      DERIVATION_V2_VERSION,
      "test.result"
    );
    const durableV1 = durableClassification(
      v1CommandCandidate,
      v1ResultCandidate,
      DERIVATION_V1_VERSION
    );
    const durableV2 = durableClassification(
      v2CommandCandidate,
      v2ResultCandidate,
      DERIVATION_V2_VERSION
    );
    let readTimeClassification: TestCommandClassification | null | undefined;

    if (input.run.capturePolicy === "standard") {
      try {
        const evidence = parseCommandEvidence(source, input.run.capturePolicy);
        if (evidence?.state === "omitted") {
          omittedTerminalCommands += 1;
          unavailableTerminalCommands += 1;
        } else if (evidence?.state === "available") {
          readTimeClassification = classifyTestCommand({
            command: evidence.redactedCommand,
            exitCode: numericExitCode(source),
            eventStatus: source.status
          });
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

    if (readTimeClassification === null) continue;
    const expectedClassification = durableV2 !== undefined
      ? (readTimeClassification ?? durableV2)
      : durableV1 ?? readTimeClassification;
    if (!expectedClassification) continue;

    const selectedV2 = expectedClassification.derivationVersion === DERIVATION_V2_ID;
    const expectedDrafts = selectedV2
      ? buildTestDerivationDrafts({
          runId: source.runId,
          sourceEventId: source.id,
          sourceProvider: input.run.provider,
          eventStatus: source.status,
          exitCode: numericExitCode(source),
          classification: expectedClassification
        })
      : undefined;
    const commandEvent = selectedV2
      ? (hasExpectedSemantics(v2CommandCandidate, expectedDrafts![0]) ? v2CommandCandidate : undefined)
      : (hasExpectedLegacySemantics(
          v1CommandCandidate,
          source,
          input.run.provider,
          "test.command",
          expectedClassification
        ) ? v1CommandCandidate : undefined);
    const resultEvent = selectedV2
      ? (hasExpectedSemantics(v2ResultCandidate, expectedDrafts![1]) ? v2ResultCandidate : undefined)
      : (hasExpectedLegacySemantics(
          v1ResultCandidate,
          source,
          input.run.provider,
          "test.result",
          expectedClassification
        ) ? v1ResultCandidate : undefined);
    if (
      readTimeClassification === undefined &&
      commandEvent === undefined &&
      resultEvent === undefined
    ) continue;

    const derivedIds = [commandEvent?.id, resultEvent?.id]
      .filter((id): id is string => id !== undefined);
    const outcome = durableOutcome(resultEvent) ??
      (expectedClassification.derivationVersion === DERIVATION_V2_ID &&
      expectedClassification.outcomeAttribution === "unavailable"
        ? "unknown"
        : input.run.capturePolicy === "standard" && readTimeClassification !== undefined
          ? sourceOutcome(source)
          : source.status === "failed" ? "failed" : "unknown");
    attempts.push({
      sourceId: source.id,
      outcome,
      derivedIds,
      missingExpected: 2 - derivedIds.length,
      derivationId: expectedClassification.derivationVersion,
      ...(expectedClassification.derivationVersion === DERIVATION_V2_ID ? {
        testCommandDetail: {
          sourceEventId: source.id,
          commandShape: expectedClassification.commandShape,
          outcomeAttribution: expectedClassification.outcomeAttribution
        }
      } : {})
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
  const testCommandDetails = attempts.flatMap(({ testCommandDetail }) =>
    testCommandDetail === undefined ? [] : [testCommandDetail]
  );
  const resultBase = {
    state: "detected" as const,
    availability: "available" as const,
    provenance: "derived" as const,
    supportingEventIds: [...terminalIds, ...derivedEventIds],
    supportingArtifactIds: [],
    omittedTerminalCommands,
    attempts: attemptSummary,
    sourceEventIds,
    derivedEventIds,
    durability: missingExpected === 0 ? "complete" as const : "incomplete" as const,
    missingExpected,
    coverage: unavailableTerminalCommands === 0 ? "complete" as const : "partial" as const
  };
  const result: LikelyTestsDetectedSummary = testCommandDetails.length > 0
    ? {
        ...resultBase,
        derivationId: DERIVATION_V2_ID,
        testCommandDetails
      }
    : {
        ...resultBase,
        derivationId: DERIVATION_V1_ID
      };
  return result;
}

export function summarizeRun(input: RunSummaryInput): RunSummary {
  const terminalCommands = input.events.filter(terminalCommand).sort(compareChronology);
  const failedTerminalCommands = terminalCommands.filter(({ status }) => status === "failed");
  const nativeFileChanges = input.events.filter(terminalFileChange).sort(compareChronology);
  const validatedUntracked = input.validatedUntrackedFileCount;
  const elapsedDuration = input.run.endedAt === null
    ? null
    : input.run.endedAt - input.run.startedAt;
  const elapsed = elapsedDuration === null || elapsedDuration < 0
    ? unavailableEvidence<number>()
    : availableEvidence(elapsedDuration, "recorder");

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
    observedTokenUsage: observedTokenUsage(input),
    likelyTests: likelyTests(input),
    assessment: assessment(input.currentAssessment),
    providerCapabilityLimitations: availableEvidence(
      capabilityLimitations(input.providerCapabilities),
      "provider"
    )
  };
}
