import {
  currentAssessmentV1Schema,
  eventDetailV1Schema,
  eventStatusV1Schema,
  runListItemV1Schema,
  runSummaryV1Schema,
  runStatusV1Schema,
  trajectoryEventV1Schema,
  trajectoryPageV1Schema,
  type CurrentAssessmentV1,
  type EventDetailV1,
  type EventStatusV1,
  type EventStatusFieldV1,
  type PresentationClassV1,
  type ProviderIdV1,
  type ProviderFieldV1,
  type RunStatusV1,
  type RunStatusFieldV1,
  type RunListItemV1,
  type RunSummaryV1,
  type TrajectoryEventV1,
  type TrajectoryPageV1
} from "@agentlens/api-contract";
import type { TraceEventV1 } from "@agentlens/core";
import type {
  HumanAssessmentSummary,
  RunSummary,
  SummaryEvidence,
  SummaryProvenance
} from "@agentlens/derivations";
import type { CurrentAssessment, EventWindowRecord, RunListRecord } from "@agentlens/storage";

import type { CursorCodec } from "./cursors.js";
import type { SourceRefProjector } from "./sourceRefs.js";
import type { OwnershipDiagnosis } from "../ownership.js";

const SAFE_TOKEN_PATTERN = /^[a-z0-9._-]{1,64}$/;

export function sanitizeUnsupportedToken(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 64);
  return normalized.length > 0 && SAFE_TOKEN_PATTERN.test(normalized)
    ? normalized
    : "unsupported";
}

function assertNever(value: never): never {
  throw new Error(`Unhandled closed browser projection: ${String(value)}`);
}

function safeKind(kind: string): string {
  return SAFE_TOKEN_PATTERN.test(kind) ? kind : sanitizeUnsupportedToken(kind);
}

function safeSummary(summary: string): string {
  return summary.slice(0, 512);
}

function eventStatusField(status: string): EventStatusFieldV1 {
  const parsed = eventStatusV1Schema.safeParse(status);
  if (!parsed.success) {
    return { state: "unsupported", safeToken: sanitizeUnsupportedToken(status) };
  }
  const known = (value: EventStatusV1): EventStatusFieldV1 => {
    switch (value) {
      case "in_progress":
      case "completed":
      case "failed":
      case "declined":
      case "interrupted":
      case "unknown":
        return { state: "known", value };
      default:
        return assertNever(value);
    }
  };
  return known(parsed.data);
}

export function projectRunStatusFieldV1(status: string): RunStatusFieldV1 {
  const parsed = runStatusV1Schema.safeParse(status);
  if (!parsed.success) {
    return { state: "unsupported", safeToken: sanitizeUnsupportedToken(status) };
  }
  const known = (value: RunStatusV1): RunStatusFieldV1 => {
    switch (value) {
      case "starting":
      case "running":
      case "completed":
      case "failed":
      case "interrupted":
      case "recorder_error":
        return { state: "known", value };
      default:
        return assertNever(value);
    }
  };
  return known(parsed.data);
}

export function projectProviderFieldV1(provider: string): ProviderFieldV1 {
  if (provider === "codex-exec" || provider === "claude-code") {
    const known = (value: ProviderIdV1): ProviderFieldV1 => {
      switch (value) {
        case "codex-exec":
        case "claude-code":
          return { state: "known", value };
        default:
          return assertNever(value);
      }
    };
    return known(provider);
  }
  return { state: "unsupported", safeToken: sanitizeUnsupportedToken(provider) };
}

export function presentationClassForEvent(kind: string): PresentationClassV1 {
  if (kind === "recorder.recovery") return "recorder_recovery";
  if (kind === "command" || kind.startsWith("command.")) return "command";
  if (kind === "file.change" || kind.startsWith("file_change.")) return "file_change";
  if (kind === "tool" || kind.startsWith("tool.")) return "tool";
  if (kind === "plan.updated" || kind.startsWith("plan.")) return "plan";
  if (kind.startsWith("message.")) return "message";
  if (kind.startsWith("reasoning.")) return "reasoning";
  if (kind.startsWith("git.")) return "git";
  if (kind.startsWith("recorder.")) return "recorder";
  if (kind.startsWith("test.")) return "test";
  if (kind.startsWith("assessment.")) return "assessment";
  if (kind === "error" || kind.startsWith("error.")) return "error";
  if (kind.startsWith("thread.") || kind.startsWith("turn.") || kind === "run.reconciled") {
    return "lifecycle";
  }
  return "unknown";
}

function payloadRecord(event: TraceEventV1): Record<string, unknown> | null {
  const payload = event.normalizedPayload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

function contentAvailability(event: TraceEventV1) {
  return event.normalizedPayload === undefined
    ? { state: "unavailable", reason: "not_captured" } as const
    : { state: "available" } as const;
}

function nativePayloadAvailability(event: TraceEventV1) {
  const native = event.nativePayload;
  if (native === undefined) return { state: "unavailable", reason: "not_captured" } as const;
  switch (native.storage) {
    case "inline":
    case "artifact":
      return { state: "available", storage: native.storage } as const;
    case "omitted":
      return {
        state: "unavailable",
        reason: native.reason === "metadata-only" || native.reason === "strict"
          ? "capture_policy"
          : "artifact_omitted"
      } as const;
    default:
      return assertNever(native);
  }
}

function derivation(event: TraceEventV1) {
  const source = event.derivation;
  if (!source) return null;
  return {
    name: safeKind(source.name),
    version: safeKind(source.version),
    sourceEventIds: [...source.sourceEventIds],
    ...(source.confidence === undefined ? {} : { confidence: source.confidence }),
    ...(source.identity === undefined ? {} : { identity: source.identity })
  };
}

function relationships(event: TraceEventV1) {
  return event.relationships.map(({ type, eventId }) => ({ type, eventId }));
}

export function projectTrajectoryEventV1(
  event: TraceEventV1,
  sourceRefs: SourceRefProjector
): TrajectoryEventV1 {
  const presentationClass = presentationClassForEvent(event.kind);
  return trajectoryEventV1Schema.parse({
    schemaVersion: 1,
    eventId: event.id,
    runId: event.runId,
    sequence: event.sequence,
    receivedAt: event.receivedAt,
    sourceOccurredAt: event.sourceOccurredAt === undefined
      ? { state: "unavailable", reason: "not_captured" }
      : { state: "available", value: event.sourceOccurredAt },
    kind: safeKind(event.kind),
    status: eventStatusField(event.status),
    provenance: event.provenance,
    presentationClass,
    safeSummary: safeSummary(event.summary),
    source: sourceRefs.project(event.source),
    relationships: relationships(event),
    derivation: derivation(event),
    nativePayload: nativePayloadAvailability(event),
    lifecycleGroupKey: presentationClass === "lifecycle"
      ? sourceRefs.lifecycleGroup(event.source)
      : null,
    detail: presentationClass === "unknown"
      ? { state: "unavailable", reason: "unsupported_kind" }
      : { state: "available" }
  });
}

function detailBase(event: TraceEventV1) {
  return {
    schemaVersion: 1 as const,
    eventId: event.id,
    runId: event.runId,
    sequence: event.sequence,
    kind: safeKind(event.kind),
    status: eventStatusField(event.status),
    provenance: event.provenance,
    relationships: relationships(event)
  };
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonnegativeCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function testResult(event: TraceEventV1): "passed" | "failed" | "unknown" {
  const outcome = payloadRecord(event)?.outcome;
  if (outcome === "passed" || outcome === "failed" || outcome === "unknown") return outcome;
  if (event.status === "completed") return "passed";
  if (event.status === "failed") return "failed";
  return "unknown";
}

function assessmentNote(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { state: "absent" } as const;
  }
  const state = (value as Record<string, unknown>).state;
  if (state === "artifact") return { state: "available" } as const;
  if (state === "omitted") return { state: "unavailable", reason: "capture_policy" } as const;
  return { state: "absent" } as const;
}

export function projectEventDetailV1(event: TraceEventV1): EventDetailV1 {
  const base = detailBase(event);
  const payload = payloadRecord(event);
  const content = contentAvailability(event);
  const presentationClass = presentationClassForEvent(event.kind);
  let candidate: unknown;
  switch (presentationClass) {
    case "lifecycle":
      candidate = { ...base, presentationClass, phase: safeKind(event.kind), content };
      break;
    case "message": {
      const role = event.kind === "message.agent" ? "agent" :
        event.kind === "message.user" ? "user" :
          event.kind === "message.system" ? "system" : "unknown";
      candidate = { ...base, presentationClass, role, content };
      break;
    }
    case "reasoning":
      candidate = { ...base, presentationClass, content };
      break;
    case "command":
      candidate = {
        ...base,
        presentationClass,
        lifecycle: eventStatusV1Schema.safeParse(event.status).success ? event.status : "unknown",
        exitCode: integer(payload?.exitCode),
        output: payload && Object.prototype.hasOwnProperty.call(payload, "aggregatedOutput")
          ? { state: "available" }
          : { state: "unavailable", reason: "not_captured" },
        content
      };
      break;
    case "file_change":
      candidate = {
        ...base,
        presentationClass,
        changeCount: nonnegativeCount(payload?.changes),
        content
      };
      break;
    case "tool":
      candidate = {
        ...base,
        presentationClass,
        toolName: safeKind(event.source.itemType ?? "tool"),
        toolStatus: eventStatusField(event.status),
        content
      };
      break;
    case "plan": {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      let completed = 0;
      let inProgress = 0;
      let failed = 0;
      for (const item of items) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
        const status = (item as Record<string, unknown>).status;
        if (status === "completed") completed += 1;
        else if (status === "in_progress") inProgress += 1;
        else if (status === "failed") failed += 1;
      }
      candidate = {
        ...base,
        presentationClass,
        steps: { total: items.length, completed, inProgress, failed },
        content
      };
      break;
    }
    case "git":
      candidate = { ...base, presentationClass, evidence: content, content };
      break;
    case "recorder":
      candidate = {
        ...base,
        presentationClass,
        diagnosticClass: safeKind(event.kind.slice("recorder.".length) || "recorder"),
        content
      };
      break;
    case "recorder_recovery":
      candidate = {
        ...base,
        presentationClass,
        recoveryClass: "interrupted_open_event",
        recoveredEventIds: event.relationships
          .filter(({ type }) => type === "recovers")
          .map(({ eventId }) => eventId),
        content
      };
      break;
    case "test": {
      const projectedDerivation = derivation(event);
      if (projectedDerivation === null) {
        candidate = {
          ...base,
          presentationClass: "unknown",
          content: { state: "unavailable", reason: "unsupported_kind" }
        };
      } else {
        candidate = {
          ...base,
          presentationClass,
          derivation: projectedDerivation,
          result: testResult(event),
          content
        };
      }
      break;
    }
    case "assessment": {
      const verdict = payload?.verdict;
      const taskCompleted = payload?.taskCompleted;
      candidate = {
        ...base,
        presentationClass,
        revision: event.id,
        verdict: verdict === "success" || verdict === "partial" || verdict === "failure"
          ? verdict
          : "unreviewed",
        taskCompleted: taskCompleted === "yes" || taskCompleted === "no"
          ? taskCompleted
          : "uncertain",
        note: assessmentNote(payload?.note),
        content
      };
      break;
    }
    case "error":
      candidate = { ...base, presentationClass, errorClass: "provider_error", content };
      break;
    case "unknown":
      candidate = {
        ...base,
        presentationClass,
        content: { state: "unavailable", reason: "unsupported_kind" }
      };
      break;
    default:
      return assertNever(presentationClass);
  }
  return eventDetailV1Schema.parse(candidate);
}

function noteAvailability(note: CurrentAssessment["note"]) {
  switch (note.state) {
    case "absent":
      return { state: "absent" } as const;
    case "artifact":
      return { state: "available" } as const;
    case "omitted":
      return { state: "unavailable", reason: "capture_policy" } as const;
    default:
      return assertNever(note);
  }
}

export function projectCurrentAssessmentV1(assessment: CurrentAssessment): CurrentAssessmentV1 {
  if (assessment.state === "projected") {
    return currentAssessmentV1Schema.parse({
      schemaVersion: 1,
      state: "projected",
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "absent" },
      provenance: null,
      currentEventId: null,
      reviewedAt: null,
      updatedAt: null
    });
  }
  return currentAssessmentV1Schema.parse({
    schemaVersion: 1,
    state: "explicit",
    verdict: assessment.verdict,
    taskCompleted: assessment.taskCompleted,
    note: noteAvailability(assessment.note),
    provenance: "human",
    currentEventId: assessment.currentEventId,
    reviewedAt: assessment.reviewedAt,
    updatedAt: assessment.updatedAt
  });
}

function summaryOrigin(provenance: SummaryProvenance, provider: string) {
  return provenance === "provider"
    ? { type: "provider_capability", provider: projectProviderFieldV1(provider) } as const
    : { type: "event", provenance } as const;
}

function projectSummaryEvidence<T, U>(
  evidence: SummaryEvidence<T>,
  provider: string,
  projectValue: (value: T) => U,
  unavailableReason: "provider_capability" | "capture_policy" | "not_captured"
) {
  if (evidence.availability === "available" && evidence.value !== null && evidence.provenance !== null) {
    return {
      state: "available" as const,
      value: projectValue(evidence.value),
      origin: summaryOrigin(evidence.provenance, provider),
      supportingEventIds: [...evidence.supportingEventIds],
      supportingArtifactIds: [...evidence.supportingArtifactIds]
    };
  }
  return {
    state: "unavailable" as const,
    reason: unavailableReason,
    origin: null,
    supportingEventIds: [...evidence.supportingEventIds],
    supportingArtifactIds: [...evidence.supportingArtifactIds]
  };
}

function projectSummaryAssessment(assessment: HumanAssessmentSummary) {
  if (assessment.state === "projected") {
    return {
      schemaVersion: 1,
      state: "projected",
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "absent" },
      provenance: null,
      currentEventId: null,
      reviewedAt: null,
      updatedAt: null
    } as const;
  }
  const note = assessment.note.state === "artifact"
    ? { state: "available" } as const
    : assessment.note.state === "omitted"
      ? { state: "unavailable", reason: "capture_policy" } as const
      : { state: "absent" } as const;
  return {
    schemaVersion: 1,
    state: "explicit",
    verdict: assessment.verdict,
    taskCompleted: assessment.taskCompleted,
    note,
    provenance: "human",
    currentEventId: assessment.currentEventId,
    reviewedAt: assessment.reviewedAt,
    updatedAt: assessment.updatedAt
  } as const;
}

function projectLikelyTests(summary: RunSummary["likelyTests"]) {
  const base = {
    availability: summary.availability,
    provenance: summary.provenance,
    supportingEventIds: [...summary.supportingEventIds],
    supportingArtifactIds: [...summary.supportingArtifactIds],
    omittedTerminalCommands: summary.omittedTerminalCommands
  };
  switch (summary.state) {
    case "none_detected":
      return { ...base, state: "none_detected" } as const;
    case "unavailable_due_to_capture_policy":
      return { ...base, state: "unavailable_due_to_capture_policy" } as const;
    case "detected":
      return {
        ...base,
        state: "detected",
        attempts: {
          total: summary.attempts.total,
          passed: summary.attempts.passed,
          failed: summary.attempts.failed,
          unknown: summary.attempts.unknown,
          latest: summary.attempts.latest,
          previousFailures: summary.attempts.previousFailures
        },
        sourceEventIds: [...summary.sourceEventIds],
        derivedEventIds: [...summary.derivedEventIds],
        derivationId: summary.derivationId,
        durability: summary.durability,
        missingExpected: summary.missingExpected,
        coverage: summary.coverage
      } as const;
    default:
      return assertNever(summary);
  }
}

export function projectRunSummaryV1(summary: RunSummary, provider: string): RunSummaryV1 {
  return runSummaryV1Schema.parse({
    terminalCommands: projectSummaryEvidence(summary.terminalCommands, provider, (value) => value, "capture_policy"),
    failedTerminalCommands: projectSummaryEvidence(summary.failedTerminalCommands, provider, (value) => value, "capture_policy"),
    nativeFileChanges: projectSummaryEvidence(summary.nativeFileChanges, provider, (value) => value, "provider_capability"),
    trackedFinalDiff: projectSummaryEvidence(summary.trackedFinalDiff, provider, (value) => value, "not_captured"),
    untrackedFiles: projectSummaryEvidence(summary.untrackedFiles, provider, (value) => value, "not_captured"),
    elapsedRecorderTimeMs: projectSummaryEvidence(summary.elapsedRecorderTimeMs, provider, (value) => value, "not_captured"),
    observedTokenUsage: projectSummaryEvidence(summary.observedTokenUsage, provider, (value) => ({
      inputTokens: value.inputTokens,
      cachedInputTokens: value.cachedInputTokens,
      outputTokens: value.outputTokens,
      reasoningOutputTokens: value.reasoningOutputTokens,
      cacheWriteInputTokens: value.cacheWriteInputTokens
    }), "provider_capability"),
    likelyTests: projectLikelyTests(summary.likelyTests),
    assessment: projectSummaryAssessment(summary.assessment),
    providerCapabilityLimitations: projectSummaryEvidence(
      summary.providerCapabilityLimitations,
      provider,
      (value) => value.map((limitation) => ({
        capability: limitation.capability,
        availability: limitation.availability
      })),
      "provider_capability"
    )
  });
}

function runWarningCodes(run: RunListRecord, ownership: OwnershipDiagnosis): string[] {
  const warnings: string[] = [];
  if (run.headChanged === true) warnings.push("git_head_changed");
  if (run.branchChanged === true) warnings.push("git_branch_changed");
  switch (ownership.diagnosis) {
    case "likely_stale":
      warnings.push("recorder_likely_stale");
      break;
    case "orphan_child_active":
      warnings.push("orphan_child_active");
      break;
    case "identity_ambiguous":
      warnings.push("recorder_identity_ambiguous");
      break;
    case "unknown":
      warnings.push("recorder_identity_unknown");
      break;
    case "unavailable":
    case "active":
    case "released":
      break;
    default:
      assertNever(ownership.diagnosis);
  }
  return warnings;
}

export function projectRunListItemV1(input: {
  readonly run: RunListRecord;
  readonly summary: RunSummary;
  readonly ownership: OwnershipDiagnosis;
}): RunListItemV1 {
  const { run, summary, ownership } = input;
  return runListItemV1Schema.parse({
    schemaVersion: 1,
    runId: run.id,
    status: projectRunStatusFieldV1(run.status),
    provider: projectProviderFieldV1(run.provider),
    label: run.label === undefined ? null : run.label.slice(0, 256),
    capturePolicy: run.capturePolicy,
    repository: {
      fingerprint: run.repositoryFingerprint,
      display: run.repositoryDisplay.slice(0, 256)
    },
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    ownership: {
      storedCondition: ownership.storedCondition,
      diagnosis: ownership.diagnosis
    },
    finalGitEvidence: run.headChanged === null || run.branchChanged === null
      ? {
          state: "unavailable",
          reason: run.status === "starting" || run.status === "running"
            ? "not_yet_available"
            : "not_captured"
        }
      : {
          state: "available",
          headChanged: run.headChanged,
          branchChanged: run.branchChanged
        },
    summary: projectRunSummaryV1(summary, run.provider),
    warningCodes: runWarningCodes(run, ownership),
    contradictionCodes: run.contradictionCodes.map(sanitizeUnsupportedToken)
  });
}

export function projectTrajectoryPageV1(
  window: EventWindowRecord,
  context: {
    readonly runId: string;
    readonly mode: "head" | "tail" | "after" | "around" | "cursor";
    readonly sourceRefs: SourceRefProjector;
    readonly cursors: CursorCodec;
  }
): TrajectoryPageV1 {
  const items = window.events.map((event) => projectTrajectoryEventV1(event, context.sourceRefs));
  const snapshot = window.latestCommittedSequence;
  if (items.length === 0) {
    const earlierCursor = window.hasEarlier && snapshot !== null
      ? context.cursors.encodeEvent({
          runId: context.runId,
          direction: "earlier",
          boundarySequence: snapshot,
          latestCommittedSequence: snapshot
        })
      : null;
    return trajectoryPageV1Schema.parse({
      schemaVersion: 1,
      runId: context.runId,
      mode: context.mode,
      items,
      window: {
        state: "empty",
        latestCommittedSequence: snapshot,
        hasEarlier: window.hasEarlier,
        hasLater: false,
        earlierCursor,
        laterCursor: null
      }
    });
  }
  if (snapshot === null) throw new Error("A nonempty event window requires a committed snapshot.");
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) throw new Error("A nonempty event window requires bounds.");
  return trajectoryPageV1Schema.parse({
    schemaVersion: 1,
    runId: context.runId,
    mode: context.mode,
    items,
    window: {
      state: "nonempty",
      minSequence: first.sequence,
      maxSequence: last.sequence,
      latestCommittedSequence: snapshot,
      hasEarlier: window.hasEarlier,
      hasLater: window.hasLater,
      earlierCursor: window.hasEarlier
        ? context.cursors.encodeEvent({
            runId: context.runId,
            direction: "earlier",
            boundarySequence: first.sequence,
            latestCommittedSequence: snapshot
          })
        : null,
      laterCursor: window.hasLater
        ? context.cursors.encodeEvent({
            runId: context.runId,
            direction: "later",
            boundarySequence: last.sequence,
            latestCommittedSequence: snapshot
          })
        : null
    }
  });
}
