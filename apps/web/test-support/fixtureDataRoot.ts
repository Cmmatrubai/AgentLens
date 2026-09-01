import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompletedArtifact, TraceEventV1 } from "../../../packages/core/src/index.js";
import { buildTestDerivationDrafts } from "../../../packages/derivations/src/index.js";
import {
  RunRepository,
  openDatabase,
  type CreateRunInput
} from "../../../packages/storage/src/index.js";

const baseTime = Date.UTC(2026, 7, 31, 15, 30, 0);

function runInput(input: Readonly<{
  id: string;
  startedAt: number;
  label: string;
  capturePolicy?: "standard" | "metadata-only" | "strict";
  repositoryFingerprint?: string;
  repositoryDisplay?: string;
}>): CreateRunInput {
  return {
    id: input.id,
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "fixture",
    capturePolicy: input.capturePolicy ?? "standard",
    capturePolicyVersion: "1",
    redactionVersion: "1",
    label: input.label,
    repositoryFingerprint: input.repositoryFingerprint ?? "repo-agentlens-demo",
    repositoryDisplay: input.repositoryDisplay ?? "AgentLens local fixture",
    startedAt: input.startedAt
  };
}

function observedEvent(input: Readonly<{
  runId: string;
  id: string;
  sequence: number;
  kind: string;
  status: TraceEventV1["status"];
  summary: string;
  normalizedPayload?: Record<string, unknown>;
  nativePayload?: TraceEventV1["nativePayload"];
  provenance?: TraceEventV1["provenance"];
  source?: TraceEventV1["source"];
}>): TraceEventV1 {
  return {
    id: input.id,
    runId: input.runId,
    sequence: input.sequence,
    receivedAt: new Date(baseTime + input.sequence * 1_000).toISOString(),
    kind: input.kind,
    status: input.status,
    provenance: input.provenance ?? "observed",
    source: input.source ?? {
      provider: "codex-exec",
      itemId: input.id,
      eventType: input.kind === "command"
        ? input.status === "failed" ? "item.failed" : "item.completed"
        : input.kind,
      ...(input.kind === "command" ? { itemType: "command_execution" } : {})
    },
    relationships: [],
    summary: input.summary,
    ...(input.normalizedPayload === undefined ? {} : { normalizedPayload: input.normalizedPayload }),
    ...(input.nativePayload === undefined ? {} : { nativePayload: input.nativePayload })
  };
}

async function completedArtifact(
  artifactRoot: string,
  runId: string,
  kind: string,
  mediaType: string,
  content: string
): Promise<CompletedArtifact> {
  const bytes = Buffer.from(content, "utf8");
  const id = createHash("sha256").update(bytes).digest("hex");
  const directory = join(artifactRoot, id.slice(0, 2));
  const path = join(directory, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  return {
    id,
    runId,
    kind,
    mediaType,
    path,
    sha256: id,
    byteLength: bytes.byteLength,
    redactionState: "redacted",
    truncated: false,
    originalByteLength: bytes.byteLength
  };
}

function appendTestDerivations(
  repository: RunRepository,
  input: Readonly<{
    runId: string;
    sourceEventId: string;
    sourceStatus: "completed" | "failed";
    exitCode: number | null;
    sequence: number;
  }>
): number {
  const drafts = buildTestDerivationDrafts({
    runId: input.runId,
    sourceEventId: input.sourceEventId,
    sourceProvider: "codex-exec",
    eventStatus: input.sourceStatus,
    exitCode: input.exitCode,
    classification: {
      family: "vitest",
      confidence: "high",
      derivationVersion: "test-command/1"
    }
  });
  drafts.forEach((draft, offset) => repository.appendEvent({
    ...draft,
    sequence: input.sequence + offset,
    receivedAt: new Date(baseTime + (input.sequence + offset) * 1_000).toISOString()
  }));
  return input.sequence + drafts.length;
}

function finishRun(
  repository: RunRepository,
  input: Readonly<{
    runId: string;
    recorderInstanceId: string;
    sequence: number;
    exitCode: number | null;
    signal: string | null;
    providerCompleted: boolean;
  }>
): void {
  repository.markRunning(input.runId, {
    recorderInstanceId: input.recorderInstanceId,
    childPid: 91_000 + input.sequence,
    childStartToken: `child-${input.runId}`,
    childProcessGroupId: 91_000 + input.sequence,
    updatedAt: baseTime + input.sequence * 1_000
  });
  const processEventId = `${input.runId}-process-exit`;
  repository.appendEvent(observedEvent({
    runId: input.runId,
    id: processEventId,
    sequence: input.sequence,
    kind: "recorder.process_exit",
    status: input.signal === null
      ? input.exitCode === 0 ? "completed" : "failed"
      : "interrupted",
    provenance: "recorder",
    source: { provider: "codex-exec", correlationId: input.runId },
    summary: input.signal === null ? `Child process exited ${input.exitCode}` : `Child process received ${input.signal}`,
    normalizedPayload: { exitCode: input.exitCode, terminatingSignal: input.signal }
  }));
  repository.recordProcessFact(input.runId, { eventId: processEventId });
  const providerEventId = input.providerCompleted ? `${input.runId}-provider-terminal` : undefined;
  if (providerEventId !== undefined) {
    repository.appendEvent(observedEvent({
      runId: input.runId,
      id: providerEventId,
      sequence: input.sequence + 1,
      kind: input.exitCode === 0 ? "turn.completed" : "turn.failed",
      status: input.exitCode === 0 ? "completed" : "failed",
      summary: input.exitCode === 0 ? "Provider reported completion" : "Provider reported failure"
    }));
  }
  repository.reconcileRun(input.runId, {
    eventId: `${input.runId}-reconciled`,
    receivedAt: new Date(baseTime + (input.sequence + 2) * 1_000).toISOString(),
    endedAt: baseTime + (input.sequence + 2) * 1_000,
    ...(providerEventId === undefined ? {} : { providerTerminalEventId: providerEventId })
  });
}

export async function createFixtureDataRoot(): Promise<Readonly<{
  dataRoot: string;
  root: string;
}>> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-task-7-9-fixture-"));
  const dataRoot = join(root, "data");
  const artifactRoot = join(dataRoot, "artifacts", "sha256");
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
  const repository = new RunRepository(database, { artifactRoot });
  const create = (input: CreateRunInput, recorderInstanceId: string) => repository.createRun(input, {
    recorderInstanceId,
    recorderPid: process.pid,
    recorderStartToken: `recorder-start-${input.id}`,
    heartbeatAt: input.startedAt
  });

  const completedId = "fixture-completed-recovery";
  const completedRecorder = `recorder-${completedId}`;
  create(runInput({
    id: completedId,
    startedAt: baseTime + 40_000,
    label: "Failure followed by later likely-test evidence"
  }), completedRecorder);
  let sequence = 0;
  const failedCommandId = `${completedId}-command-failed`;
  repository.appendEvent(observedEvent({
    runId: completedId,
    id: failedCommandId,
    sequence: sequence++,
    kind: "command",
    status: "failed",
    summary: "Command failed",
    normalizedPayload: {
      commandEvidence: { state: "available", redactedCommand: "pnpm test" },
      exitCode: 1,
      aggregatedOutput: "FAIL synthetic fixture: expected true to be false\n"
    },
    nativePayload: {
      storage: "inline",
      redacted: { type: "item.failed", command: "pnpm test", output: "[REDACTED]" }
    }
  }));
  sequence = appendTestDerivations(repository, {
    runId: completedId,
    sourceEventId: failedCommandId,
    sourceStatus: "failed",
    exitCode: 1,
    sequence
  });
  const passedCommandId = `${completedId}-command-passed`;
  repository.appendEvent(observedEvent({
    runId: completedId,
    id: passedCommandId,
    sequence: sequence++,
    kind: "command",
    status: "completed",
    summary: "Later command completed",
    normalizedPayload: {
      commandEvidence: { state: "available", redactedCommand: "pnpm test" },
      exitCode: 0
    }
  }));
  sequence = appendTestDerivations(repository, {
    runId: completedId,
    sourceEventId: passedCommandId,
    sourceStatus: "completed",
    exitCode: 0,
    sequence
  });
  repository.appendEvent(observedEvent({
    runId: completedId,
    id: `${completedId}-unknown`,
    sequence: sequence++,
    kind: "future.synthetic_fixture",
    status: "unknown",
    summary: "Unknown future event retained without interpretation"
  }));
  repository.appendEvent(observedEvent({
    runId: completedId,
    id: `${completedId}-open-command`,
    sequence: sequence++,
    kind: "command",
    status: "in_progress",
    source: {
      provider: "codex-exec",
      itemId: `${completedId}-open-item`,
      itemType: "command_execution",
      eventType: "item.started"
    },
    summary: "Provider command remained open at recorder recovery",
    normalizedPayload: {
      commandEvidence: { state: "available", redactedCommand: "pnpm test" }
    }
  }));
  const recovered = repository.appendRecoveryForOpenEvents(completedId, {
    receivedAt: new Date(baseTime + sequence * 1_000).toISOString(),
    eventIdFor: (openEvent) => `${completedId}-recovery-${openEvent.id}`
  });
  sequence += recovered.length;
  finishRun(repository, {
    runId: completedId,
    recorderInstanceId: completedRecorder,
    sequence,
    exitCode: 0,
    signal: null,
    providerCompleted: true
  });
  const statusInitial = await completedArtifact(
    artifactRoot, completedId, "git-initial-status", "text/plain", ""
  );
  const statusFinal = await completedArtifact(
    artifactRoot, completedId, "git-final-status", "text/plain", "? notes.txt\n"
  );
  const diffPreamble = [
    "diff --git a/apps/web/src/example.ts b/apps/web/src/example.ts",
    "--- a/apps/web/src/example.ts",
    "+++ b/apps/web/src/example.ts",
    "@@ -1 +1 @@",
    "-old fixture value",
    "+new fixture value"
  ].join("\n");
  const diff = await completedArtifact(
    artifactRoot,
    completedId,
    "git-tracked-final-diff",
    "text/x-diff",
    `${diffPreamble}\n`
  );
  const diffCheck = await completedArtifact(
    artifactRoot,
    completedId,
    "git-diff-check",
    "application/json",
    JSON.stringify({ passed: true, output: "" })
  );
  const untracked = await completedArtifact(
    artifactRoot,
    completedId,
    "git-untracked-file-metadata",
    "application/json",
    JSON.stringify([{ path: "notes.txt", type: "file", size: 2048 }])
  );
  for (const artifact of [statusInitial, statusFinal, diff, diffCheck, untracked]) {
    await repository.commitArtifactMetadata(artifact);
  }
  repository.saveGitEvidence(completedId, {
    initialHead: "a".repeat(40),
    finalHead: "b".repeat(40),
    initialBranch: "main",
    finalBranch: "codex/fixture",
    initialStatus: { state: "artifact", artifactId: statusInitial.id },
    finalStatus: { state: "artifact", artifactId: statusFinal.id },
    trackedFinalDiff: { state: "artifact", artifactId: diff.id },
    diffCheck: { state: "artifact", artifactId: diffCheck.id },
    diffCheckPassed: true,
    untrackedMetadata: { state: "artifact", artifactId: untracked.id },
    headChanged: true,
    branchChanged: true,
    capturedAt: baseTime + 60_000
  });
  await repository.updateAssessment({
    expectedRevision: { state: "unconditional" },
    runId: completedId,
    eventId: `${completedId}-assessment`,
    receivedAt: new Date(baseTime + 61_000).toISOString(),
    verdict: "partial",
    taskCompleted: "uncertain"
  });

  const interruptedId = "fixture-interrupted";
  const interruptedRecorder = `recorder-${interruptedId}`;
  create(runInput({
    id: interruptedId,
    startedAt: baseTime + 30_000,
    label: "Interrupted while provider item remained open"
  }), interruptedRecorder);
  finishRun(repository, {
    runId: interruptedId,
    recorderInstanceId: interruptedRecorder,
    sequence: 0,
    exitCode: null,
    signal: "SIGINT",
    providerCompleted: false
  });

  const recorderErrorId = "fixture-recorder-error";
  const recorderErrorRecorder = `recorder-${recorderErrorId}`;
  create(runInput({
    id: recorderErrorId,
    startedAt: baseTime + 20_000,
    label: "Recorder failure retained as evidence"
  }), recorderErrorRecorder);
  const recorderFailureId = `${recorderErrorId}-failure`;
  repository.appendEvent(observedEvent({
    runId: recorderErrorId,
    id: recorderFailureId,
    sequence: 0,
    kind: "error",
    status: "failed",
    provenance: "recorder",
    source: { provider: "codex-exec", correlationId: recorderErrorId },
    summary: "Recorder failed",
    normalizedPayload: { recorderFailure: true }
  }));
  repository.reconcileRun(recorderErrorId, {
    eventId: `${recorderErrorId}-reconciled`,
    receivedAt: new Date(baseTime + 21_000).toISOString(),
    endedAt: baseTime + 21_000,
    recorderFailureEventId: recorderFailureId
  });

  const runningId = "fixture-running";
  const runningRecorder = `recorder-${runningId}`;
  create(runInput({
    id: runningId,
    startedAt: baseTime + 10_000,
    label: "Active local recording"
  }), runningRecorder);
  repository.markRunning(runningId, {
    recorderInstanceId: runningRecorder,
    childPid: 92_000,
    childStartToken: "fixture-active-child",
    childProcessGroupId: 92_000,
    updatedAt: baseTime + 10_500
  });

  const metadataOnlyId = "fixture-metadata-only";
  create(runInput({
    id: metadataOnlyId,
    startedAt: baseTime,
    label: "Metadata-only capture",
    capturePolicy: "metadata-only",
    repositoryFingerprint: "repo-private-redacted",
    repositoryDisplay: "Redacted repository"
  }), "recorder-fixture-metadata-only");
  repository.appendEvent(observedEvent({
    runId: metadataOnlyId,
    id: `${metadataOnlyId}-message`,
    sequence: 0,
    kind: "message.agent",
    status: "completed",
    summary: "Metadata-only evidence remains explicit"
  }));
  repository.saveGitEvidence(metadataOnlyId, {
    initialHead: "c".repeat(40),
    finalHead: "c".repeat(40),
    initialBranch: "main",
    finalBranch: "main",
    initialStatus: { state: "omitted", reason: "metadata-only" },
    finalStatus: { state: "omitted", reason: "metadata-only" },
    trackedFinalDiff: { state: "omitted", reason: "metadata-only" },
    diffCheck: { state: "omitted", reason: "metadata-only" },
    diffCheckPassed: true,
    untrackedMetadata: { state: "omitted", reason: "metadata-only" },
    headChanged: false,
    branchChanged: false,
    capturedAt: baseTime + 1_000
  });

  const boundedDiffId = "fixture-bounded-2mib-diff";
  const boundedRecorder = `recorder-${boundedDiffId}`;
  create(runInput({
    id: boundedDiffId,
    startedAt: baseTime - 5_000,
    label: "Bounded two-mebibyte-class diff"
  }), boundedRecorder);
  repository.appendEvent(observedEvent({
    runId: boundedDiffId,
    id: `${boundedDiffId}-message`,
    sequence: 0,
    kind: "message.agent",
    status: "completed",
    summary: "Large diff remains bounded and selectable",
    normalizedPayload: { text: "Open Final Git evidence to inspect the bounded large diff." }
  }));
  finishRun(repository, {
    runId: boundedDiffId,
    recorderInstanceId: boundedRecorder,
    sequence: 1,
    exitCode: 0,
    signal: null,
    providerCompleted: true
  });
  const boundedHeader = [
    "diff --git a/large.txt b/large.txt",
    "--- a/large.txt",
    "+++ b/large.txt",
    "@@ -0,0 +1 @@",
    "+"
  ].join("\n");
  const boundedDiff = await completedArtifact(
    artifactRoot,
    boundedDiffId,
    "git-tracked-final-diff",
    "text/x-diff",
    `${boundedHeader}${"x".repeat(2_096_000 - boundedHeader.length)}\n`
  );
  await repository.commitArtifactMetadata(boundedDiff);
  repository.saveGitEvidence(boundedDiffId, {
    initialHead: "d".repeat(40),
    finalHead: "e".repeat(40),
    initialBranch: "main",
    finalBranch: "main",
    initialStatus: { state: "omitted", reason: "metadata-only" },
    finalStatus: { state: "omitted", reason: "metadata-only" },
    trackedFinalDiff: { state: "artifact", artifactId: boundedDiff.id },
    diffCheck: { state: "omitted", reason: "metadata-only" },
    diffCheckPassed: true,
    untrackedMetadata: { state: "absent" },
    headChanged: true,
    branchChanged: false,
    capturedAt: baseTime + 2_000
  });

  const maximumUnbrokenText = "x".repeat(256);
  create(runInput({
    id: "fixture-maximum-width",
    startedAt: baseTime - 10_000,
    label: maximumUnbrokenText,
    repositoryFingerprint: maximumUnbrokenText,
    repositoryDisplay: maximumUnbrokenText
  }), "recorder-fixture-maximum-width");

  database.close();
  return { root, dataRoot };
}
