import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  traceEventV1Schema,
  type CapturePolicy,
  type CompletedArtifact,
  type EventStatus,
  type NativeSourceV1,
  type RedactionAudit,
  type RunStatus,
  type TraceEventV1
} from "@agentlens/core";
import type Database from "better-sqlite3";
import type { AgentLensDatabase } from "./database.js";
import { connectionFor } from "./databaseInternal.js";

type ProviderTerminalKind = "completed" | "failed";
export type EvidenceOmissionReason = "metadata-only" | "strict";
type StoredEvidenceOmissionReason = EvidenceOmissionReason | "legacy-unspecified";

export type RequiredGitEvidenceRef =
  | Readonly<{ state: "artifact"; artifactId: string }>
  | Readonly<{ state: "omitted"; reason: EvidenceOmissionReason }>;

export type OptionalGitEvidenceRef =
  | RequiredGitEvidenceRef
  | Readonly<{ state: "absent" }>;

export type StoredRequiredGitEvidenceRef =
  | Readonly<{ state: "artifact"; artifactId: string }>
  | Readonly<{ state: "omitted"; reason: StoredEvidenceOmissionReason }>;

export type StoredOptionalGitEvidenceRef =
  | StoredRequiredGitEvidenceRef
  | Readonly<{ state: "absent" }>;

export interface CreateRunInput {
  id: string;
  schemaVersion: number;
  provider: NativeSourceV1["provider"];
  integrationVersion: string;
  agentVersion: string;
  capturePolicy: CapturePolicy;
  capturePolicyVersion: string;
  redactionVersion: string;
  label?: string;
  promptSource?: string;
  repositoryFingerprint: string;
  repositoryDisplay: string;
  startedAt: number;
}

export type RecorderOwnershipCondition =
  | "active"
  | "orphan_child_active"
  | "identity_ambiguous"
  | "reconciling"
  | "released";

export interface CreateRecorderOwnershipInput {
  recorderInstanceId: string;
  recorderPid: number;
  recorderStartToken: string;
  heartbeatAt: number;
}

export interface RecorderOwnership extends CreateRecorderOwnershipInput {
  runId: string;
  childPid: number | null;
  childStartToken: string | null;
  childProcessGroupId: number | null;
  condition: RecorderOwnershipCondition;
  ownershipLostEventId: string | null;
  updatedAt: number;
}

export interface MarkRunningInput {
  recorderInstanceId: string;
  childPid: number;
  childStartToken: string | null;
  childProcessGroupId: number | null;
  updatedAt: number;
}

export interface ProcessFactInput {
  eventId: string;
}

export interface ReconciliationInput {
  eventId: string;
  receivedAt: string;
  endedAt: number;
  providerTerminalEventId?: string;
  recorderFailureEventId?: string;
  recorderCrashEventId?: string;
  interruptionEventId?: string;
}

export interface OwnershipLossInput {
  expectedRecorderInstanceId: string;
  eventId: string;
  receivedAt: string;
}

export type OwnershipLossResult =
  | { readonly kind: "recorded"; readonly event: TraceEventV1 }
  | { readonly kind: "already_lost"; readonly event: TraceEventV1 }
  | { readonly kind: "already_terminal" }
  | { readonly kind: "ownership_changed" };

export interface RecoveryContext {
  receivedAt: string;
  eventIdFor(event: TraceEventV1): string;
}

export interface GitEvidenceInput {
  initialHead: string;
  finalHead: string;
  initialBranch: string | null;
  finalBranch: string | null;
  initialStatus: RequiredGitEvidenceRef;
  finalStatus: RequiredGitEvidenceRef;
  trackedFinalDiff: OptionalGitEvidenceRef;
  diffCheck: RequiredGitEvidenceRef;
  diffCheckPassed: boolean;
  untrackedMetadata: OptionalGitEvidenceRef;
  headChanged: boolean;
  branchChanged: boolean;
  capturedAt: number;
}

export interface RunRecord extends CreateRunInput {
  status: RunStatus;
  endedAt: number | null;
  childPid: number | null;
  exitCode: number | null;
  terminatingSignal: string | null;
  providerTerminalKind: ProviderTerminalKind | null;
  terminalReason: string | null;
  contradictionCodes: string[];
}

export interface RunListRecord extends RunRecord {
  headChanged: boolean | null;
  branchChanged: boolean | null;
  ownershipCondition: RecorderOwnershipCondition | null;
}

export interface StoredArtifact extends CompletedArtifact {
  createdAt: number;
}

export interface StoredRedactionAudit extends RedactionAudit {
  eventId: string | null;
  artifactId: string | null;
}

export interface StoredGitEvidence {
  runId: string;
  initialHead: string;
  finalHead: string;
  initialBranch: string | null;
  finalBranch: string | null;
  initialStatus: StoredRequiredGitEvidenceRef;
  finalStatus: StoredRequiredGitEvidenceRef;
  trackedFinalDiff: StoredOptionalGitEvidenceRef;
  diffCheck: StoredRequiredGitEvidenceRef;
  diffCheckPassed: boolean;
  untrackedMetadata: StoredOptionalGitEvidenceRef;
  headChanged: boolean;
  branchChanged: boolean;
  capturedAt: number;
}

export interface RunRepositoryOptions {
  artifactRoot: string;
}

export interface AppendDerivedEventInput {
  readonly identity: string;
  readonly sourceEventId: string;
  readonly eventId: string;
  readonly receivedAt: string;
  readonly kind: "test.command" | "test.result";
  readonly status: EventStatus;
  readonly sourceProvider: NativeSourceV1["provider"];
  readonly summary: string;
  readonly normalizedPayload: unknown;
  readonly derivation: {
    readonly name: "test-command";
    readonly version: "1";
    readonly identity: string;
    readonly confidence: "high" | "medium";
  };
}

export interface StorageSchemaCapabilities {
  readonly derivationIdentities: boolean;
  readonly currentAssessments: boolean;
  readonly eventArtifactBindings: boolean;
}

export type AssessmentVerdict =
  | "unreviewed"
  | "success"
  | "partial"
  | "failure";

export type TaskCompletion = "yes" | "no" | "uncertain";

export type AssessmentNoteRef =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "artifact"; artifact: CompletedArtifact }>
  | Readonly<{ state: "omitted"; reason: EvidenceOmissionReason }>;

export type AssessmentNoteProjection =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "artifact"; artifactId: string }>
  | Readonly<{ state: "omitted"; reason: EvidenceOmissionReason }>;

export interface UpdateAssessmentInput {
  readonly runId: string;
  readonly eventId: string;
  readonly receivedAt: string;
  readonly verdict: AssessmentVerdict;
  readonly taskCompleted?: TaskCompletion;
  readonly note?: AssessmentNoteRef;
}

export interface ProjectedCurrentAssessment {
  readonly runId: string;
  readonly verdict: "unreviewed";
  readonly taskCompleted: "uncertain";
  readonly note: Readonly<{ state: "absent" }>;
  readonly state: "projected";
  readonly provenance: null;
  readonly currentEventId: null;
  readonly reviewedAt: null;
  readonly updatedAt: null;
}

export interface ExplicitCurrentAssessment {
  readonly runId: string;
  readonly verdict: AssessmentVerdict;
  readonly taskCompleted: TaskCompletion;
  readonly note: AssessmentNoteProjection;
  readonly state: "explicit";
  readonly provenance: "human";
  readonly currentEventId: string;
  readonly reviewedAt: number;
  readonly updatedAt: number;
}

export type CurrentAssessment =
  | ProjectedCurrentAssessment
  | ExplicitCurrentAssessment;

export interface RunDetail {
  run: RunRecord;
  ownership: RecorderOwnership | null;
  events: TraceEventV1[];
  artifacts: StoredArtifact[];
  redactionAudits: StoredRedactionAudit[];
  gitEvidence: StoredGitEvidence | null;
}

interface RunRow {
  id: string;
  schema_version: number;
  provider: NativeSourceV1["provider"];
  integration_version: string;
  agent_version: string;
  status: RunStatus;
  capture_policy: CapturePolicy;
  capture_policy_version: string;
  redaction_version: string;
  label: string | null;
  prompt_source: string | null;
  repository_fingerprint: string;
  repository_display: string;
  started_at: number;
  ended_at: number | null;
  child_pid: number | null;
  exit_code: number | null;
  terminating_signal: string | null;
  process_event_id: string | null;
  provider_terminal_kind: ProviderTerminalKind | null;
  terminal_reason: string | null;
  contradiction_codes_json: string;
}

interface EventRow {
  id: string;
  run_id: string;
  sequence: number;
  received_at: number;
  source_occurred_at: number | null;
  kind: string;
  status: TraceEventV1["status"];
  provenance: TraceEventV1["provenance"];
  summary: string;
  normalized_payload_json: string | null;
  native_payload_storage: "inline" | "artifact" | "omitted" | null;
  native_payload_inline_json: string | null;
  native_payload_artifact_id: string | null;
  native_payload_omitted_reason: string | null;
  derivation_name: string | null;
  derivation_version: string | null;
  derivation_confidence: "high" | "medium" | "low" | null;
  derivation_identity?: string | null;
  source_provider: NativeSourceV1["provider"];
  session_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  item_id: string | null;
  tool_id: string | null;
  event_type: string | null;
  item_type: string | null;
  correlation_id: string | null;
}

interface DerivationIdentityRow {
  run_id: string;
  identity: string;
  source_event_id: string;
  derivation_name: string;
  derivation_version: string;
  derived_kind: "test.command" | "test.result";
  derived_event_id: string;
  created_at: number;
}

interface CurrentAssessmentRow {
  run_id: string;
  current_event_id: string;
  verdict: AssessmentVerdict;
  task_completion: TaskCompletion;
  note_state: AssessmentNoteProjection["state"];
  note_artifact_id: string | null;
  note_omission_reason: EvidenceOmissionReason | null;
  reviewed_at: number;
  updated_at: number;
}

interface RunListRow extends RunRow {
  git_head_changed: number | null;
  git_branch_changed: number | null;
  ownership_condition: RecorderOwnershipCondition | null;
}

interface OwnershipRow {
  run_id: string;
  recorder_instance_id: string;
  recorder_pid: number;
  recorder_start_token: string;
  child_pid: number | null;
  child_start_token: string | null;
  child_process_group_id: number | null;
  heartbeat_at: number;
  condition: RecorderOwnershipCondition;
  ownership_lost_event_id: string | null;
  updated_at: number;
}

interface RelationshipRow {
  event_id: string;
  relationship_type: TraceEventV1["relationships"][number]["type"];
  related_event_id: string;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  kind: string;
  media_type: string;
  path: string;
  sha256: string;
  byte_length: number;
  redaction_state: "redacted";
  truncated: number;
  original_byte_length: number;
  created_at: number;
}

interface AuditRow {
  event_id: string | null;
  artifact_id: string | null;
  reason: string;
  count: number;
}

interface GitEvidenceRow {
  run_id: string;
  initial_head: string;
  final_head: string;
  initial_branch: string | null;
  final_branch: string | null;
  initial_status_state: "artifact" | "omitted";
  initial_status_artifact_id: string | null;
  initial_status_omission_reason: StoredEvidenceOmissionReason | null;
  final_status_state: "artifact" | "omitted";
  final_status_artifact_id: string | null;
  final_status_omission_reason: StoredEvidenceOmissionReason | null;
  tracked_final_diff_state: "artifact" | "omitted" | "absent";
  tracked_final_diff_artifact_id: string | null;
  tracked_final_diff_omission_reason: StoredEvidenceOmissionReason | null;
  diff_check_state: "artifact" | "omitted";
  diff_check_artifact_id: string | null;
  diff_check_omission_reason: StoredEvidenceOmissionReason | null;
  diff_check_passed: number;
  untracked_metadata_state: "artifact" | "omitted" | "absent";
  untracked_metadata_artifact_id: string | null;
  untracked_metadata_omission_reason: StoredEvidenceOmissionReason | null;
  head_changed: number;
  branch_changed: number;
  captured_at: number;
}

interface ReconciliationDecision {
  status: Exclude<RunStatus, "starting" | "running">;
  terminalReason: string;
  contradictionCodes: string[];
}

function reconciliationEventStatus(status: ReconciliationDecision["status"]): EventStatus {
  if (status === "completed") return "completed";
  if (status === "interrupted") return "interrupted";
  return "failed";
}

function epochMilliseconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid event timestamp: ${value}`);
  return milliseconds;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Value is not JSON-serializable.");
  return serialized;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}

function optionalProperty<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | null
): asserts target is T & Partial<Record<K, V>> {
  if (value !== null) Object.assign(target, { [key]: value });
}

function runFromRow(row: RunRow): RunRecord {
  const result: RunRecord = {
    id: row.id,
    schemaVersion: row.schema_version,
    provider: row.provider,
    integrationVersion: row.integration_version,
    agentVersion: row.agent_version,
    status: row.status,
    capturePolicy: row.capture_policy,
    capturePolicyVersion: row.capture_policy_version,
    redactionVersion: row.redaction_version,
    repositoryFingerprint: row.repository_fingerprint,
    repositoryDisplay: row.repository_display,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    childPid: row.child_pid,
    exitCode: row.exit_code,
    terminatingSignal: row.terminating_signal,
    providerTerminalKind: row.provider_terminal_kind,
    terminalReason: row.terminal_reason,
    contradictionCodes: JSON.parse(row.contradiction_codes_json) as string[]
  };
  optionalProperty(result, "label", row.label);
  optionalProperty(result, "promptSource", row.prompt_source);
  return result;
}

function ownershipFromRow(row: OwnershipRow): RecorderOwnership {
  return {
    runId: row.run_id,
    recorderInstanceId: row.recorder_instance_id,
    recorderPid: row.recorder_pid,
    recorderStartToken: row.recorder_start_token,
    childPid: row.child_pid,
    childStartToken: row.child_start_token,
    childProcessGroupId: row.child_process_group_id,
    heartbeatAt: row.heartbeat_at,
    condition: row.condition,
    ownershipLostEventId: row.ownership_lost_event_id,
    updatedAt: row.updated_at
  };
}

function validateOwnershipIdentity(input: CreateRecorderOwnershipInput): void {
  if (input.recorderInstanceId.length === 0) {
    throw new Error("Recorder instance ID must not be empty.");
  }
  if (!Number.isInteger(input.recorderPid) || input.recorderPid <= 0) {
    throw new Error("Recorder PID must be a positive integer.");
  }
  if (input.recorderStartToken.length === 0) {
    throw new Error("Recorder start token must not be empty.");
  }
  if (!Number.isInteger(input.heartbeatAt)) {
    throw new Error("Recorder heartbeat must be epoch milliseconds.");
  }
}

function sourceFromRow(row: EventRow): NativeSourceV1 {
  const source: NativeSourceV1 = { provider: row.source_provider };
  optionalProperty(source, "sessionId", row.session_id);
  optionalProperty(source, "threadId", row.thread_id);
  optionalProperty(source, "turnId", row.turn_id);
  optionalProperty(source, "itemId", row.item_id);
  optionalProperty(source, "toolId", row.tool_id);
  optionalProperty(source, "eventType", row.event_type);
  optionalProperty(source, "itemType", row.item_type);
  optionalProperty(source, "correlationId", row.correlation_id);
  return source;
}

function artifactFromRow(row: ArtifactRow): StoredArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    mediaType: row.media_type,
    path: row.path,
    sha256: row.sha256,
    byteLength: row.byte_length,
    redactionState: row.redaction_state,
    truncated: row.truncated === 1,
    originalByteLength: row.original_byte_length,
    createdAt: row.created_at
  };
}

function gitEvidenceFromRow(row: GitEvidenceRow): StoredGitEvidence {
  return {
    runId: row.run_id,
    initialHead: row.initial_head,
    finalHead: row.final_head,
    initialBranch: row.initial_branch,
    finalBranch: row.final_branch,
    initialStatus: storedRequiredEvidence(
      row.initial_status_state,
      row.initial_status_artifact_id,
      row.initial_status_omission_reason
    ),
    finalStatus: storedRequiredEvidence(
      row.final_status_state,
      row.final_status_artifact_id,
      row.final_status_omission_reason
    ),
    trackedFinalDiff: storedOptionalEvidence(
      row.tracked_final_diff_state,
      row.tracked_final_diff_artifact_id,
      row.tracked_final_diff_omission_reason
    ),
    diffCheck: storedRequiredEvidence(
      row.diff_check_state,
      row.diff_check_artifact_id,
      row.diff_check_omission_reason
    ),
    diffCheckPassed: row.diff_check_passed === 1,
    untrackedMetadata: storedOptionalEvidence(
      row.untracked_metadata_state,
      row.untracked_metadata_artifact_id,
      row.untracked_metadata_omission_reason
    ),
    headChanged: row.head_changed === 1,
    branchChanged: row.branch_changed === 1,
    capturedAt: row.captured_at
  };
}

function storedRequiredEvidence(
  state: "artifact" | "omitted",
  artifactId: string | null,
  reason: StoredEvidenceOmissionReason | null
): StoredRequiredGitEvidenceRef {
  if (state === "artifact" && artifactId) return Object.freeze({ state, artifactId });
  if (state === "omitted" && reason) return Object.freeze({ state, reason });
  throw new Error("Stored required Git evidence is inconsistent.");
}

function storedOptionalEvidence(
  state: "artifact" | "omitted" | "absent",
  artifactId: string | null,
  reason: StoredEvidenceOmissionReason | null
): StoredOptionalGitEvidenceRef {
  if (state === "absent") return Object.freeze({ state });
  return storedRequiredEvidence(state, artifactId, reason);
}

function validateRequiredEvidence(
  value: unknown,
  field: string
): asserts value is RequiredGitEvidenceRef {
  if (typeof value !== "object" || value === null || !("state" in value)) {
    throw new Error(`${field} requires an explicit artifact or omitted evidence state.`);
  }
  const candidate = value as { state?: unknown; artifactId?: unknown; reason?: unknown };
  if (candidate.state === "artifact" && typeof candidate.artifactId === "string" && candidate.artifactId.length > 0) {
    return;
  }
  if (
    candidate.state === "omitted" &&
    (candidate.reason === "metadata-only" || candidate.reason === "strict")
  ) return;
  throw new Error(`${field} has an invalid artifact or omitted evidence state.`);
}

function validateOptionalEvidence(
  value: unknown,
  field: string
): asserts value is OptionalGitEvidenceRef {
  if (typeof value === "object" && value !== null && "state" in value &&
      (value as { state?: unknown }).state === "absent") return;
  validateRequiredEvidence(value, field);
}

function evidenceColumns(value: RequiredGitEvidenceRef | OptionalGitEvidenceRef): [string, string | null, string | null] {
  if (value.state === "artifact") return [value.state, value.artifactId, null];
  if (value.state === "omitted") return [value.state, null, value.reason];
  return [value.state, null, null];
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
}

function validateAssessmentNote(value: unknown): asserts value is AssessmentNoteRef {
  if (typeof value !== "object" || value === null || !("state" in value)) {
    throw new Error("Assessment note requires an explicit note state tuple.");
  }
  const candidate = value as { state?: unknown; artifact?: unknown; reason?: unknown };
  if (candidate.state === "absent" && hasExactKeys(value, ["state"])) return;
  if (
    candidate.state === "artifact" &&
    hasExactKeys(value, ["artifact", "state"]) &&
    typeof candidate.artifact === "object" &&
    candidate.artifact !== null
  ) return;
  if (
    candidate.state === "omitted" &&
    hasExactKeys(value, ["reason", "state"]) &&
    (candidate.reason === "metadata-only" || candidate.reason === "strict")
  ) return;
  throw new Error("Assessment note state tuple is invalid.");
}

function validateAssessmentInput(
  input: UpdateAssessmentInput,
  audits: readonly RedactionAudit[]
): Readonly<{
  taskCompleted: TaskCompletion;
  note: AssessmentNoteRef;
  receivedAt: number;
}> {
  if (!input || typeof input !== "object") throw new Error("Assessment input is required.");
  if (typeof input.runId !== "string" || input.runId.length === 0) {
    throw new Error("Assessment run ID must not be empty.");
  }
  if (typeof input.eventId !== "string" || input.eventId.length === 0) {
    throw new Error("Assessment event ID must not be empty.");
  }
  if (!(input.verdict === "unreviewed" || input.verdict === "success" ||
      input.verdict === "partial" || input.verdict === "failure")) {
    throw new Error("Assessment verdict is invalid.");
  }
  const taskCompleted = input.taskCompleted ?? "uncertain";
  if (!(taskCompleted === "yes" || taskCompleted === "no" || taskCompleted === "uncertain")) {
    throw new Error("Assessment task completion is invalid.");
  }
  if (input.verdict === "unreviewed" && taskCompleted !== "uncertain") {
    throw new Error("An explicit unreviewed assessment requires uncertain task completion.");
  }
  const note: AssessmentNoteRef = input.note ?? Object.freeze({ state: "absent" });
  validateAssessmentNote(note);
  for (const audit of audits) {
    if (!Number.isInteger(audit.count) || audit.count <= 0) {
      throw new Error("Redaction audit counts must be positive integers.");
    }
  }
  return Object.freeze({
    taskCompleted,
    note,
    receivedAt: epochMilliseconds(input.receivedAt)
  });
}

function assessmentNoteProjection(note: AssessmentNoteRef): AssessmentNoteProjection {
  if (note.state === "artifact") {
    return Object.freeze({ state: "artifact", artifactId: note.artifact.id });
  }
  return Object.freeze({ ...note });
}

function projectedAssessment(runId: string): ProjectedCurrentAssessment {
  return Object.freeze({
    runId,
    verdict: "unreviewed",
    taskCompleted: "uncertain",
    note: Object.freeze({ state: "absent" }),
    state: "projected",
    provenance: null,
    currentEventId: null,
    reviewedAt: null,
    updatedAt: null
  });
}

function currentAssessmentFromRow(row: CurrentAssessmentRow): ExplicitCurrentAssessment {
  let note: AssessmentNoteProjection;
  if (row.note_state === "absent" && row.note_artifact_id === null &&
      row.note_omission_reason === null) {
    note = Object.freeze({ state: "absent" });
  } else if (row.note_state === "artifact" && row.note_artifact_id !== null &&
      row.note_omission_reason === null) {
    note = Object.freeze({ state: "artifact", artifactId: row.note_artifact_id });
  } else if (row.note_state === "omitted" && row.note_artifact_id === null &&
      (row.note_omission_reason === "metadata-only" || row.note_omission_reason === "strict")) {
    note = Object.freeze({ state: "omitted", reason: row.note_omission_reason });
  } else {
    throw new Error("Stored current assessment note state is inconsistent.");
  }
  return Object.freeze({
    runId: row.run_id,
    verdict: row.verdict,
    taskCompleted: row.task_completion,
    note,
    state: "explicit",
    provenance: "human",
    currentEventId: row.current_event_id,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at
  });
}

function reconcileFacts(
  provider: ProviderTerminalKind | null,
  exitCode: number | null,
  signal: string | null,
  recorderFailure: boolean,
  recorderCrash: boolean,
  explicitInterruption: boolean
): ReconciliationDecision {
  const contradictionCodes: string[] = [];
  const interrupted = signal !== null || explicitInterruption;

  if (provider === "completed" && recorderFailure) {
    contradictionCodes.push("provider_completed_but_recorder_failed");
  }
  if (provider === "completed" && recorderCrash) {
    contradictionCodes.push("provider_completed_but_recorder_crashed");
  }
  if (provider === "completed" && interrupted) {
    contradictionCodes.push("provider_completed_but_interrupted");
  }
  if (provider === "failed" && exitCode === 0) {
    contradictionCodes.push("provider_failed_with_zero_exit");
  }
  if (provider === "completed" && exitCode !== null && exitCode !== 0) {
    contradictionCodes.push("provider_completed_with_nonzero_exit");
  }
  if (explicitInterruption && provider === null && exitCode === 0) {
    contradictionCodes.push("zero_exit_but_interrupted");
  }

  if (recorderFailure) {
    return { status: "recorder_error", terminalReason: "recorder_failure", contradictionCodes };
  }
  if (recorderCrash) {
    return { status: "interrupted", terminalReason: "recorder_crash", contradictionCodes };
  }
  if (interrupted) {
    return {
      status: "interrupted",
      terminalReason: signal !== null ? "child_signal" : "explicit_interruption",
      contradictionCodes
    };
  }
  if (provider === "failed") {
    return { status: "failed", terminalReason: "provider_failed", contradictionCodes };
  }
  if (exitCode !== null && exitCode !== 0) {
    return { status: "failed", terminalReason: "child_exit_nonzero", contradictionCodes };
  }
  if (provider === "completed" && exitCode === 0) {
    return {
      status: "completed",
      terminalReason: "provider_completed_and_zero_exit",
      contradictionCodes
    };
  }
  if (provider === null && exitCode === 0) {
    return { status: "failed", terminalReason: "incomplete_provider_stream", contradictionCodes };
  }
  return {
    status: "recorder_error",
    terminalReason: "unreconciled_terminal_facts",
    contradictionCodes
  };
}

function sameNativeIdentity(started: TraceEventV1, candidate: TraceEventV1): boolean {
  if (started.source.provider !== candidate.source.provider) return false;
  const eventFamily = (event: TraceEventV1): string =>
    event.source.eventType?.split(".", 1)[0] ?? event.kind.split(".", 1)[0] ?? event.kind;
  const kindFamily = (event: TraceEventV1): string => event.kind.split(".", 1)[0] ?? event.kind;
  if (eventFamily(started) !== eventFamily(candidate) || kindFamily(started) !== kindFamily(candidate)) {
    return false;
  }

  const mustMatchWhenPresent = (key: keyof NativeSourceV1): boolean =>
    started.source[key] === undefined || started.source[key] === candidate.source[key];
  for (const key of ["sessionId", "threadId", "turnId"] as const) {
    if (!mustMatchWhenPresent(key)) return false;
  }
  if (started.source.correlationId !== undefined && !mustMatchWhenPresent("correlationId")) return false;

  const hasItemIdentity = started.source.itemId !== undefined || started.source.toolId !== undefined;
  if (hasItemIdentity) {
    if (!mustMatchWhenPresent("itemId") || !mustMatchWhenPresent("toolId")) return false;
    if (!mustMatchWhenPresent("itemType")) return false;
    return true;
  }
  if (started.source.turnId !== undefined) return candidate.source.turnId === started.source.turnId;
  if (started.source.threadId !== undefined) return candidate.source.threadId === started.source.threadId;
  return started.source.sessionId !== undefined && candidate.source.sessionId === started.source.sessionId;
}

function isRecoverableProviderLifecycle(event: TraceEventV1): boolean {
  const { eventType, itemId, toolId } = event.source;
  const hasStableNativeIdentity = itemId !== undefined || toolId !== undefined;
  return hasStableNativeIdentity && (eventType === "item.started" || eventType === "tool.started");
}

function isObservedTerminalEvent(event: TraceEventV1): boolean {
  if (event.provenance !== "observed") return false;
  if (
    event.status === "completed" ||
    event.status === "failed" ||
    event.status === "declined" ||
    event.status === "interrupted"
  ) return true;

  switch (event.source.eventType) {
    case "item.completed":
    case "item.failed":
    case "item.declined":
    case "item.interrupted":
    case "tool.completed":
    case "tool.failed":
    case "tool.declined":
    case "tool.interrupted":
      return true;
    default:
      return false;
  }
}

function recoverySourceMatches(target: TraceEventV1, recovery: TraceEventV1): boolean {
  if (target.source.provider !== recovery.source.provider) return false;
  const keys: readonly (keyof NativeSourceV1)[] = [
    "sessionId", "threadId", "turnId", "itemId", "toolId", "itemType", "correlationId"
  ];
  return keys.every((key) => target.source[key] === recovery.source[key]);
}

function payloadRecord(event: TraceEventV1, label: string): Record<string, unknown> {
  if (
    typeof event.normalizedPayload !== "object" ||
    event.normalizedPayload === null ||
    Array.isArray(event.normalizedPayload)
  ) throw new Error(`${label} requires a structured normalized payload.`);
  return event.normalizedPayload as Record<string, unknown>;
}

function classifyProviderTerminal(event: TraceEventV1, run: RunRow): ProviderTerminalKind {
  const commonValid =
    event.runId === run.id &&
    event.provenance === "observed" &&
    event.source.provider === run.provider &&
    event.source.eventType === event.kind;
  if (commonValid && event.kind === "turn.completed" && event.status === "completed") return "completed";
  if (commonValid && event.kind === "turn.failed" && event.status === "failed") return "failed";
  throw new Error("Provider terminal semantics require an observed turn.completed or turn.failed event.");
}

function classifyProcessEvent(
  event: TraceEventV1,
  run: RunRow
): { exitCode: number | null; terminatingSignal: string | null } {
  if (
    event.runId !== run.id ||
    event.kind !== "recorder.process_exit" ||
    event.provenance !== "recorder" ||
    event.source.provider !== run.provider ||
    event.source.correlationId !== run.id
  ) throw new Error("Process fact recorder semantics are invalid.");
  const payload = payloadRecord(event, "Process fact");
  const exitCode = payload.exitCode;
  const terminatingSignal = payload.terminatingSignal;
  if (!(exitCode === null || (typeof exitCode === "number" && Number.isInteger(exitCode)))) {
    throw new Error("Process fact exitCode must be an integer or null.");
  }
  if (!(terminatingSignal === null || (typeof terminatingSignal === "string" && terminatingSignal.length > 0))) {
    throw new Error("Process fact terminatingSignal must be a non-empty string or null.");
  }
  if (exitCode !== null && terminatingSignal !== null) {
    throw new Error("Process fact cannot contain both a numeric exit and a signal.");
  }
  const expectedStatus = terminatingSignal !== null
    ? "interrupted"
    : exitCode === null
      ? "unknown"
      : exitCode === 0 ? "completed" : "failed";
  if (event.status !== expectedStatus) {
    throw new Error(`Process fact status must be ${expectedStatus} for its stored payload.`);
  }
  return { exitCode, terminatingSignal };
}

function validateRecorderFailure(event: TraceEventV1, run: RunRow): void {
  const payload = payloadRecord(event, "Recorder failure");
  if (
    event.runId !== run.id ||
    event.kind !== "error" ||
    event.provenance !== "recorder" ||
    event.status !== "failed" ||
    event.source.provider !== run.provider ||
    event.source.correlationId !== run.id ||
    payload.recorderFailure !== true
  ) throw new Error("Recorder failure semantics are invalid.");
}

function validateRecorderCrash(event: TraceEventV1, run: RunRow): void {
  const payload = payloadRecord(event, "Recorder ownership loss");
  if (
    event.runId !== run.id ||
    event.kind !== "recorder.ownership_lost" ||
    event.provenance !== "recorder" ||
    event.status !== "interrupted" ||
    event.source.provider !== run.provider ||
    event.source.correlationId !== run.id ||
    payload.recorderCrash !== true
  ) throw new Error("Recorder crash supporting event semantics are invalid.");
}

function validateInterruption(event: TraceEventV1, run: RunRow): void {
  const payload = payloadRecord(event, "Explicit interruption");
  if (
    event.runId !== run.id ||
    event.kind !== "recorder.interruption" ||
    event.provenance !== "recorder" ||
    event.status !== "interrupted" ||
    event.source.provider !== run.provider ||
    event.source.correlationId !== run.id ||
    payload.explicitInterruption !== true
  ) throw new Error("Explicit interruption supporting event semantics are invalid.");
}

function detectStorageSchemaCapabilities(
  connection: Database.Database
): StorageSchemaCapabilities {
  const tables = new Set(connection.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'derivation_identities',
        'current_assessments',
        'event_artifact_bindings'
      )
  `).pluck().all() as string[]);
  return Object.freeze({
    derivationIdentities: tables.has("derivation_identities"),
    currentAssessments: tables.has("current_assessments"),
    eventArtifactBindings: tables.has("event_artifact_bindings")
  });
}

export class RunRepository {
  readonly #connection: Database.Database;
  readonly #artifactRoot: string;
  readonly schemaCapabilities: StorageSchemaCapabilities;

  constructor(database: AgentLensDatabase, options: RunRepositoryOptions) {
    this.#connection = connectionFor(database);
    if (!options || !isAbsolute(options.artifactRoot)) {
      throw new Error("RunRepository requires an absolute configured artifact root.");
    }
    this.#artifactRoot = resolve(options.artifactRoot);
    this.schemaCapabilities = detectStorageSchemaCapabilities(this.#connection);
  }

  createRun(input: CreateRunInput, ownership: CreateRecorderOwnershipInput): RunRecord {
    validateOwnershipIdentity(ownership);
    return this.#connection.transaction(() => {
      this.#connection.prepare(`
        INSERT INTO runs (
          id, schema_version, provider, integration_version, agent_version, status,
          capture_policy, capture_policy_version, redaction_version, label, prompt_source,
          repository_fingerprint, repository_display, started_at
        ) VALUES (
          @id, @schemaVersion, @provider, @integrationVersion, @agentVersion, 'starting',
          @capturePolicy, @capturePolicyVersion, @redactionVersion, @label, @promptSource,
          @repositoryFingerprint, @repositoryDisplay, @startedAt
        )
      `).run({ ...input, label: input.label ?? null, promptSource: input.promptSource ?? null });
      this.#connection.prepare(`
        INSERT INTO run_ownership (
          run_id, recorder_instance_id, recorder_pid, recorder_start_token,
          heartbeat_at, condition, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?)
      `).run(
        input.id,
        ownership.recorderInstanceId,
        ownership.recorderPid,
        ownership.recorderStartToken,
        ownership.heartbeatAt,
        ownership.heartbeatAt
      );
      return this.requireRun(input.id);
    }).immediate();
  }

  markRunning(runId: string, input: MarkRunningInput): RunRecord {
    if (!Number.isInteger(input.childPid) || input.childPid <= 0) {
      throw new Error("childPid must be a positive integer.");
    }
    if (
      input.childProcessGroupId !== null &&
      (!Number.isInteger(input.childProcessGroupId) || input.childProcessGroupId <= 0)
    ) {
      throw new Error("childProcessGroupId must be a positive integer or null.");
    }
    if (input.childStartToken !== null && input.childStartToken.length === 0) {
      throw new Error("childStartToken must be non-empty or null.");
    }
    if (!Number.isInteger(input.updatedAt)) throw new Error("Ownership update time must be epoch milliseconds.");
    return this.#connection.transaction(() => {
      if (this.requireRunRow(runId).status !== "starting") {
        throw new Error(`Run ${runId} is not in starting status.`);
      }
      const ownership = this.#connection.prepare(`
        UPDATE run_ownership
        SET child_pid = ?, child_start_token = ?, child_process_group_id = ?, updated_at = ?
        WHERE run_id = ? AND recorder_instance_id = ? AND condition = 'active'
      `).run(
        input.childPid,
        input.childStartToken,
        input.childProcessGroupId,
        input.updatedAt,
        runId,
        input.recorderInstanceId
      );
      if (ownership.changes !== 1) throw new Error(`Run ${runId} recorder ownership changed before spawn.`);
      const result = this.#connection
        .prepare("UPDATE runs SET status = 'running', child_pid = ? WHERE id = ? AND status = 'starting'")
        .run(input.childPid, runId);
      if (result.changes !== 1) throw new Error(`Run ${runId} is not in starting status.`);
      return this.requireRun(runId);
    }).immediate();
  }

  refreshOwnership(
    runId: string,
    input: { recorderInstanceId: string; heartbeatAt: number }
  ): boolean {
    if (!Number.isInteger(input.heartbeatAt)) throw new Error("Recorder heartbeat must be epoch milliseconds.");
    const result = this.#connection.prepare(`
      UPDATE run_ownership
      SET heartbeat_at = ?, updated_at = ?
      WHERE run_id = ? AND recorder_instance_id = ? AND condition IN ('active', 'reconciling')
    `).run(input.heartbeatAt, input.heartbeatAt, runId, input.recorderInstanceId);
    return result.changes === 1;
  }

  setChildStartToken(
    runId: string,
    input: {
      recorderInstanceId: string;
      childPid: number;
      childStartToken: string;
      updatedAt: number;
    }
  ): boolean {
    if (input.childStartToken.length === 0) throw new Error("Child start token must not be empty.");
    if (!Number.isInteger(input.updatedAt)) throw new Error("Ownership update time must be epoch milliseconds.");
    const result = this.#connection.prepare(`
      UPDATE run_ownership
      SET child_start_token = ?, updated_at = ?
      WHERE run_id = ? AND recorder_instance_id = ? AND child_pid = ? AND condition = 'active'
    `).run(
      input.childStartToken,
      input.updatedAt,
      runId,
      input.recorderInstanceId,
      input.childPid
    );
    return result.changes === 1;
  }

  releaseOwnership(
    runId: string,
    input: { recorderInstanceId: string; updatedAt: number }
  ): boolean {
    if (!Number.isInteger(input.updatedAt)) throw new Error("Ownership update time must be epoch milliseconds.");
    const result = this.#connection.prepare(`
      UPDATE run_ownership
      SET condition = 'released', updated_at = ?
      WHERE run_id = ? AND recorder_instance_id = ? AND condition != 'released'
    `).run(input.updatedAt, runId, input.recorderInstanceId);
    return result.changes === 1;
  }

  markOrphanChildActive(
    runId: string,
    input: { recorderInstanceId: string; updatedAt: number }
  ): boolean {
    if (!Number.isInteger(input.updatedAt)) throw new Error("Ownership update time must be epoch milliseconds.");
    const result = this.#connection.prepare(`
      UPDATE run_ownership
      SET condition = 'orphan_child_active', updated_at = ?
      WHERE run_id = ? AND recorder_instance_id = ?
        AND condition IN ('active', 'orphan_child_active', 'identity_ambiguous')
    `).run(input.updatedAt, runId, input.recorderInstanceId);
    return result.changes === 1;
  }

  markOwnershipIdentityAmbiguous(
    runId: string,
    input: { recorderInstanceId: string; updatedAt: number }
  ): boolean {
    if (!Number.isInteger(input.updatedAt)) throw new Error("Ownership update time must be epoch milliseconds.");
    const result = this.#connection.prepare(`
      UPDATE run_ownership
      SET condition = 'identity_ambiguous', updated_at = ?
      WHERE run_id = ? AND recorder_instance_id = ?
        AND condition IN ('active', 'orphan_child_active', 'identity_ambiguous')
    `).run(input.updatedAt, runId, input.recorderInstanceId);
    return result.changes === 1;
  }

  claimRecoveryOwnership(
    runId: string,
    input: {
      expectedRecorderInstanceId: string;
      recovery: CreateRecorderOwnershipInput;
    }
  ): boolean {
    validateOwnershipIdentity(input.recovery);
    return this.#connection.transaction(() => {
      const run = this.requireRunRow(runId);
      if (run.status !== "starting" && run.status !== "running") return false;
      const result = this.#connection.prepare(`
        UPDATE run_ownership
        SET recorder_instance_id = ?, recorder_pid = ?, recorder_start_token = ?,
            heartbeat_at = ?, condition = 'reconciling', updated_at = ?
        WHERE run_id = ? AND recorder_instance_id = ? AND condition != 'released'
      `).run(
        input.recovery.recorderInstanceId,
        input.recovery.recorderPid,
        input.recovery.recorderStartToken,
        input.recovery.heartbeatAt,
        input.recovery.heartbeatAt,
        runId,
        input.expectedRecorderInstanceId
      );
      return result.changes === 1;
    }).immediate();
  }

  appendOwnershipLossIfCurrent(runId: string, input: OwnershipLossInput): OwnershipLossResult {
    if (input.expectedRecorderInstanceId.length === 0) {
      throw new Error("Expected recorder instance ID must be non-empty.");
    }
    return this.#connection.transaction(() => {
      const run = this.requireRunRow(runId);
      const ownership = this.requireOwnership(runId);
      if (run.status !== "starting" && run.status !== "running") {
        return { kind: "already_terminal" } as const;
      }
      if (
        ownership.recorderInstanceId !== input.expectedRecorderInstanceId ||
        ownership.condition === "released"
      ) {
        return { kind: "ownership_changed" } as const;
      }
      if (ownership.ownershipLostEventId) {
        return {
          kind: "already_lost",
          event: this.requireEventInRun(runId, ownership.ownershipLostEventId)
        } as const;
      }
      const event = traceEventV1Schema.parse({
        id: input.eventId,
        runId,
        sequence: this.nextSequence(runId),
        receivedAt: input.receivedAt,
        kind: "recorder.ownership_lost",
        status: "interrupted",
        provenance: "recorder",
        source: { provider: run.provider, correlationId: runId },
        relationships: [],
        summary: "Recorder ownership lost",
        normalizedPayload: {
          recorderCrash: true,
          reason: "recorder_crash",
          recorderInstanceId: ownership.recorderInstanceId,
          recorderPid: ownership.recorderPid,
          childPid: ownership.childPid,
          childProcessGroupId: ownership.childProcessGroupId
        }
      });
      this.insertEvent(event, []);
      const updated = this.#connection.prepare(`
        UPDATE run_ownership
        SET ownership_lost_event_id = ?, updated_at = ?
        WHERE run_id = ? AND recorder_instance_id = ?
          AND condition != 'released' AND ownership_lost_event_id IS NULL
      `).run(
        input.eventId,
        epochMilliseconds(input.receivedAt),
        runId,
        input.expectedRecorderInstanceId
      );
      if (updated.changes !== 1) throw new Error("Ownership-loss event lost its append race.");
      return { kind: "recorded", event } as const;
    }).immediate();
  }

  appendEvent(input: TraceEventV1, audits: readonly RedactionAudit[] = []): TraceEventV1 {
    const event = traceEventV1Schema.parse(input);
    this.#connection.transaction(() => {
      this.validateEventRelationships(event);
      this.insertEvent(event, audits);
    }).immediate();
    return event;
  }

  appendDerivedEvent(input: AppendDerivedEventInput): TraceEventV1 {
    if (!this.schemaCapabilities.derivationIdentities) {
      throw new Error("Task 6 derivation identity storage is unavailable.");
    }
    this.validateDerivedEventInput(input);

    const append = this.#connection.transaction(() => {
      const sourceOwner = this.sourceEventOwner(input.sourceEventId);
      if (!sourceOwner) {
        throw new Error(`Derived source event ${input.sourceEventId} does not exist.`);
      }
      if (sourceOwner.provider !== input.sourceProvider) {
        throw new Error("Derived event source provider must match the run provider.");
      }
      this.validateDerivedIdentityForSource(sourceOwner.runId, input);

      const existing = this.resolveExistingDerivedEvent(sourceOwner.runId, input);
      if (existing) return existing;

      const eventOwner = this.#connection
        .prepare("SELECT run_id FROM events WHERE id = ?")
        .get(input.eventId) as { run_id: string } | undefined;
      if (eventOwner && eventOwner.run_id !== sourceOwner.runId) {
        throw new Error("Deterministic derived event ID is already owned by another run.");
      }
      if (eventOwner) {
        throw new Error("Deterministic derived event exists without its identity binding.");
      }

      const event = this.derivedEvent(input, sourceOwner.runId, this.nextSequence(sourceOwner.runId));
      this.validateEventRelationships(event);
      this.insertEvent(event, []);
      this.#connection.prepare(`
        INSERT INTO derivation_identities (
          run_id, identity, source_event_id, derivation_name, derivation_version,
          derived_kind, derived_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sourceOwner.runId,
        input.identity,
        input.sourceEventId,
        input.derivation.name,
        input.derivation.version,
        input.kind,
        input.eventId,
        epochMilliseconds(input.receivedAt)
      );
      return event;
    });

    try {
      return append.immediate();
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const sourceOwner = this.sourceEventOwner(input.sourceEventId);
      const winner = sourceOwner
        ? this.resolveExistingDerivedEvent(sourceOwner.runId, input)
        : undefined;
      if (winner) return winner;
      throw error;
    }
  }

  async commitArtifactMetadata(
    input: CompletedArtifact,
    audits: readonly RedactionAudit[] = [],
    createdAt = Date.now()
  ): Promise<StoredArtifact> {
    for (const audit of audits) {
      if (!Number.isInteger(audit.count) || audit.count <= 0) {
        throw new Error("Redaction audit counts must be positive integers.");
      }
    }
    const handle = await this.openValidatedArtifact(input);
    try {
      this.#connection.transaction(() => {
        this.insertArtifactMetadata(input, audits, createdAt);
      })();
      return { ...input, createdAt };
    } finally {
      await handle.close();
    }
  }

  private async openValidatedArtifact(input: CompletedArtifact): Promise<FileHandle> {
    if (!isAbsolute(input.path) || basename(input.path) !== input.id || input.id !== input.sha256) {
      throw new Error("Completed artifact path, ID, and SHA-256 identity do not match.");
    }
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
      throw new Error("Completed artifact digest is not a SHA-256 hex identity.");
    }

    const expectedPath = join(this.#artifactRoot, input.id.slice(0, 2), input.id);
    if (input.path !== expectedPath || resolve(input.path) !== expectedPath) {
      throw new Error("Completed artifact is outside the canonical content-addressed artifact layout.");
    }

    let handle: FileHandle;
    let pathDevice: number | undefined;
    let pathInode: number | undefined;
    try {
      const pathStat = await lstat(input.path);
      if (pathStat.isSymbolicLink()) throw new Error("Completed artifact cannot be a symbolic link.");
      pathDevice = pathStat.dev;
      pathInode = pathStat.ino;
      const [canonicalRoot, canonicalPath] = await Promise.all([
        realpath(this.#artifactRoot),
        realpath(input.path)
      ]);
      const canonicalExpectedPath = join(canonicalRoot, input.id.slice(0, 2), input.id);
      if (canonicalPath !== canonicalExpectedPath) {
        throw new Error("Completed artifact canonical path escapes the configured artifact root.");
      }
      handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (error instanceof Error && /symbolic|canonical|artifact root/i.test(error.message)) throw error;
      throw new Error(`Completed artifact is not available at ${input.path}.`, { cause: error });
    }

    try {
      const artifactStat = await handle.stat();
      const bytes = await handle.readFile();
      if (artifactStat.dev !== pathDevice || artifactStat.ino !== pathInode) {
        throw new Error("Completed artifact identity changed while it was being opened.");
      }
      if (!artifactStat.isFile() || artifactStat.size !== input.byteLength || bytes.byteLength !== input.byteLength) {
        throw new Error("Completed artifact byte length does not match metadata.");
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== input.sha256) throw new Error("Completed artifact digest does not match metadata.");
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private insertArtifactMetadata(
    input: CompletedArtifact,
    audits: readonly RedactionAudit[],
    createdAt: number
  ): void {
    this.#connection.prepare(`
      INSERT INTO artifacts (
        id, run_id, kind, media_type, path, sha256, byte_length, redaction_state,
        truncated, original_byte_length, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.runId, input.kind, input.mediaType, input.path, input.sha256,
      input.byteLength, input.redactionState, input.truncated ? 1 : 0,
      input.originalByteLength, createdAt
    );
    this.insertAudits(input.runId, null, input.id, audits, createdAt);
  }

  getCurrentAssessment(runId: string): CurrentAssessment {
    this.requireRunRow(runId);
    if (!this.schemaCapabilities.currentAssessments) return projectedAssessment(runId);
    const row = this.#connection.prepare(`
      SELECT * FROM current_assessments WHERE run_id = ?
    `).get(runId) as CurrentAssessmentRow | undefined;
    return row ? currentAssessmentFromRow(row) : projectedAssessment(runId);
  }

  async updateAssessment(
    input: UpdateAssessmentInput,
    noteAudits: readonly RedactionAudit[] = []
  ): Promise<ExplicitCurrentAssessment> {
    const validated = validateAssessmentInput(input, noteAudits);
    if (!this.schemaCapabilities.currentAssessments ||
        !this.schemaCapabilities.eventArtifactBindings) {
      throw new Error("Task 6 assessment storage is unavailable.");
    }
    const initialRun = this.requireRunRow(input.runId);
    if (validated.note.state === "artifact") {
      this.validateAssessmentNoteArtifact(input.runId, validated.note.artifact);
    }
    const noteProjection = assessmentNoteProjection(validated.note);
    const artifactHandle = validated.note.state === "artifact"
      ? await this.openValidatedArtifact(validated.note.artifact)
      : null;

    try {
      return this.#connection.transaction(() => {
        const run = this.requireRunRow(input.runId);
        if (run.provider !== initialRun.provider) {
          throw new Error("Assessment run provider changed before persistence.");
        }
        const eventOwner = this.#connection
          .prepare("SELECT run_id FROM events WHERE id = ?")
          .get(input.eventId) as { run_id: string } | undefined;
        if (eventOwner) {
          if (eventOwner.run_id !== input.runId) {
            throw new Error("Assessment event ID is already owned by another run.");
          }
          throw new Error("Assessment event ID already exists in this run.");
        }

        if (validated.note.state === "artifact") {
          this.insertOrReuseAssessmentArtifact(
            validated.note.artifact,
            noteAudits,
            validated.receivedAt
          );
        }

        const event = traceEventV1Schema.parse({
          id: input.eventId,
          runId: input.runId,
          sequence: this.nextSequence(input.runId),
          receivedAt: input.receivedAt,
          kind: "assessment.updated",
          status: "completed",
          provenance: "human",
          source: { provider: run.provider },
          relationships: [],
          summary: "Human assessment updated",
          normalizedPayload: {
            verdict: input.verdict,
            taskCompleted: validated.taskCompleted,
            note: noteProjection
          }
        });
        this.validateEventRelationships(event);
        this.insertEvent(event, []);

        if (noteProjection.state === "artifact") {
          this.#connection.prepare(`
            INSERT INTO event_artifact_bindings (
              event_id, run_id, artifact_id, role, created_at
            ) VALUES (?, ?, ?, 'assessment_note', ?)
          `).run(event.id, event.runId, noteProjection.artifactId, validated.receivedAt);
        }

        const noteArtifactId = noteProjection.state === "artifact"
          ? noteProjection.artifactId
          : null;
        const noteOmissionReason = noteProjection.state === "omitted"
          ? noteProjection.reason
          : null;
        this.#connection.prepare(`
          INSERT INTO current_assessments (
            run_id, current_event_id, verdict, task_completion, note_state,
            note_artifact_id, note_omission_reason, reviewed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            current_event_id = excluded.current_event_id,
            verdict = excluded.verdict,
            task_completion = excluded.task_completion,
            note_state = excluded.note_state,
            note_artifact_id = excluded.note_artifact_id,
            note_omission_reason = excluded.note_omission_reason,
            reviewed_at = current_assessments.reviewed_at,
            updated_at = excluded.updated_at
        `).run(
          input.runId,
          event.id,
          input.verdict,
          validated.taskCompleted,
          noteProjection.state,
          noteArtifactId,
          noteOmissionReason,
          validated.receivedAt,
          validated.receivedAt
        );
        const current = this.#connection.prepare(`
          SELECT * FROM current_assessments WHERE run_id = ?
        `).get(input.runId) as CurrentAssessmentRow;
        return currentAssessmentFromRow(current);
      }).immediate();
    } finally {
      if (artifactHandle) await artifactHandle.close();
    }
  }

  private validateAssessmentNoteArtifact(runId: string, artifact: CompletedArtifact): void {
    if (artifact.runId !== runId) {
      throw new Error("Assessment note artifact must belong to the same run.");
    }
    if (artifact.kind !== "assessment-note") {
      throw new Error("Assessment note artifact kind must be assessment-note.");
    }
    if (artifact.mediaType !== "text/plain; charset=utf-8") {
      throw new Error("Assessment note artifact media type must be UTF-8 plain text.");
    }
    if (artifact.redactionState !== "redacted") {
      throw new Error("Assessment note artifact must be redacted.");
    }
    if (typeof artifact.truncated !== "boolean" ||
        !Number.isInteger(artifact.originalByteLength) || artifact.originalByteLength < 0) {
      throw new Error("Assessment note artifact truncation metadata is invalid.");
    }
  }

  private insertOrReuseAssessmentArtifact(
    input: CompletedArtifact,
    audits: readonly RedactionAudit[],
    createdAt: number
  ): void {
    const existing = this.#connection.prepare("SELECT * FROM artifacts WHERE id = ?")
      .get(input.id) as ArtifactRow | undefined;
    if (!existing) {
      this.insertArtifactMetadata(input, audits, createdAt);
      return;
    }
    if (existing.run_id !== input.runId) {
      throw new Error("Assessment note artifact is already owned by another run.");
    }
    if (
      existing.id !== input.id ||
      existing.kind !== input.kind ||
      existing.media_type !== input.mediaType ||
      existing.path !== input.path ||
      existing.sha256 !== input.sha256 ||
      existing.byte_length !== input.byteLength ||
      existing.redaction_state !== input.redactionState ||
      (existing.truncated === 1) !== input.truncated ||
      existing.original_byte_length !== input.originalByteLength
    ) {
      throw new Error("Existing assessment note artifact metadata does not match the completed artifact.");
    }
    const storedAudits = this.#connection.prepare(`
      SELECT event_id, artifact_id, reason, count
      FROM redaction_audits
      WHERE artifact_id = ?
      ORDER BY id
    `).all(input.id) as AuditRow[];
    const requestedAudits: AuditRow[] = audits.map((audit) => ({
      event_id: null,
      artifact_id: input.id,
      reason: audit.reason,
      count: audit.count
    }));
    if (!isDeepStrictEqual(storedAudits, requestedAudits)) {
      throw new Error("Existing assessment note artifact audits do not match the completed artifact.");
    }
  }

  saveGitEvidence(runId: string, input: GitEvidenceInput): StoredGitEvidence {
    validateRequiredEvidence(input.initialStatus, "Initial status evidence");
    validateRequiredEvidence(input.finalStatus, "Final status evidence");
    validateOptionalEvidence(input.trackedFinalDiff, "Tracked final diff evidence");
    validateRequiredEvidence(input.diffCheck, "Diff-check evidence");
    validateOptionalEvidence(input.untrackedMetadata, "Untracked metadata evidence");
    const initialStatus = evidenceColumns(input.initialStatus);
    const finalStatus = evidenceColumns(input.finalStatus);
    const trackedFinalDiff = evidenceColumns(input.trackedFinalDiff);
    const diffCheck = evidenceColumns(input.diffCheck);
    const untrackedMetadata = evidenceColumns(input.untrackedMetadata);
    this.#connection.prepare(`
      INSERT INTO git_evidence (
        run_id, initial_head, final_head, initial_branch, final_branch,
        initial_status_state, initial_status_artifact_id, initial_status_omission_reason,
        final_status_state, final_status_artifact_id, final_status_omission_reason,
        tracked_final_diff_state, tracked_final_diff_artifact_id, tracked_final_diff_omission_reason,
        diff_check_state, diff_check_artifact_id, diff_check_omission_reason, diff_check_passed,
        untracked_metadata_state, untracked_metadata_artifact_id, untracked_metadata_omission_reason,
        head_changed, branch_changed, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId, input.initialHead, input.finalHead, input.initialBranch, input.finalBranch,
      ...initialStatus, ...finalStatus, ...trackedFinalDiff, ...diffCheck,
      input.diffCheckPassed ? 1 : 0, ...untrackedMetadata,
      input.headChanged ? 1 : 0, input.branchChanged ? 1 : 0, input.capturedAt
    );
    return { runId, ...input };
  }

  recordProcessFact(runId: string, input: ProcessFactInput): RunRecord {
    return this.#connection.transaction(() => {
      const run = this.requireRunRow(runId);
      if (!(["starting", "running"] as RunStatus[]).includes(run.status)) {
        throw new Error(`Cannot record process facts after run ${runId} is terminal.`);
      }
      if (run.status !== "running") throw new Error("Process facts require a running run.");
      const event = this.requireEventInRun(runId, input.eventId);
      const process = classifyProcessEvent(event, run);
      if (run.process_event_id !== null) {
        if (
          run.process_event_id === input.eventId &&
          run.exit_code === process.exitCode &&
          run.terminating_signal === process.terminatingSignal
        ) return runFromRow(run);
        throw new Error("Process facts are immutable once recorded.");
      }
      const result = this.#connection.prepare(`
        UPDATE runs
        SET exit_code = ?, terminating_signal = ?, process_event_id = ?
        WHERE id = ? AND status = 'running' AND process_event_id IS NULL
      `).run(process.exitCode, process.terminatingSignal, input.eventId, runId);
      if (result.changes !== 1) throw new Error("Process facts could not be recorded atomically.");
      return this.requireRun(runId);
    }).immediate();
  }

  reconcileRun(runId: string, input: ReconciliationInput): RunRecord {
    return this.#connection.transaction(() => {
      const run = this.requireRunRow(runId);
      if (!(["starting", "running"] as RunStatus[]).includes(run.status)) {
        throw new Error(`Run ${runId} is terminal and already reconciled.`);
      }
      if (!Number.isInteger(input.endedAt)) throw new Error("Run end time must be epoch milliseconds.");

      const preSpawn = run.status === "starting";
      if (
        preSpawn &&
        (input.providerTerminalEventId !== undefined ||
          run.process_event_id !== null ||
          run.exit_code !== null ||
          run.terminating_signal !== null)
      ) {
        throw new Error("Pre-spawn reconciliation cannot include provider or process evidence.");
      }

      const providerTerminalKind = input.providerTerminalEventId
        ? classifyProviderTerminal(this.requireEventInRun(runId, input.providerTerminalEventId), run)
        : null;
      if (run.process_event_id !== null) {
        const storedProcess = classifyProcessEvent(
          this.requireEventInRun(runId, run.process_event_id),
          run
        );
        if (
          storedProcess.exitCode !== run.exit_code ||
          storedProcess.terminatingSignal !== run.terminating_signal
        ) throw new Error("Stored process columns do not match their supporting event.");
      }
      if (input.recorderFailureEventId) {
        validateRecorderFailure(this.requireEventInRun(runId, input.recorderFailureEventId), run);
      }
      if (input.recorderCrashEventId) {
        validateRecorderCrash(this.requireEventInRun(runId, input.recorderCrashEventId), run);
      }
      if (input.interruptionEventId) {
        validateInterruption(this.requireEventInRun(runId, input.interruptionEventId), run);
      }
      if (
        preSpawn &&
        input.recorderFailureEventId === undefined &&
        input.recorderCrashEventId === undefined &&
        input.interruptionEventId === undefined
      ) {
        throw new Error("Pre-spawn reconciliation requires validated recorder terminal support.");
      }

      const supportingEventIds = [
        input.providerTerminalEventId,
        run.process_event_id,
        input.recorderFailureEventId,
        input.recorderCrashEventId,
        input.interruptionEventId
      ].filter((value): value is string => value !== undefined && value !== null);
      const uniqueSupportingEventIds = [...new Set(supportingEventIds)];
      if (uniqueSupportingEventIds.length !== supportingEventIds.length) {
        throw new Error("Each reconciliation fact requires its own exact supporting event.");
      }
      if (uniqueSupportingEventIds.length === 0) {
        throw new Error("Run reconciliation requires at least one supporting event.");
      }

      const explicitInterruption = input.interruptionEventId !== undefined;
      const decision = reconcileFacts(
        providerTerminalKind,
        run.exit_code,
        run.terminating_signal,
        input.recorderFailureEventId !== undefined,
        input.recorderCrashEventId !== undefined,
        explicitInterruption
      );
      const reconciliationEvent = traceEventV1Schema.parse({
        id: input.eventId,
        runId,
        sequence: this.nextSequence(runId),
        receivedAt: input.receivedAt,
        kind: "run.reconciled",
        status: reconciliationEventStatus(decision.status),
        provenance: "derived",
        source: { provider: run.provider, correlationId: runId },
        relationships: uniqueSupportingEventIds.map((eventId) => ({ type: "derived_from" as const, eventId })),
        summary: `Run reconciled as ${decision.status}`,
        normalizedPayload: {
          status: decision.status,
          providerTerminalKind,
          exitCode: run.exit_code,
          terminatingSignal: run.terminating_signal,
          explicitInterruption,
          recorderFailure: input.recorderFailureEventId !== undefined,
          recorderCrash: input.recorderCrashEventId !== undefined,
          terminalReason: decision.terminalReason,
          contradictionCodes: decision.contradictionCodes,
          supportingEventIds: uniqueSupportingEventIds
        },
        derivation: {
          name: "run-reconciliation",
          version: "1",
          sourceEventIds: uniqueSupportingEventIds
        }
      });

      this.validateEventRelationships(reconciliationEvent);
      this.insertEvent(reconciliationEvent, []);
      const updated = this.#connection.prepare(`
        UPDATE runs
        SET status = ?, ended_at = ?, provider_terminal_kind = ?, terminal_reason = ?,
            contradiction_codes_json = ?
        WHERE id = ? AND status = ?
      `).run(
        decision.status,
        input.endedAt,
        providerTerminalKind,
        decision.terminalReason,
        json(decision.contradictionCodes),
        runId,
        run.status
      );
      if (updated.changes !== 1) throw new Error("Run reconciliation lost its terminal write race.");
      this.#connection.prepare(`
        UPDATE run_ownership
        SET condition = 'released', updated_at = ?
        WHERE run_id = ?
      `).run(input.endedAt, runId);
      return this.requireRun(runId);
    }).immediate();
  }

  appendRecoveryForOpenEvents(runId: string, context: RecoveryContext): TraceEventV1[] {
    return this.#connection.transaction(() => {
      const events = this.readEvents(runId);
      const recoveredIds = new Set(
        events.flatMap((candidate) =>
          candidate.relationships
            .filter((relationship) => relationship.type === "recovers")
            .map((relationship) => relationship.eventId)
        )
      );
      const openEvents = events.filter((candidate) =>
        candidate.provenance === "observed" &&
        candidate.status === "in_progress" &&
        isRecoverableProviderLifecycle(candidate) &&
        !recoveredIds.has(candidate.id) &&
        !events.some((terminal) =>
          terminal.id !== candidate.id &&
          isObservedTerminalEvent(terminal) &&
          sameNativeIdentity(candidate, terminal)
        )
      );

      const appended: TraceEventV1[] = [];
      let sequence = this.nextSequence(runId);
      for (const openEvent of openEvents) {
        const recovery = traceEventV1Schema.parse({
          id: context.eventIdFor(openEvent),
          runId,
          sequence: sequence++,
          receivedAt: context.receivedAt,
          kind: "recorder.recovery",
          status: "interrupted",
          provenance: "recorder",
          source: { ...openEvent.source, eventType: "recorder.recovery" },
          relationships: [{ type: "recovers", eventId: openEvent.id }],
          summary: `Recorder recovered interrupted ${openEvent.kind}`,
          normalizedPayload: { recoveredEventId: openEvent.id, recoveredKind: openEvent.kind }
        });
        this.validateEventRelationships(recovery);
        this.insertEvent(recovery, []);
        appended.push(recovery);
      }
      return appended;
    }).immediate();
  }

  listRuns(options: { limit?: number } = {}): RunListRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const rows = this.#connection
      .prepare(`
        SELECT runs.*, git_evidence.head_changed AS git_head_changed,
          git_evidence.branch_changed AS git_branch_changed,
          run_ownership.condition AS ownership_condition
        FROM runs
        LEFT JOIN git_evidence ON git_evidence.run_id = runs.id
        LEFT JOIN run_ownership ON run_ownership.run_id = runs.id
        ORDER BY runs.started_at DESC, runs.id DESC
        LIMIT ?
      `)
      .all(limit) as RunListRow[];
    return rows.map((row) => ({
      ...runFromRow(row),
      headChanged: row.git_head_changed === null ? null : row.git_head_changed === 1,
      branchChanged: row.git_branch_changed === null ? null : row.git_branch_changed === 1,
      ownershipCondition: row.ownership_condition
    }));
  }

  getRunDetail(runId: string): RunDetail {
    const artifacts = this.#connection
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, id")
      .all(runId) as ArtifactRow[];
    const audits = this.#connection.prepare(`
      SELECT event_id, artifact_id, reason, count
      FROM redaction_audits
      WHERE run_id = ?
      ORDER BY id
    `).all(runId) as AuditRow[];
    const gitEvidenceRow = this.#connection
      .prepare("SELECT * FROM git_evidence WHERE run_id = ?")
      .get(runId) as GitEvidenceRow | undefined;
    return {
      run: this.requireRun(runId),
      ownership: this.getOwnership(runId),
      events: this.readEvents(runId),
      artifacts: artifacts.map(artifactFromRow),
      redactionAudits: audits.map((audit) => ({
        eventId: audit.event_id,
        artifactId: audit.artifact_id,
        reason: audit.reason,
        count: audit.count
      })),
      gitEvidence: gitEvidenceRow ? gitEvidenceFromRow(gitEvidenceRow) : null
    };
  }

  getOwnership(runId: string): RecorderOwnership | null {
    const row = this.#connection.prepare("SELECT * FROM run_ownership WHERE run_id = ?")
      .get(runId) as OwnershipRow | undefined;
    return row ? ownershipFromRow(row) : null;
  }

  listNonterminalOwnership(): RecorderOwnership[] {
    const rows = this.#connection.prepare(`
      SELECT run_ownership.*
      FROM run_ownership
      JOIN runs ON runs.id = run_ownership.run_id
      WHERE runs.status IN ('starting', 'running')
      ORDER BY runs.started_at, runs.id
    `).all() as OwnershipRow[];
    return rows.map(ownershipFromRow);
  }

  private validateEventRelationships(event: TraceEventV1): void {
    const targets = new Map<string, TraceEventV1>();
    for (const relationship of event.relationships) {
      const row = this.#connection
        .prepare("SELECT run_id FROM events WHERE id = ?")
        .get(relationship.eventId) as { run_id: string } | undefined;
      if (!row) throw new Error(`Relationship target ${relationship.eventId} does not exist.`);
      if (row.run_id !== event.runId) {
        throw new Error(`Relationship target ${relationship.eventId} violates same-run ownership.`);
      }
      targets.set(relationship.eventId, this.requireEventInRun(event.runId, relationship.eventId));
    }

    if (event.kind !== "recorder.recovery") return;
    if (event.provenance !== "recorder" || event.status !== "interrupted") {
      throw new Error("recorder.recovery requires recorder provenance and interrupted status.");
    }
    if (event.relationships.length !== 1 || event.relationships[0]?.type !== "recovers") {
      throw new Error("recorder.recovery requires exactly one recovers relationship.");
    }
    const targetId = event.relationships[0].eventId;
    const target = targets.get(targetId);
    if (!target || target.provenance !== "observed" || target.status !== "in_progress") {
      throw new Error("recorder.recovery must target an observed in_progress event in the same run.");
    }
    if (!recoverySourceMatches(target, event)) {
      throw new Error("recorder.recovery source identity must match the recovered event.");
    }
    const alreadyRecovered = this.#connection.prepare(`
      SELECT 1 FROM event_relationships
      WHERE run_id = ? AND related_event_id = ? AND relationship_type = 'recovers'
    `).get(event.runId, targetId);
    if (alreadyRecovered) throw new Error(`Event ${targetId} already has a recorder recovery.`);
    const hasTerminal = this.readEvents(event.runId).some((candidate) =>
      candidate.id !== target.id &&
      isObservedTerminalEvent(candidate) &&
      sameNativeIdentity(target, candidate)
    );
    if (hasTerminal) throw new Error(`Event ${targetId} already has an observed terminal event.`);
  }

  private insertEvent(event: TraceEventV1, audits: readonly RedactionAudit[]): void {
    const nativeStorage = event.nativePayload?.storage ?? null;
    this.#connection.prepare(`
      INSERT INTO events (
        id, run_id, sequence, received_at, source_occurred_at, kind, status, provenance,
        summary, normalized_payload_json, native_payload_storage, native_payload_inline_json,
        native_payload_artifact_id, native_payload_omitted_reason,
        derivation_name, derivation_version, derivation_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.runId,
      event.sequence,
      epochMilliseconds(event.receivedAt),
      event.sourceOccurredAt ? epochMilliseconds(event.sourceOccurredAt) : null,
      event.kind,
      event.status,
      event.provenance,
      event.summary,
      event.normalizedPayload === undefined ? null : json(event.normalizedPayload),
      nativeStorage,
      event.nativePayload?.storage === "inline" ? json(event.nativePayload.redacted) : null,
      event.nativePayload?.storage === "artifact" ? event.nativePayload.artifactId : null,
      event.nativePayload?.storage === "omitted" ? event.nativePayload.reason : null,
      event.derivation?.name ?? null,
      event.derivation?.version ?? null,
      event.derivation?.confidence ?? null
    );
    this.#connection.prepare(`
      INSERT INTO event_sources (
        event_id, run_id, provider, session_id, thread_id, turn_id, item_id,
        tool_id, event_type, item_type, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.runId,
      event.source.provider,
      event.source.sessionId ?? null,
      event.source.threadId ?? null,
      event.source.turnId ?? null,
      event.source.itemId ?? null,
      event.source.toolId ?? null,
      event.source.eventType ?? null,
      event.source.itemType ?? null,
      event.source.correlationId ?? null
    );
    const relationshipStatement = this.#connection.prepare(`
      INSERT INTO event_relationships (event_id, run_id, related_event_id, relationship_type)
      VALUES (?, ?, ?, ?)
    `);
    for (const relationship of event.relationships) {
      relationshipStatement.run(event.id, event.runId, relationship.eventId, relationship.type);
    }
    this.insertAudits(event.runId, event.id, null, audits, epochMilliseconds(event.receivedAt));
  }

  private insertAudits(
    runId: string,
    eventId: string | null,
    artifactId: string | null,
    audits: readonly RedactionAudit[],
    createdAt: number
  ): void {
    const statement = this.#connection.prepare(`
      INSERT INTO redaction_audits (run_id, event_id, artifact_id, reason, count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const audit of audits) {
      if (!Number.isInteger(audit.count) || audit.count <= 0) {
        throw new Error("Redaction audit counts must be positive integers.");
      }
      statement.run(runId, eventId, artifactId, audit.reason, audit.count, createdAt);
    }
  }

  private readEvents(runId: string): TraceEventV1[] {
    const eventQuery = this.schemaCapabilities.derivationIdentities
      ? `
          SELECT events.*, event_sources.provider AS source_provider,
            event_sources.session_id, event_sources.thread_id, event_sources.turn_id,
            event_sources.item_id, event_sources.tool_id, event_sources.event_type,
            event_sources.item_type, event_sources.correlation_id,
            derivation_identities.identity AS derivation_identity
          FROM events
          JOIN event_sources ON event_sources.event_id = events.id
          LEFT JOIN derivation_identities
            ON derivation_identities.run_id = events.run_id
            AND derivation_identities.derived_event_id = events.id
          WHERE events.run_id = ?
          ORDER BY events.sequence, events.id
        `
      : `
          SELECT events.*, event_sources.provider AS source_provider,
            event_sources.session_id, event_sources.thread_id, event_sources.turn_id,
            event_sources.item_id, event_sources.tool_id, event_sources.event_type,
            event_sources.item_type, event_sources.correlation_id
          FROM events
          JOIN event_sources ON event_sources.event_id = events.id
          WHERE events.run_id = ?
          ORDER BY events.sequence, events.id
        `;
    const rows = this.#connection.prepare(eventQuery).all(runId) as EventRow[];
    const relationshipRows = this.#connection.prepare(`
      SELECT relationships.event_id, relationships.relationship_type,
        relationships.related_event_id
      FROM event_relationships AS relationships
      JOIN events AS source_event ON source_event.id = relationships.event_id
      WHERE source_event.run_id = ?
      ORDER BY relationships.event_id, relationships.relationship_type,
        relationships.related_event_id
    `).all(runId) as RelationshipRow[];
    const relationshipsByEvent = new Map<string, RelationshipRow[]>();
    for (const relationship of relationshipRows) {
      const existing = relationshipsByEvent.get(relationship.event_id) ?? [];
      existing.push(relationship);
      relationshipsByEvent.set(relationship.event_id, existing);
    }

    return rows.map((row) => {
      const relationships = relationshipsByEvent.get(row.id) ?? [];
      const value: Record<string, unknown> = {
        id: row.id,
        runId: row.run_id,
        sequence: row.sequence,
        receivedAt: new Date(row.received_at).toISOString(),
        kind: row.kind,
        status: row.status,
        provenance: row.provenance,
        source: sourceFromRow(row),
        relationships: relationships.map((relationship) => ({
          type: relationship.relationship_type,
          eventId: relationship.related_event_id
        })),
        summary: row.summary
      };
      if (row.source_occurred_at !== null) {
        value.sourceOccurredAt = new Date(row.source_occurred_at).toISOString();
      }
      if (row.normalized_payload_json !== null) {
        value.normalizedPayload = JSON.parse(row.normalized_payload_json) as unknown;
      }
      if (row.native_payload_storage === "inline") {
        value.nativePayload = {
          storage: "inline",
          redacted: JSON.parse(row.native_payload_inline_json ?? "null") as unknown
        };
      } else if (row.native_payload_storage === "artifact") {
        value.nativePayload = { storage: "artifact", artifactId: row.native_payload_artifact_id };
      } else if (row.native_payload_storage === "omitted") {
        value.nativePayload = { storage: "omitted", reason: row.native_payload_omitted_reason };
      }
      if (row.derivation_name !== null && row.derivation_version !== null) {
        const sourceEventIds = relationships
          .filter((relationship) => relationship.relationship_type === "derived_from")
          .map((relationship) => relationship.related_event_id);
        value.derivation = {
          name: row.derivation_name,
          version: row.derivation_version,
          sourceEventIds,
          ...(row.derivation_confidence ? { confidence: row.derivation_confidence } : {}),
          ...(row.derivation_identity ? { identity: row.derivation_identity } : {})
        };
      }
      return traceEventV1Schema.parse(value);
    });
  }

  private validateDerivedEventInput(input: AppendDerivedEventInput): void {
    const match = /^agentlens-derivation-sha256:([0-9a-f]{64})$/.exec(input.identity);
    if (!match || input.eventId !== `drv_${match[1]}`) {
      throw new Error("Derived event ID must match its full SHA-256 derivation identity.");
    }
    if (
      input.derivation.name !== "test-command" ||
      input.derivation.version !== "1" ||
      input.derivation.identity !== input.identity
    ) {
      throw new Error("Derived event identity metadata is inconsistent.");
    }
  }

  private sourceEventOwner(
    sourceEventId: string
  ): Readonly<{ runId: string; provider: NativeSourceV1["provider"] }> | undefined {
    const row = this.#connection.prepare(`
      SELECT events.run_id, runs.provider
      FROM events
      JOIN runs ON runs.id = events.run_id
      WHERE events.id = ?
    `).get(sourceEventId) as {
      run_id: string;
      provider: NativeSourceV1["provider"];
    } | undefined;
    return row ? { runId: row.run_id, provider: row.provider } : undefined;
  }

  private validateDerivedIdentityForSource(
    runId: string,
    input: AppendDerivedEventInput
  ): void {
    const digest = createHash("sha256");
    for (const value of [
      runId,
      input.sourceEventId,
      input.derivation.name,
      input.derivation.version,
      input.kind
    ]) {
      const bytes = Buffer.from(value, "utf8");
      digest.update(`${bytes.byteLength}:`, "utf8");
      digest.update(bytes);
    }
    const expected = `agentlens-derivation-sha256:${digest.digest("hex")}`;
    if (input.identity !== expected) {
      throw new Error("Derived event identity does not match its same run source tuple.");
    }
  }

  private derivedEvent(
    input: AppendDerivedEventInput,
    runId: string,
    sequence: number
  ): TraceEventV1 {
    return traceEventV1Schema.parse({
      id: input.eventId,
      runId,
      sequence,
      receivedAt: input.receivedAt,
      kind: input.kind,
      status: input.status,
      provenance: "derived",
      source: { provider: input.sourceProvider },
      relationships: [{ type: "derived_from", eventId: input.sourceEventId }],
      summary: input.summary,
      normalizedPayload: input.normalizedPayload,
      derivation: {
        name: input.derivation.name,
        version: input.derivation.version,
        sourceEventIds: [input.sourceEventId],
        confidence: input.derivation.confidence,
        identity: input.identity
      }
    });
  }

  private resolveExistingDerivedEvent(
    runId: string,
    input: AppendDerivedEventInput
  ): TraceEventV1 | undefined {
    const byIdentity = this.#connection.prepare(`
      SELECT * FROM derivation_identities
      WHERE run_id = ? AND identity = ?
    `).get(runId, input.identity) as DerivationIdentityRow | undefined;
    const byTuple = this.#connection.prepare(`
      SELECT * FROM derivation_identities
      WHERE run_id = ? AND source_event_id = ?
        AND derivation_name = ? AND derivation_version = ? AND derived_kind = ?
    `).get(
      runId,
      input.sourceEventId,
      input.derivation.name,
      input.derivation.version,
      input.kind
    ) as DerivationIdentityRow | undefined;

    if (byIdentity && byTuple && byIdentity.derived_event_id !== byTuple.derived_event_id) {
      throw new Error("Durable derivation identity keys resolve to different events.");
    }
    const binding = byIdentity ?? byTuple;
    if (!binding) return undefined;
    if (
      binding.run_id !== runId ||
      binding.identity !== input.identity ||
      binding.source_event_id !== input.sourceEventId ||
      binding.derivation_name !== input.derivation.name ||
      binding.derivation_version !== input.derivation.version ||
      binding.derived_kind !== input.kind ||
      binding.derived_event_id !== input.eventId
    ) {
      throw new Error("Existing derived identity does not match the requested deterministic tuple.");
    }

    const stored = this.requireEventInRun(runId, binding.derived_event_id);
    const requested = this.derivedEvent(input, runId, stored.sequence);
    if (!isDeepStrictEqual(stored, requested)) {
      throw new Error("Existing derived event does not match the requested deterministic event.");
    }
    return stored;
  }

  private nextSequence(runId: string): number {
    const maximum = this.#connection
      .prepare("SELECT MAX(sequence) FROM events WHERE run_id = ?")
      .pluck()
      .get(runId) as number | null;
    return maximum === null ? 0 : maximum + 1;
  }

  private requireEventInRun(runId: string, eventId: string): TraceEventV1 {
    const event = this.readEvents(runId).find((candidate) => candidate.id === eventId);
    if (!event) throw new Error(`Event ${eventId} is not part of run ${runId}.`);
    return event;
  }

  private requireOwnership(runId: string): RecorderOwnership {
    const ownership = this.getOwnership(runId);
    if (!ownership) throw new Error(`Run ${runId} has no recorder ownership record.`);
    return ownership;
  }

  private requireRunRow(runId: string): RunRow {
    const row = this.#connection
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(runId) as RunRow | undefined;
    if (!row) throw new Error(`Run ${runId} does not exist.`);
    return row;
  }

  private requireRun(runId: string): RunRecord {
    return runFromRow(this.requireRunRow(runId));
  }
}
