import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TraceEventV1 } from "../../../packages/core/src/index.js";
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
    ...(input.normalizedPayload === undefined ? {} : { normalizedPayload: input.normalizedPayload })
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
      exitCode: 1
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
  finishRun(repository, {
    runId: completedId,
    recorderInstanceId: completedRecorder,
    sequence,
    exitCode: 0,
    signal: null,
    providerCompleted: true
  });
  repository.saveGitEvidence(completedId, {
    initialHead: "a".repeat(40),
    finalHead: "b".repeat(40),
    initialBranch: "main",
    finalBranch: "codex/fixture",
    initialStatus: { state: "omitted", reason: "metadata-only" },
    finalStatus: { state: "omitted", reason: "metadata-only" },
    trackedFinalDiff: { state: "absent" },
    diffCheck: { state: "omitted", reason: "metadata-only" },
    diffCheckPassed: true,
    untrackedMetadata: { state: "absent" },
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

  create(runInput({
    id: "fixture-metadata-only",
    startedAt: baseTime,
    label: "Metadata-only capture",
    capturePolicy: "metadata-only",
    repositoryFingerprint: "repo-private-redacted",
    repositoryDisplay: "Redacted repository"
  }), "recorder-fixture-metadata-only");

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
