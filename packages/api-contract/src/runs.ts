import { z } from "zod";

import {
  browserAddressableEventIdV1Schema,
  currentAssessmentV1Schema
} from "./assessment.js";
import {
  evidenceValueV1Schema,
  providerFieldV1Schema,
  runStatusFieldV1Schema
} from "./evidence.js";
import { ecmaScriptTimestampV1Schema } from "./time.js";

const boundedId = z.string().min(1).max(256);
const nonnegativeInteger = z.number().int().nonnegative();

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function isBrowserAddressableRunId(value: string): boolean {
  try {
    return UTF8_DECODER.decode(UTF8_ENCODER.encode(value)) === value &&
      !/\p{Cc}/u.test(value) &&
      value !== "." &&
      value !== "..";
  } catch {
    return false;
  }
}

export const browserAddressableRunIdV1Schema = z.string()
  .min(1)
  .max(256)
  .refine(
    isBrowserAddressableRunId,
    "Run ID must be canonical UTF-8 without Unicode controls or URL dot segments."
  );

export const observedTokenUsageV1Schema = z.object({
  inputTokens: nonnegativeInteger.nullable(),
  cachedInputTokens: nonnegativeInteger.nullable(),
  outputTokens: nonnegativeInteger.nullable(),
  reasoningOutputTokens: nonnegativeInteger.nullable(),
  cacheWriteInputTokens: nonnegativeInteger.nullable()
}).strict();

export const providerCapabilityLimitationV1Schema = z.object({
  capability: z.enum([
    "source_timestamps",
    "file_reads",
    "tool_output",
    "tool_durations",
    "interruption_signal"
  ]),
  availability: z.enum(["partial", "unavailable", "recorder_only"])
}).strict();

const evidenceIds = {
  supportingEventIds: z.array(browserAddressableEventIdV1Schema).max(1_000),
  supportingArtifactIds: z.array(boundedId).max(1_000)
};

export const likelyTestsV1Schema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("none_detected"),
    availability: z.literal("available"),
    provenance: z.literal("derived"),
    ...evidenceIds,
    omittedTerminalCommands: nonnegativeInteger
  }).strict(),
  z.object({
    state: z.literal("unavailable_due_to_capture_policy"),
    availability: z.literal("unavailable"),
    provenance: z.null(),
    ...evidenceIds,
    omittedTerminalCommands: nonnegativeInteger
  }).strict(),
  z.object({
    state: z.literal("detected"),
    availability: z.literal("available"),
    provenance: z.literal("derived"),
    ...evidenceIds,
    omittedTerminalCommands: nonnegativeInteger,
    attempts: z.object({
      total: nonnegativeInteger,
      passed: nonnegativeInteger,
      failed: nonnegativeInteger,
      unknown: nonnegativeInteger,
      latest: z.enum(["passed", "failed", "unknown"]),
      previousFailures: nonnegativeInteger
    }).strict(),
    sourceEventIds: z.array(browserAddressableEventIdV1Schema).max(1_000),
    derivedEventIds: z.array(browserAddressableEventIdV1Schema).max(1_000),
    derivationId: z.literal("test-command/1"),
    durability: z.enum(["complete", "incomplete"]),
    missingExpected: nonnegativeInteger,
    coverage: z.enum(["complete", "partial"])
  }).strict()
]);

export const runSummaryV1Schema = z.object({
  terminalCommands: evidenceValueV1Schema(nonnegativeInteger),
  failedTerminalCommands: evidenceValueV1Schema(nonnegativeInteger),
  nativeFileChanges: evidenceValueV1Schema(nonnegativeInteger),
  trackedFinalDiff: evidenceValueV1Schema(z.enum(["artifact", "absent"])),
  untrackedFiles: evidenceValueV1Schema(nonnegativeInteger),
  elapsedRecorderTimeMs: evidenceValueV1Schema(nonnegativeInteger),
  observedTokenUsage: evidenceValueV1Schema(observedTokenUsageV1Schema),
  likelyTests: likelyTestsV1Schema,
  assessment: currentAssessmentV1Schema,
  providerCapabilityLimitations: evidenceValueV1Schema(
    z.array(providerCapabilityLimitationV1Schema).max(100)
  )
}).strict();

export const ownershipDiagnosisV1Schema = z.object({
  storedCondition: z.enum([
    "active",
    "orphan_child_active",
    "identity_ambiguous",
    "reconciling",
    "released"
  ]).nullable(),
  diagnosis: z.enum([
    "unavailable",
    "active",
    "likely_stale",
    "unknown",
    "released",
    "orphan_child_active",
    "identity_ambiguous"
  ])
}).strict();

export const finalGitEvidenceV1Schema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    headChanged: z.boolean(),
    branchChanged: z.boolean()
  }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum(["not_yet_available", "not_captured"])
  }).strict()
]);

const runFields = {
  schemaVersion: z.literal(1),
  runId: browserAddressableRunIdV1Schema,
  status: runStatusFieldV1Schema,
  provider: providerFieldV1Schema,
  label: z.string().min(1).max(256).nullable(),
  capturePolicy: z.enum(["standard", "metadata-only", "strict"]),
  repository: z.object({
    fingerprint: z.string().min(1).max(256),
    display: z.string().min(1).max(256)
  }).strict(),
  startedAt: ecmaScriptTimestampV1Schema,
  endedAt: ecmaScriptTimestampV1Schema.nullable(),
  ownership: ownershipDiagnosisV1Schema,
  finalGitEvidence: finalGitEvidenceV1Schema,
  summary: runSummaryV1Schema
};

export const runListItemV1Schema = z.object({
  ...runFields,
  warningCodes: z.array(z.string().regex(/^[a-z0-9._-]{1,64}$/)).max(100),
  contradictionCodes: z.array(z.string().regex(/^[a-z0-9._-]{1,64}$/)).max(100)
}).strict();

export const runPageV1Schema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(runListItemV1Schema).max(100),
  nextCursor: z.string().min(1).max(4_096).nullable()
}).strict();

export const eventAnchorV1Schema = z.object({
  eventId: browserAddressableEventIdV1Schema,
  sequence: nonnegativeInteger
}).strict();

const gitBranchV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("attached"), value: z.string().min(1).max(256) }).strict(),
  z.object({ state: z.literal("detached") }).strict()
]);

export const runGitStateV1Schema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    initialHead: z.string().min(1).max(128),
    finalHead: z.string().min(1).max(128),
    initialBranch: gitBranchV1Schema,
    finalBranch: gitBranchV1Schema
  }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum(["not_yet_available", "not_captured"])
  }).strict()
]);

export const runDetailV1Schema = z.object({
  ...runFields,
  gitState: runGitStateV1Schema,
  eventCount: nonnegativeInteger,
  anchors: z.object({
    firstFailure: eventAnchorV1Schema.nullable(),
    recorderRecovery: eventAnchorV1Schema.nullable(),
    latestLikelyTest: eventAnchorV1Schema.nullable(),
    finalGitEvidence: eventAnchorV1Schema.nullable(),
    latestEvent: eventAnchorV1Schema.nullable()
  }).strict(),
  warningCodes: z.array(z.string().regex(/^[a-z0-9._-]{1,64}$/)).max(100),
  contradictionCodes: z.array(z.string().regex(/^[a-z0-9._-]{1,64}$/)).max(100)
}).strict();

export type ObservedTokenUsageV1 = z.infer<typeof observedTokenUsageV1Schema>;
export type ProviderCapabilityLimitationV1 = z.infer<typeof providerCapabilityLimitationV1Schema>;
export type LikelyTestsV1 = z.infer<typeof likelyTestsV1Schema>;
export type RunSummaryV1 = z.infer<typeof runSummaryV1Schema>;
export type OwnershipDiagnosisV1 = z.infer<typeof ownershipDiagnosisV1Schema>;
export type FinalGitEvidenceV1 = z.infer<typeof finalGitEvidenceV1Schema>;
export type RunListItemV1 = z.infer<typeof runListItemV1Schema>;
export type RunPageV1 = z.infer<typeof runPageV1Schema>;
export type EventAnchorV1 = z.infer<typeof eventAnchorV1Schema>;
export type RunGitStateV1 = z.infer<typeof runGitStateV1Schema>;
export type RunDetailV1 = z.infer<typeof runDetailV1Schema>;
