import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
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

export interface MarkRunningInput {
  childPid: number;
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
  interruptionEventId?: string;
}

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

export interface RunDetail {
  run: RunRecord;
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

interface RunListRow extends RunRow {
  git_head_changed: number | null;
  git_branch_changed: number | null;
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

function reconcileFacts(
  provider: ProviderTerminalKind | null,
  exitCode: number | null,
  signal: string | null,
  recorderFailure: boolean,
  explicitInterruption: boolean
): ReconciliationDecision {
  const contradictionCodes: string[] = [];
  const interrupted = signal !== null || explicitInterruption;

  if (provider === "completed" && recorderFailure) {
    contradictionCodes.push("provider_completed_but_recorder_failed");
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
  return event.provenance === "observed" &&
    (event.status === "completed" || event.status === "failed" || event.status === "interrupted");
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

export class RunRepository {
  readonly #connection: Database.Database;
  readonly #artifactRoot: string;

  constructor(database: AgentLensDatabase, options: RunRepositoryOptions) {
    this.#connection = connectionFor(database);
    if (!options || !isAbsolute(options.artifactRoot)) {
      throw new Error("RunRepository requires an absolute configured artifact root.");
    }
    this.#artifactRoot = resolve(options.artifactRoot);
  }

  createRun(input: CreateRunInput): RunRecord {
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
    return this.requireRun(input.id);
  }

  markRunning(runId: string, input: MarkRunningInput): RunRecord {
    if (!Number.isInteger(input.childPid) || input.childPid <= 0) {
      throw new Error("childPid must be a positive integer.");
    }
    const result = this.#connection
      .prepare("UPDATE runs SET status = 'running', child_pid = ? WHERE id = ? AND status = 'starting'")
      .run(input.childPid, runId);
    if (result.changes !== 1) throw new Error(`Run ${runId} is not in starting status.`);
    return this.requireRun(runId);
  }

  appendEvent(input: TraceEventV1, audits: readonly RedactionAudit[] = []): TraceEventV1 {
    const event = traceEventV1Schema.parse(input);
    this.#connection.transaction(() => {
      this.validateEventRelationships(event);
      this.insertEvent(event, audits);
    }).immediate();
    return event;
  }

  async commitArtifactMetadata(
    input: CompletedArtifact,
    audits: readonly RedactionAudit[] = [],
    createdAt = Date.now()
  ): Promise<StoredArtifact> {
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

    let handle;
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

      this.#connection.transaction(() => {
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
      })();
      return { ...input, createdAt };
    } finally {
      await handle.close();
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
      if (input.interruptionEventId) {
        validateInterruption(this.requireEventInRun(runId, input.interruptionEventId), run);
      }
      if (
        preSpawn &&
        input.recorderFailureEventId === undefined &&
        input.interruptionEventId === undefined
      ) {
        throw new Error("Pre-spawn reconciliation requires validated recorder terminal support.");
      }

      const supportingEventIds = [
        input.providerTerminalEventId,
        run.process_event_id,
        input.recorderFailureEventId,
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
          git_evidence.branch_changed AS git_branch_changed
        FROM runs
        LEFT JOIN git_evidence ON git_evidence.run_id = runs.id
        ORDER BY runs.started_at DESC, runs.id DESC
        LIMIT ?
      `)
      .all(limit) as RunListRow[];
    return rows.map((row) => ({
      ...runFromRow(row),
      headChanged: row.git_head_changed === null ? null : row.git_head_changed === 1,
      branchChanged: row.git_branch_changed === null ? null : row.git_branch_changed === 1
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
    const rows = this.#connection.prepare(`
      SELECT events.*, event_sources.provider AS source_provider,
        event_sources.session_id, event_sources.thread_id, event_sources.turn_id,
        event_sources.item_id, event_sources.tool_id, event_sources.event_type,
        event_sources.item_type, event_sources.correlation_id
      FROM events
      JOIN event_sources ON event_sources.event_id = events.id
      WHERE events.run_id = ?
      ORDER BY events.sequence, events.id
    `).all(runId) as EventRow[];
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
          ...(row.derivation_confidence ? { confidence: row.derivation_confidence } : {})
        };
      }
      return traceEventV1Schema.parse(value);
    });
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
