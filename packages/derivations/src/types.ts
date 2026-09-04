import type {
  AdapterCapabilities,
  CapturePolicy,
  EventStatus,
  NativeSourceV1,
  Provenance,
  TraceEventV1
} from "@agentlens/core";

export type CommandEvidence =
  | Readonly<{ state: "available"; redactedCommand: string }>
  | Readonly<{
      state: "omitted";
      reason: "metadata-only" | "strict" | "capture-bound";
    }>;

export interface ObservedCommand {
  readonly command: string;
  readonly exitCode: number | null;
  readonly eventStatus: EventStatus;
}

export interface TestCommandClassification {
  readonly family:
    | "pytest"
    | "jest"
    | "vitest"
    | "npm"
    | "pnpm"
    | "yarn"
    | "cargo"
    | "go"
    | "maven"
    | "gradle";
  readonly confidence: "high" | "medium";
  readonly derivationVersion: "test-command/1";
}

export type TestDerivedKind = "test.command" | "test.result";

export type TestResultOutcome = "passed" | "failed" | "unknown";

export interface DerivationIdentityInput {
  readonly runId: string;
  readonly sourceEventId: string;
  readonly name: "test-command";
  readonly version: "1";
  readonly derivedKind: TestDerivedKind;
}

export interface BuildTestDerivationDraftsInput {
  readonly runId: string;
  readonly sourceEventId: string;
  readonly sourceProvider: NativeSourceV1["provider"];
  readonly eventStatus: Extract<EventStatus, "completed" | "failed">;
  readonly exitCode: number | null;
  readonly classification: TestCommandClassification;
}

export interface TestDerivationMetadata {
  readonly name: "test-command";
  readonly version: "1";
  readonly sourceEventIds: readonly [string];
  readonly confidence: "high" | "medium";
  readonly identity: string;
}

interface TestDerivationDraftBase {
  readonly id: string;
  readonly runId: string;
  readonly status: EventStatus;
  readonly provenance: "derived";
  readonly source: Readonly<{ provider: NativeSourceV1["provider"] }>;
  readonly relationships: readonly [
    Readonly<{ type: "derived_from"; eventId: string }>
  ];
  readonly summary: string;
  readonly derivation: TestDerivationMetadata;
}

export interface TestCommandDerivationDraft extends TestDerivationDraftBase {
  readonly kind: "test.command";
  readonly normalizedPayload: Readonly<{
    family: TestCommandClassification["family"];
    confidence: TestCommandClassification["confidence"];
    derivationId: "test-command/1";
  }>;
}

export interface TestResultDerivationDraft extends TestDerivationDraftBase {
  readonly kind: "test.result";
  readonly normalizedPayload: Readonly<{
    family: TestCommandClassification["family"];
    confidence: TestCommandClassification["confidence"];
    outcome: TestResultOutcome;
    exitCode?: number;
    derivationId: "test-command/1";
  }>;
}

export type TestDerivationDraft =
  | TestCommandDerivationDraft
  | TestResultDerivationDraft;

export type SummaryAvailability = "available" | "unavailable";

export type SummaryProvenance = Provenance | "provider";

export interface SummaryEvidence<T> {
  readonly value: T | null;
  readonly availability: SummaryAvailability;
  readonly provenance: SummaryProvenance | null;
  readonly supportingEventIds: readonly string[];
  readonly supportingArtifactIds: readonly string[];
}

export type RunSummaryGitReference =
  | Readonly<{ state: "artifact"; artifactId: string }>
  | Readonly<{ state: "omitted"; reason: "metadata-only" | "strict" | "legacy-unspecified" }>
  | Readonly<{ state: "absent" }>;

export interface RunSummaryGitEvidenceInput {
  readonly trackedFinalDiff: RunSummaryGitReference;
  readonly untrackedMetadata: RunSummaryGitReference;
}

export interface ValidatedUntrackedFileCount {
  readonly count: number;
  readonly artifactId: string;
}

export type AssessmentVerdict =
  | "unreviewed"
  | "success"
  | "partial"
  | "failure";

export type TaskCompletion = "yes" | "no" | "uncertain";

export type AssessmentNoteProjection =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "artifact"; artifactId: string }>
  | Readonly<{ state: "omitted"; reason: "metadata-only" | "strict" }>;

export interface CurrentAssessmentProjection {
  readonly currentEventId: string;
  readonly verdict: AssessmentVerdict;
  readonly taskCompleted: TaskCompletion;
  readonly note: AssessmentNoteProjection;
  readonly reviewedAt: number;
  readonly updatedAt: number;
}

export interface RunSummaryRunInput {
  readonly id: string;
  readonly provider: NativeSourceV1["provider"];
  readonly capturePolicy: CapturePolicy;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export interface RunSummaryInput {
  readonly run: RunSummaryRunInput;
  readonly events: readonly TraceEventV1[];
  readonly gitEvidence: RunSummaryGitEvidenceInput | null;
  readonly validatedUntrackedFileCount: ValidatedUntrackedFileCount | null;
  readonly currentAssessment: CurrentAssessmentProjection | null;
  readonly providerCapabilities: AdapterCapabilities;
}

export interface ObservedTokenUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningOutputTokens: number | null;
  readonly cacheWriteInputTokens: number | null;
}

export type TokenUsageUnavailableReason =
  | "not_yet_available"
  | "capture_policy"
  | "redacted_by_policy"
  | "not_captured";

interface ObservedTokenUsageSummaryBase {
  readonly supportingEventIds: readonly string[];
  readonly supportingArtifactIds: readonly string[];
}

export interface AvailableObservedTokenUsageSummary extends ObservedTokenUsageSummaryBase {
  readonly state: "available";
  readonly value: ObservedTokenUsage;
  readonly availability: "available";
  readonly provenance: "observed";
}

export interface UnavailableObservedTokenUsageSummary extends ObservedTokenUsageSummaryBase {
  readonly state: "unavailable";
  readonly value: null;
  readonly availability: "unavailable";
  readonly provenance: null;
  readonly reason: TokenUsageUnavailableReason;
}

export type ObservedTokenUsageSummary =
  | AvailableObservedTokenUsageSummary
  | UnavailableObservedTokenUsageSummary;

export type ProviderCapabilityLimitation = Readonly<{
  capability:
    | "source_timestamps"
    | "file_reads"
    | "tool_output"
    | "tool_durations"
    | "token_usage"
    | "interruption_signal";
  availability: "partial" | "unavailable" | "recorder_only";
}>;

interface LikelyTestsSummaryBase {
  readonly state:
    | "none_detected"
    | "unavailable_due_to_capture_policy"
    | "detected";
  readonly availability: SummaryAvailability;
  readonly provenance: "derived" | null;
  readonly supportingEventIds: readonly string[];
  readonly supportingArtifactIds: readonly string[];
  readonly omittedTerminalCommands: number;
}

export interface NoLikelyTestsDetectedSummary extends LikelyTestsSummaryBase {
  readonly state: "none_detected";
  readonly availability: "available";
  readonly provenance: "derived";
}

export interface LikelyTestsUnavailableSummary extends LikelyTestsSummaryBase {
  readonly state: "unavailable_due_to_capture_policy";
  readonly availability: "unavailable";
  readonly provenance: null;
}

export interface LikelyTestAttempts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly latest: TestResultOutcome;
  readonly previousFailures: number;
}

export interface LikelyTestsDetectedSummary extends LikelyTestsSummaryBase {
  readonly state: "detected";
  readonly availability: "available";
  readonly provenance: "derived";
  readonly attempts: LikelyTestAttempts;
  readonly sourceEventIds: readonly string[];
  readonly derivedEventIds: readonly string[];
  readonly derivationId: "test-command/1";
  readonly durability: "complete" | "incomplete";
  readonly missingExpected: number;
  readonly coverage: "complete" | "partial";
}

export type LikelyTestsSummary =
  | NoLikelyTestsDetectedSummary
  | LikelyTestsUnavailableSummary
  | LikelyTestsDetectedSummary;

export interface HumanAssessmentSummary {
  readonly verdict: AssessmentVerdict;
  readonly taskCompleted: TaskCompletion;
  readonly note: AssessmentNoteProjection;
  readonly state: "projected" | "explicit";
  readonly availability: SummaryAvailability;
  readonly provenance: "human" | null;
  readonly currentEventId: string | null;
  readonly reviewedAt: number | null;
  readonly updatedAt: number | null;
  readonly supportingEventIds: readonly string[];
  readonly supportingArtifactIds: readonly string[];
}

export interface RunSummary {
  readonly terminalCommands: SummaryEvidence<number>;
  readonly failedTerminalCommands: SummaryEvidence<number>;
  readonly nativeFileChanges: SummaryEvidence<number>;
  readonly trackedFinalDiff: SummaryEvidence<"artifact" | "absent">;
  readonly untrackedFiles: SummaryEvidence<number>;
  readonly elapsedRecorderTimeMs: SummaryEvidence<number>;
  readonly observedTokenUsage: ObservedTokenUsageSummary;
  readonly likelyTests: LikelyTestsSummary;
  readonly assessment: HumanAssessmentSummary;
  readonly providerCapabilityLimitations: SummaryEvidence<readonly ProviderCapabilityLimitation[]>;
}
