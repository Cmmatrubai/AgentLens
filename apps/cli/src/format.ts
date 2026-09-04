import { TextDecoder } from "node:util";
import { codexExecCapabilities, type TraceEventV1 } from "@agentlens/core";
import type { RunSummary } from "@agentlens/derivations";
import type { RunDetail, RunListRecord, StoredArtifact } from "@agentlens/storage";

import type { OwnershipDiagnosis } from "./diagnoseOwnership.js";
import { readValidatedArtifact } from "./readArtifact.js";

export interface RunListProjection {
  readonly run: RunListRecord;
  readonly summary: RunSummary;
  readonly ownership: OwnershipDiagnosis;
}

export interface RunsJsonOutput {
  readonly runs: readonly ReturnType<typeof runListJson>[];
}

function runDurationMs(run: RunListRecord): number | null {
  return run.endedAt === null ? null : Math.max(0, run.endedAt - run.startedAt);
}

function runListJson(projection: RunListProjection) {
  const { run, summary, ownership } = projection;
  return {
    id: run.id,
    status: run.status,
    provider: run.provider,
    startedAt: new Date(run.startedAt).toISOString(),
    durationMs: runDurationMs(run),
    child: {
      exitCode: run.exitCode,
      terminatingSignal: run.terminatingSignal
    },
    git: {
      headChanged: run.headChanged,
      branchChanged: run.branchChanged
    },
    ownership: {
      condition: ownership.storedCondition,
      diagnosis: ownership.diagnosis
    },
    likelyTests: summary.likelyTests,
    assessment: summary.assessment,
    capabilities: { ...codexExecCapabilities }
  };
}

export function runsJson(runs: readonly RunListProjection[]): RunsJsonOutput {
  return { runs: runs.map(runListJson) };
}

function provenanceLabel(event: Pick<TraceEventV1, "kind" | "provenance">): string {
  if (event.kind === "recorder.recovery") return "Recorder recovery";
  switch (event.provenance) {
    case "observed":
      return "Provider";
    case "derived":
      return "Derived";
    case "git_recovered":
      return "Git recovered";
    case "recorder":
      return "Recorder";
    case "human":
      return "Human";
  }
}

function likelyTestsText(likelyTests: RunSummary["likelyTests"]): string {
  if (likelyTests.state === "detected") {
    const attributionUnavailable = likelyTests.derivationId === "test-command/2" && likelyTests.testCommandDetails.some(
      (detail) => detail.outcomeAttribution === "unavailable"
    );
    return `Test-bearing commands: latest ${likelyTests.attempts.latest}, previous failures ${likelyTests.attempts.previousFailures}${
      attributionUnavailable ? " · individual test outcome unavailable" : ""
    }`;
  }
  return likelyTests.state === "none_detected"
    ? "Test-bearing commands: none detected"
    : "Test-bearing commands: unavailable due to capture policy";
}

function assessmentText(assessment: RunSummary["assessment"]): string {
  return `Reviewer: ${assessment.verdict} (${assessment.state})`;
}

export function runsText(runs: readonly RunListProjection[]): string {
  if (runs.length === 0) return "No AgentLens runs found.\n";
  return `${runs.map(({ run, summary, ownership }) => {
    const child = run.terminatingSignal ?? (run.exitCode === null ? "pending" : `exit ${run.exitCode}`);
    const duration = runDurationMs(run);
    const git = `HEAD changed=${String(run.headChanged)} branch changed=${String(run.branchChanged)}`;
    const storedOwnership = ownership.storedCondition ?? "unavailable";
    const diagnosis = ownership.diagnosis === storedOwnership
      ? ownership.diagnosis
      : `${storedOwnership}/${ownership.diagnosis}`;
    return `${run.id}  ${run.status}  ${run.provider}  ${new Date(run.startedAt).toISOString()}  duration=${duration === null ? "null" : `${duration}ms`}  ${child}  ownership=${diagnosis}  ${git}  ${likelyTestsText(summary.likelyTests)}  ${assessmentText(summary.assessment)}`;
  }).join("\n")}\n`;
}

function gitWarnings(git: RunDetail["gitEvidence"]) {
  if (git === null) return [];
  const warnings: Array<{
    code: "git_head_changed" | "git_branch_changed";
    message: string;
    oldValue: string | null;
    newValue: string | null;
  }> = [];
  if (git.headChanged) {
    warnings.push({
      code: "git_head_changed",
      message: "Git HEAD changed during the run.",
      oldValue: git.initialHead,
      newValue: git.finalHead
    });
  }
  if (git.branchChanged) {
    warnings.push({
      code: "git_branch_changed",
      message: "Git branch changed during the run.",
      oldValue: git.initialBranch,
      newValue: git.finalBranch
    });
  }
  return warnings;
}

function metadataSemantics(run: RunDetail["run"]) {
  return {
    agentVersion: run.agentVersion === "unknown"
      ? {
          value: run.agentVersion,
          availability: "unavailable" as const,
          reason: "Codex exec JSONL does not expose the agent version in v0.1."
        }
      : {
          value: run.agentVersion,
          availability: "reported" as const
        },
    promptSource: {
      value: run.promptSource ?? null,
      meaning: "prompt/stdin transport mode" as const,
      semanticPromptLocation: false as const,
      promptParsedOrAltered: false as const
    }
  };
}

function inspectGitEvidence(git: RunDetail["gitEvidence"]) {
  const shared = {
    terminology: {
      trackedFinalDiff: "tracked final diff" as const,
      untrackedMetadata: "untracked-file metadata" as const
    },
    provenance: "git_recovered" as const
  };
  if (git === null) {
    return {
      ...shared,
      available: false as const,
      initialHead: null,
      finalHead: null,
      initialBranch: null,
      finalBranch: null,
      headChanged: null,
      branchChanged: null,
      trackedFinalDiffAvailability: "unavailable" as const,
      untrackedMetadataAvailability: "unavailable" as const
    };
  }
  return {
    ...shared,
    available: true as const,
    initialHead: git.initialHead,
    finalHead: git.finalHead,
    initialBranch: git.initialBranch,
    finalBranch: git.finalBranch,
    headChanged: git.headChanged,
    branchChanged: git.branchChanged,
    trackedFinalDiffAvailability: git.trackedFinalDiff.state,
    untrackedMetadataAvailability: git.untrackedMetadata.state,
    initialStatus: git.initialStatus,
    finalStatus: git.finalStatus,
    trackedFinalDiff: git.trackedFinalDiff,
    diffCheck: git.diffCheck,
    diffCheckPassed: git.diffCheckPassed,
    untrackedMetadata: git.untrackedMetadata
  };
}

async function readValidatedNativeArtifact(
  artifact: StoredArtifact,
  artifactRoot: string
): Promise<unknown> {
  const read = await readValidatedArtifact(artifact, artifactRoot, {
    expectedKind: "native-payload",
    expectedMediaType: "application/json",
    requireComplete: false
  });
  if (read.truncated) {
    return Object.freeze({
      state: "truncated" as const,
      truncated: true as const,
      storedByteLength: read.storedByteLength,
      originalByteLength: read.originalByteLength
    });
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
  } catch {
    throw new Error("Native artifact has invalid UTF-8.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Native artifact has invalid JSON.");
  }
}

export type InspectNativePayloadDto =
  | Readonly<{ storage: "inline"; contentAvailable: boolean; reason?: string }>
  | Readonly<{
      storage: "artifact";
      artifactId: string;
      contentAvailable: boolean;
      reason?: string;
    }>
  | Readonly<{ storage: "omitted"; contentAvailable: false; reason: string }>;

export interface InspectEventDto {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly receivedAt: string;
  readonly sourceOccurredAt?: string;
  readonly kind: TraceEventV1["kind"];
  readonly status: TraceEventV1["status"];
  readonly provenance: TraceEventV1["provenance"];
  readonly source: TraceEventV1["source"];
  readonly relationships: TraceEventV1["relationships"];
  readonly summary: string;
  readonly normalizedPayload?: unknown;
  readonly derivation?: NonNullable<TraceEventV1["derivation"]>;
  readonly nativePayload?: InspectNativePayloadDto;
  readonly nativeContent?: unknown;
}

function projectEventBase(event: TraceEventV1): Omit<InspectEventDto, "nativePayload" | "nativeContent"> {
  const source = {
    provider: event.source.provider,
    ...(event.source.sessionId === undefined ? {} : { sessionId: event.source.sessionId }),
    ...(event.source.threadId === undefined ? {} : { threadId: event.source.threadId }),
    ...(event.source.turnId === undefined ? {} : { turnId: event.source.turnId }),
    ...(event.source.itemId === undefined ? {} : { itemId: event.source.itemId }),
    ...(event.source.toolId === undefined ? {} : { toolId: event.source.toolId }),
    ...(event.source.eventType === undefined ? {} : { eventType: event.source.eventType }),
    ...(event.source.itemType === undefined ? {} : { itemType: event.source.itemType }),
    ...(event.source.correlationId === undefined ? {} : { correlationId: event.source.correlationId })
  };
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    receivedAt: event.receivedAt,
    ...(event.sourceOccurredAt === undefined ? {} : { sourceOccurredAt: event.sourceOccurredAt }),
    kind: event.kind,
    status: event.status,
    provenance: event.provenance,
    source,
    relationships: event.relationships.map(({ type, eventId }) => ({ type, eventId })),
    summary: event.summary,
    ...(event.normalizedPayload === undefined
      ? {}
      : { normalizedPayload: event.normalizedPayload }),
    ...(event.derivation === undefined
      ? {}
      : {
          derivation: {
            name: event.derivation.name,
            version: event.derivation.version,
            sourceEventIds: [...event.derivation.sourceEventIds],
            ...(event.derivation.identity === undefined
              ? {}
              : { identity: event.derivation.identity }),
            ...(event.derivation.confidence === undefined
              ? {}
              : { confidence: event.derivation.confidence })
          }
        })
  };
}

function projectedNativeMetadata(
  event: TraceEventV1,
  capturePolicy: RunDetail["run"]["capturePolicy"]
): InspectNativePayloadDto | undefined {
  const stored = event.nativePayload;
  if (stored === undefined) return undefined;
  if (stored.storage === "omitted") {
    return { storage: "omitted", contentAvailable: false, reason: stored.reason };
  }
  if (capturePolicy !== "standard") {
    return stored.storage === "inline"
      ? { storage: "inline", contentAvailable: false, reason: capturePolicy }
      : {
          storage: "artifact",
          artifactId: stored.artifactId,
          contentAvailable: false,
          reason: capturePolicy
        };
  }
  return stored.storage === "inline"
    ? { storage: "inline", contentAvailable: true }
    : { storage: "artifact", artifactId: stored.artifactId, contentAvailable: true };
}

async function projectInspectEvent(
  event: TraceEventV1,
  native: boolean,
  capturePolicy: RunDetail["run"]["capturePolicy"],
  artifacts: ReadonlyMap<string, StoredArtifact>,
  artifactRoot?: string
): Promise<InspectEventDto> {
  const projected = projectEventBase(event);
  const stored = event.nativePayload;
  const nativePayload = projectedNativeMetadata(event, capturePolicy);
  if (nativePayload === undefined || stored === undefined) return projected;
  if (!native || capturePolicy !== "standard" || stored.storage === "omitted") {
    return { ...projected, nativePayload };
  }
  if (stored.storage === "inline") {
    return { ...projected, nativePayload, nativeContent: stored.redacted };
  }
  const artifact = artifacts.get(stored.artifactId);
  if (!artifact) throw new Error(`Native artifact ${stored.artifactId} is unavailable.`);
  if (!artifactRoot) throw new Error("Native artifact root is required for expansion.");
  return {
    ...projected,
    nativePayload,
    nativeContent: await readValidatedNativeArtifact(artifact, artifactRoot)
  };
}

function projectRun(run: RunDetail["run"]) {
  return {
    id: run.id,
    schemaVersion: run.schemaVersion,
    provider: run.provider,
    integrationVersion: run.integrationVersion,
    agentVersion: run.agentVersion,
    status: run.status,
    capturePolicy: run.capturePolicy,
    capturePolicyVersion: run.capturePolicyVersion,
    redactionVersion: run.redactionVersion,
    repositoryFingerprint: run.repositoryFingerprint,
    repositoryDisplay: run.repositoryDisplay,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    childPid: run.childPid,
    exitCode: run.exitCode,
    terminatingSignal: run.terminatingSignal,
    providerTerminalKind: run.providerTerminalKind,
    terminalReason: run.terminalReason,
    contradictionCodes: [...run.contradictionCodes],
    ...(run.label === undefined ? {} : { label: run.label }),
    ...(run.promptSource === undefined ? {} : { promptSource: run.promptSource })
  };
}

function projectOwnership(
  ownership: RunDetail["ownership"],
  diagnosis: OwnershipDiagnosis
) {
  if (ownership === null) return null;
  return {
    runId: ownership.runId,
    recorderInstanceId: ownership.recorderInstanceId,
    recorderPid: ownership.recorderPid,
    recorderStartToken: ownership.recorderStartToken,
    childPid: ownership.childPid,
    childStartToken: ownership.childStartToken,
    childProcessGroupId: ownership.childProcessGroupId,
    heartbeatAt: ownership.heartbeatAt,
    condition: ownership.condition,
    diagnosis: diagnosis.diagnosis,
    ownershipLostEventId: ownership.ownershipLostEventId,
    updatedAt: ownership.updatedAt
  };
}

function projectArtifact(artifact: StoredArtifact) {
  return {
    id: artifact.id,
    runId: artifact.runId,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    path: artifact.path,
    sha256: artifact.sha256,
    byteLength: artifact.byteLength,
    redactionState: artifact.redactionState,
    truncated: artifact.truncated,
    originalByteLength: artifact.originalByteLength,
    createdAt: artifact.createdAt
  };
}

export interface InspectJsonOutput {
  readonly run: ReturnType<typeof projectRun>;
  readonly ownership: ReturnType<typeof projectOwnership>;
  readonly ownershipDiagnosis: OwnershipDiagnosis;
  readonly metadataSemantics: ReturnType<typeof metadataSemantics>;
  readonly capabilities: typeof codexExecCapabilities;
  readonly contradictions: readonly string[];
  readonly warnings: ReturnType<typeof gitWarnings>;
  readonly events: readonly InspectEventDto[];
  readonly gitEvidence: ReturnType<typeof inspectGitEvidence>;
  readonly artifacts: readonly ReturnType<typeof projectArtifact>[];
  readonly redactionAudits: RunDetail["redactionAudits"];
  readonly summary: RunSummary;
  readonly reviewerNote: ReviewerNoteDto;
}

export type ReviewerNoteDto =
  | Readonly<{ state: "absent"; contentAvailable: false }>
  | Readonly<{
      state: "artifact";
      artifactId: string;
      contentAvailable: true;
      content: string;
    }>
  | Readonly<{
      state: "omitted";
      contentAvailable: false;
      reason: "metadata-only" | "strict";
    }>;

export interface InspectProjection {
  readonly summary: RunSummary;
  readonly ownership: OwnershipDiagnosis;
  readonly reviewerNote: ReviewerNoteDto;
}

export async function inspectJson(
  detail: RunDetail,
  native: boolean,
  artifactRoot: string | undefined,
  projection: InspectProjection
): Promise<InspectJsonOutput> {
  const artifacts = new Map(detail.artifacts.map((artifact) => [artifact.id, artifact]));
  const events = await Promise.all(detail.events.map((event) =>
    projectInspectEvent(event, native, detail.run.capturePolicy, artifacts, artifactRoot)
  ));
  const git = detail.gitEvidence;
  return {
    run: projectRun(detail.run),
    ownership: projectOwnership(detail.ownership, projection.ownership),
    ownershipDiagnosis: projection.ownership,
    metadataSemantics: metadataSemantics(detail.run),
    capabilities: { ...codexExecCapabilities },
    contradictions: [...detail.run.contradictionCodes],
    warnings: gitWarnings(git),
    events,
    gitEvidence: inspectGitEvidence(git),
    artifacts: detail.artifacts.map(projectArtifact),
    redactionAudits: detail.redactionAudits.map(({ eventId, artifactId, reason, count }) => ({
      eventId,
      artifactId,
      reason,
      count
    })),
    summary: projection.summary,
    reviewerNote: projection.reviewerNote
  };
}

export function inspectText(
  detail: RunDetail,
  events: readonly InspectEventDto[],
  projection: InspectProjection
): string {
  const git = detail.gitEvidence;
  const warnings = gitWarnings(git);
  const semantics = metadataSemantics(detail.run);
  const lines = [
    `Run ${detail.run.id}`,
    `Status: ${detail.run.status}`,
    `Provider: ${detail.run.provider}`,
    `Child: exit=${String(detail.run.exitCode)} signal=${String(detail.run.terminatingSignal)}`,
    `Ownership: ${detail.ownership?.condition ?? "unavailable"} (diagnosis=${projection.ownership.diagnosis})`,
    `Contradictions: ${detail.run.contradictionCodes.join(", ") || "none"}`,
    "Git terminology: tracked final diff + untracked-file metadata",
    `Git evidence: ${git === null ? "unavailable" : `HEAD changed=${git.headChanged}, branch changed=${git.branchChanged}`}`
  ];
  lines.push(
    git === null
      ? "Git initial: HEAD=unavailable branch=unavailable"
      : `Git initial: HEAD=${git.initialHead} branch=${String(git.initialBranch)}`,
    git === null
      ? "Git final: HEAD=unavailable branch=unavailable"
      : `Git final: HEAD=${git.finalHead} branch=${String(git.finalBranch)}`,
    git === null
      ? "Git evidence availability: tracked final diff=unavailable; untracked-file metadata=unavailable"
      : `Git evidence availability: tracked final diff=${git.trackedFinalDiff.state}; untracked-file metadata=${git.untrackedMetadata.state}`
  );
  for (const warning of warnings) {
    lines.push(
      `WARNING: ${warning.message.replace(/\.$/, "")}: ${String(warning.oldValue)} -> ${String(warning.newValue)}`
    );
  }
  lines.push(
    semantics.agentVersion.availability === "unavailable"
      ? `Agent version: ${semantics.agentVersion.value} (unavailable: ${semantics.agentVersion.reason})`
      : `Agent version: ${semantics.agentVersion.value} (reported)`,
    `Prompt source: ${String(semantics.promptSource.value)} (${semantics.promptSource.meaning}; semantic prompt location=${String(semantics.promptSource.semanticPromptLocation)}; prompt parsed or altered=${String(semantics.promptSource.promptParsedOrAltered)})`
  );
  lines.push(
    likelyTestsText(projection.summary.likelyTests),
    assessmentText(projection.summary.assessment),
    projection.reviewerNote.state === "artifact"
      ? `Reviewer note: ${projection.reviewerNote.content}`
      : projection.reviewerNote.state === "omitted"
        ? `Reviewer note: omitted (${projection.reviewerNote.reason})`
        : "Reviewer note: absent"
  );
  lines.push(
    "Capabilities: file reads unavailable; tool output partial; tool durations unavailable; interruption signal partial",
    "Events:"
  );
  for (const event of events) {
    lines.push(
      `${event.sequence} [${provenanceLabel(event)}] ${event.kind} ${event.status} — ${event.summary}`,
      `  source: provider=${event.source.provider} sessionId=${event.source.sessionId ?? "none"} threadId=${event.source.threadId ?? "none"} turnId=${event.source.turnId ?? "none"} itemId=${event.source.itemId ?? "none"} toolId=${event.source.toolId ?? "none"} eventType=${event.source.eventType ?? "none"} itemType=${event.source.itemType ?? "none"} correlationId=${event.source.correlationId ?? "none"}`,
      `  relationships: ${event.relationships.length === 0
        ? "none"
        : event.relationships.map(({ type, eventId }) => `${type}:${eventId}`).join(", ")}`
    );
    if (event.nativeContent !== undefined) {
      lines.push(`  native: ${JSON.stringify(event.nativeContent)}`);
    }
    if (event.nativePayload !== undefined) {
      const artifactId = event.nativePayload.storage === "artifact"
        ? ` artifactId=${event.nativePayload.artifactId}`
        : "";
      const reason = event.nativePayload.reason === undefined
        ? ""
        : ` reason=${event.nativePayload.reason}`;
      lines.push(
        `  native payload: storage=${event.nativePayload.storage}${artifactId} contentAvailable=${String(event.nativePayload.contentAvailable)}${reason}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
