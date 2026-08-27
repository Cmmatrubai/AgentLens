import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  traceEventV1Schema,
  type CapturePolicy,
  type CompletedArtifact,
  type NativeSourceV1,
  type RedactionAudit,
  type RunStatus,
  type TraceEventV1
} from "@agentlens/core";
import type { AgentLensDatabase } from "./database.js";

type ProviderTerminalKind = "completed" | "failed";

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
  exitCode: number | null;
  terminatingSignal: string | null;
  eventId: string;
}

export interface ReconciliationInput {
  eventId: string;
  receivedAt: string;
  endedAt: number;
  providerTerminalKind: ProviderTerminalKind | null;
  providerTerminalEventId?: string;
  recorderFailureEventId?: string;
  explicitInterruption: boolean;
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
  initialStatusArtifactId: string | null;
  finalStatusArtifactId: string | null;
  trackedFinalDiffArtifactId: string | null;
  diffCheckArtifactId: string | null;
  diffCheckPassed: boolean;
  untrackedMetadataArtifactId: string | null;
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

export interface StoredGitEvidence extends GitEvidenceInput {
  runId: string;
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
  initial_status_artifact_id: string | null;
  final_status_artifact_id: string | null;
  tracked_final_diff_artifact_id: string | null;
  diff_check_artifact_id: string | null;
  diff_check_passed: number;
  untracked_metadata_artifact_id: string | null;
  head_changed: number;
  branch_changed: number;
  captured_at: number;
}

interface ReconciliationDecision {
  status: Exclude<RunStatus, "starting" | "running">;
  terminalReason: string;
  contradictionCodes: string[];
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
    initialStatusArtifactId: row.initial_status_artifact_id,
    finalStatusArtifactId: row.final_status_artifact_id,
    trackedFinalDiffArtifactId: row.tracked_final_diff_artifact_id,
    diffCheckArtifactId: row.diff_check_artifact_id,
    diffCheckPassed: row.diff_check_passed === 1,
    untrackedMetadataArtifactId: row.untracked_metadata_artifact_id,
    headChanged: row.head_changed === 1,
    branchChanged: row.branch_changed === 1,
    capturedAt: row.captured_at
  };
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
  const identityKeys: readonly (keyof NativeSourceV1)[] = [
    "itemId",
    "toolId",
    "correlationId",
    "turnId",
    "threadId",
    "sessionId"
  ];
  const mostSpecific = identityKeys.find((key) => started.source[key] !== undefined);
  if (!mostSpecific) return false;
  return started.source[mostSpecific] === candidate.source[mostSpecific];
}

export class RunRepository {
  readonly database: AgentLensDatabase;

  constructor(database: AgentLensDatabase) {
    this.database = database;
  }

  createRun(input: CreateRunInput): RunRecord {
    this.database.connection.prepare(`
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
    const result = this.database.connection
      .prepare("UPDATE runs SET status = 'running', child_pid = ? WHERE id = ? AND status = 'starting'")
      .run(input.childPid, runId);
    if (result.changes !== 1) throw new Error(`Run ${runId} is not in starting status.`);
    return this.requireRun(runId);
  }

  appendEvent(input: TraceEventV1, audits: readonly RedactionAudit[] = []): TraceEventV1 {
    const event = traceEventV1Schema.parse(input);
    this.database.connection.transaction(() => this.insertEvent(event, audits))();
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

    let artifactStat;
    let bytes;
    try {
      artifactStat = await stat(input.path);
      bytes = await readFile(input.path);
    } catch (error) {
      throw new Error(`Completed artifact is not available at ${input.path}.`, { cause: error });
    }
    if (!artifactStat.isFile() || artifactStat.size !== input.byteLength || bytes.byteLength !== input.byteLength) {
      throw new Error("Completed artifact byte length does not match metadata.");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== input.sha256) throw new Error("Completed artifact digest does not match metadata.");

    this.database.connection.transaction(() => {
      this.database.connection.prepare(`
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
  }

  saveGitEvidence(runId: string, input: GitEvidenceInput): StoredGitEvidence {
    this.database.connection.prepare(`
      INSERT INTO git_evidence (
        run_id, initial_head, final_head, initial_branch, final_branch,
        initial_status_artifact_id, final_status_artifact_id,
        tracked_final_diff_artifact_id, diff_check_artifact_id, diff_check_passed,
        untracked_metadata_artifact_id, head_changed, branch_changed, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId, input.initialHead, input.finalHead, input.initialBranch, input.finalBranch,
      input.initialStatusArtifactId, input.finalStatusArtifactId,
      input.trackedFinalDiffArtifactId, input.diffCheckArtifactId,
      input.diffCheckPassed ? 1 : 0, input.untrackedMetadataArtifactId,
      input.headChanged ? 1 : 0, input.branchChanged ? 1 : 0, input.capturedAt
    );
    return { runId, ...input };
  }

  recordProcessFact(runId: string, input: ProcessFactInput): RunRecord {
    const supportingEvent = this.database.connection
      .prepare("SELECT run_id, kind FROM events WHERE id = ?")
      .get(input.eventId) as { run_id: string; kind: string } | undefined;
    if (!supportingEvent || supportingEvent.run_id !== runId || supportingEvent.kind !== "recorder.process_exit") {
      throw new Error("Process facts require a recorder.process_exit event from the same run.");
    }
    if (input.exitCode !== null && !Number.isInteger(input.exitCode)) {
      throw new Error("Process exit code must be a numeric integer or null.");
    }
    this.database.connection.prepare(`
      UPDATE runs
      SET exit_code = ?, terminating_signal = ?, process_event_id = ?
      WHERE id = ?
    `).run(input.exitCode, input.terminatingSignal, input.eventId, runId);
    return this.requireRun(runId);
  }

  reconcileRun(runId: string, input: ReconciliationInput): RunRecord {
    const run = this.requireRunRow(runId);
    if (input.providerTerminalKind !== null && !input.providerTerminalEventId) {
      throw new Error("Provider terminal facts require a supporting event ID.");
    }
    if (input.providerTerminalKind === null && input.providerTerminalEventId) {
      throw new Error("A provider terminal event ID requires a provider terminal fact.");
    }

    const supportingEventIds = [
      input.providerTerminalEventId,
      run.process_event_id,
      input.recorderFailureEventId
    ].filter((value): value is string => value !== undefined && value !== null);
    const uniqueSupportingEventIds = [...new Set(supportingEventIds)];
    if (uniqueSupportingEventIds.length === 0) {
      throw new Error("Run reconciliation requires at least one supporting event.");
    }
    for (const eventId of uniqueSupportingEventIds) this.requireEventInRun(runId, eventId);

    if (input.providerTerminalEventId) {
      const providerEvent = this.requireEventInRun(runId, input.providerTerminalEventId);
      if (providerEvent.status !== input.providerTerminalKind) {
        throw new Error("Provider terminal fact does not match its supporting event status.");
      }
    }

    const decision = reconcileFacts(
      input.providerTerminalKind,
      run.exit_code,
      run.terminating_signal,
      input.recorderFailureEventId !== undefined,
      input.explicitInterruption
    );
    const nextSequence = this.nextSequence(runId);
    const reconciliationEvent = traceEventV1Schema.parse({
      id: input.eventId,
      runId,
      sequence: nextSequence,
      receivedAt: input.receivedAt,
      kind: "run.reconciled",
      status: decision.status === "completed" ? "completed" : "failed",
      provenance: "derived",
      source: { provider: run.provider, correlationId: runId },
      relationships: uniqueSupportingEventIds.map((eventId) => ({ type: "derived_from" as const, eventId })),
      summary: `Run reconciled as ${decision.status}`,
      normalizedPayload: {
        status: decision.status,
        providerTerminalKind: input.providerTerminalKind,
        exitCode: run.exit_code,
        terminatingSignal: run.terminating_signal,
        explicitInterruption: input.explicitInterruption,
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

    this.database.connection.transaction(() => {
      this.insertEvent(reconciliationEvent, []);
      this.database.connection.prepare(`
        UPDATE runs
        SET status = ?, ended_at = ?, provider_terminal_kind = ?, terminal_reason = ?,
            contradiction_codes_json = ?
        WHERE id = ?
      `).run(
        decision.status,
        input.endedAt,
        input.providerTerminalKind,
        decision.terminalReason,
        json(decision.contradictionCodes),
        runId
      );
    })();
    return this.requireRun(runId);
  }

  appendRecoveryForOpenEvents(runId: string, context: RecoveryContext): TraceEventV1[] {
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
      !recoveredIds.has(candidate.id) &&
      !events.some((terminal) =>
        terminal.id !== candidate.id &&
        terminal.provenance === "observed" &&
        terminal.status !== "in_progress" &&
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
      this.appendEvent(recovery);
      appended.push(recovery);
    }
    return appended;
  }

  listRuns(options: { limit?: number } = {}): RunListRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const rows = this.database.connection
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
    const artifacts = this.database.connection
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, id")
      .all(runId) as ArtifactRow[];
    const audits = this.database.connection.prepare(`
      SELECT event_id, artifact_id, reason, count
      FROM redaction_audits
      WHERE run_id = ?
      ORDER BY id
    `).all(runId) as AuditRow[];
    const gitEvidenceRow = this.database.connection
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

  private insertEvent(event: TraceEventV1, audits: readonly RedactionAudit[]): void {
    const nativeStorage = event.nativePayload?.storage ?? null;
    this.database.connection.prepare(`
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
    this.database.connection.prepare(`
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
    const relationshipStatement = this.database.connection.prepare(`
      INSERT INTO event_relationships (event_id, related_event_id, relationship_type)
      VALUES (?, ?, ?)
    `);
    for (const relationship of event.relationships) {
      relationshipStatement.run(event.id, relationship.eventId, relationship.type);
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
    const statement = this.database.connection.prepare(`
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
    const rows = this.database.connection.prepare(`
      SELECT events.*, event_sources.provider AS source_provider,
        event_sources.session_id, event_sources.thread_id, event_sources.turn_id,
        event_sources.item_id, event_sources.tool_id, event_sources.event_type,
        event_sources.item_type, event_sources.correlation_id
      FROM events
      JOIN event_sources ON event_sources.event_id = events.id
      WHERE events.run_id = ?
      ORDER BY events.sequence, events.id
    `).all(runId) as EventRow[];
    const relationshipStatement = this.database.connection.prepare(`
      SELECT relationship_type, related_event_id
      FROM event_relationships
      WHERE event_id = ?
      ORDER BY relationship_type, related_event_id
    `);

    return rows.map((row) => {
      const relationships = relationshipStatement.all(row.id) as RelationshipRow[];
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
    const maximum = this.database.connection
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
    const row = this.database.connection
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(runId) as RunRow | undefined;
    if (!row) throw new Error(`Run ${runId} does not exist.`);
    return row;
  }

  private requireRun(runId: string): RunRecord {
    return runFromRow(this.requireRunRow(runId));
  }
}
