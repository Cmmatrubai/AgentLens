import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ArtifactStore,
  prepareNativePayload,
  redactJson,
  redactedTextBytes,
  redactText,
  type CompletedArtifact,
  type TraceEventV1
} from "../../../packages/core/src/index.js";
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
  dataRoot: string,
  runId: string,
  kind: string,
  mediaType: string,
  content: string
): Promise<CompletedArtifact> {
  const redacted = redactText(content, {
    policy: "standard",
    key: Buffer.alloc(32, 0x5a),
    contentClass: kind.includes("diff") ? "git-diff" : "tool"
  });
  return new ArtifactStore(dataRoot).writeRedacted({
    runId,
    kind,
    mediaType,
    redactedBytes: redactedTextBytes(redacted)
  });
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

export const syntheticMixedGraphRunId = "fixture-synthetic-mixed-graph";

// A separate synthetic run: never amend real captures or reuse privacy fixture IDs.
async function appendSyntheticMixedGraph(repository: RunRepository, dataRoot: string): Promise<void> {
  const runId = syntheticMixedGraphRunId;
  const recorderInstanceId = `recorder-${runId}`;
  repository.createRun(runInput({ id: runId, startedAt: baseTime,
    label: "Synthetic mixed-evidence graph fixture",
    repositoryFingerprint: "repo-synthetic-graph", repositoryDisplay: "Synthetic graph fixture" }), {
    recorderInstanceId, recorderPid: process.pid, recorderStartToken: `synthetic-${runId}`,
    heartbeatAt: baseTime
  });
  let sequence = 0;
  for (let index = 0; index < 3; index += 1) repository.appendEvent(observedEvent({
    runId, id: `${runId}-routine-${index}`, sequence: sequence++, kind: "message.agent",
    status: "completed", summary: `Synthetic routine message ${index + 1}`,
    normalizedPayload: { role: "agent", text: `Synthetic graph fixture message ${index + 1}` }
  }));
  for (const phase of ["started", "completed"] as const) repository.appendEvent(observedEvent({
    runId, id: `${runId}-successful-command-${phase}`, sequence: sequence++, kind: "command",
    status: phase === "started" ? "in_progress" : "completed",
    summary: `Synthetic successful command ${phase}`,
    source: { provider: "codex-exec", itemId: `${runId}-successful-item`,
      itemType: "command_execution", eventType: `item.${phase}` },
    normalizedPayload: { commandEvidence: { state: "available", redactedCommand: "synthetic-check" },
      ...(phase === "completed" ? { exitCode: 0 } : {}) }
  }));
  const itemId = `${runId}-test-item`;
  const commandEvidence = { state: "available", redactedCommand: "pnpm test synthetic/example.test.ts" };
  repository.appendEvent(observedEvent({
    runId, id: `${runId}-command-started`, sequence: sequence++, kind: "command", status: "in_progress",
    summary: "Synthetic test command started",
    source: { provider: "codex-exec", itemId, itemType: "command_execution", eventType: "item.started" },
    normalizedPayload: { commandEvidence }
  }));
  const failedCommandId = `${runId}-command-failed`;
  const nativePayload = await prepareNativePayload(redactJson({ type: "item.completed",
    item: { id: itemId, type: "command_execution", command: commandEvidence.redactedCommand,
      exit_code: 1, aggregated_output: "FAIL synthetic graph fixture" }
  }, { policy: "standard", key: Buffer.alloc(32, 0x5a), contentClass: "native", runId }), new ArtifactStore(dataRoot));
  repository.appendEvent(observedEvent({
    runId, id: failedCommandId, sequence: sequence++, kind: "command", status: "failed",
    summary: "Synthetic test command failed",
    source: { provider: "codex-exec", itemId, itemType: "command_execution", eventType: "item.completed" },
    normalizedPayload: { commandEvidence, exitCode: 1,
      aggregatedOutput: `FAIL synthetic graph fixture\n${"Synthetic output remains explicitly loaded.\n".repeat(300)}` },
    nativePayload
  }));
  sequence = appendTestDerivations(repository, { runId, sourceEventId: failedCommandId,
    sourceStatus: "failed", exitCode: 1, sequence });
  repository.appendEvent(observedEvent({
    runId, id: `${runId}-file-change`, sequence: sequence++, kind: "fileChange", status: "completed",
    summary: "Synthetic provider file change: paths only",
    source: { provider: "codex-exec", itemId: `${runId}-file-item`, itemType: "file_change", eventType: "item.completed" },
    normalizedPayload: { changes: [{ path: "synthetic/example.ts", kind: "update" }] }
  }));
  repository.appendEvent(observedEvent({
    runId, id: `${runId}-open-command`, sequence: sequence++, kind: "command", status: "in_progress",
    summary: "Synthetic command left open before recorder recovery",
    source: { provider: "codex-exec", itemId: `${runId}-open-item`, itemType: "command_execution", eventType: "item.started" },
    normalizedPayload: { commandEvidence: { state: "available", redactedCommand: "synthetic-check" } }
  }));
  sequence += repository.appendRecoveryForOpenEvents(runId, {
    receivedAt: new Date(baseTime + sequence * 1_000).toISOString(),
    eventIdFor: (openEvent) => `${runId}-recovery-${openEvent.id}`
  }).length;
  finishRun(repository, { runId, recorderInstanceId, sequence, exitCode: 0, signal: null, providerCompleted: true });
  const diff = await completedArtifact(dataRoot, runId, "git-tracked-final-diff", "text/x-diff", [
    "diff --git a/synthetic/example.ts b/synthetic/example.ts", "--- a/synthetic/example.ts",
    "+++ b/synthetic/example.ts", "@@ -1 +1 @@", "-synthetic before", "+synthetic after", ""
  ].join("\n"));
  const initialStatus = await completedArtifact(dataRoot, runId, "git-initial-status", "text/plain", "");
  const finalStatus = await completedArtifact(dataRoot, runId, "git-final-status", "text/plain", " M synthetic/example.ts\n");
  const diffCheck = await completedArtifact(dataRoot, runId, "git-diff-check", "application/json",
    JSON.stringify({ passed: true, output: "" }));
  for (const artifact of [diff, initialStatus, finalStatus, diffCheck]) await repository.commitArtifactMetadata(artifact);
  repository.saveGitEvidence(runId, {
    initialHead: "1".repeat(40), finalHead: "1".repeat(40), initialBranch: "synthetic-fixture", finalBranch: "synthetic-fixture",
    initialStatus: { state: "artifact", artifactId: initialStatus.id }, finalStatus: { state: "artifact", artifactId: finalStatus.id },
    trackedFinalDiff: { state: "artifact", artifactId: diff.id }, diffCheck: { state: "artifact", artifactId: diffCheck.id },
    diffCheckPassed: true, untrackedMetadata: { state: "absent" }, headChanged: false, branchChanged: false,
    capturedAt: baseTime + 90_000
  });
  await repository.updateAssessment({ expectedRevision: { state: "unconditional" }, runId,
    eventId: `${runId}-assessment`, receivedAt: new Date(baseTime + 91_000).toISOString(),
    verdict: "partial", taskCompleted: "uncertain" });
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
  const artifactStore = new ArtifactStore(dataRoot);
  const redactionKey = Buffer.alloc(32, 0x5a);
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
  const standardOutput = redactText(
    "Bearer RAW_STANDARD_SECRET_SENTINEL_RELEASE",
    { policy: "standard", key: redactionKey, contentClass: "output" }
  );
  const standardNative = await prepareNativePayload(redactJson({
    type: "item.failed",
    command: "pnpm test",
    output: "Bearer RAW_STANDARD_SECRET_SENTINEL_RELEASE"
  }, {
    policy: "standard",
    key: redactionKey,
    contentClass: "native",
    runId: completedId
  }), artifactStore);
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
      aggregatedOutput: `FAIL synthetic fixture: expected true to be false\n${standardOutput.text}\n${"synthetic bounded output\n".repeat(4_000)}`
    },
    nativePayload: standardNative
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
    dataRoot, completedId, "git-initial-status", "text/plain", ""
  );
  const statusFinal = await completedArtifact(
    dataRoot, completedId, "git-final-status", "text/plain", "? notes.txt\n"
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
    dataRoot,
    completedId,
    "git-tracked-final-diff",
    "text/x-diff",
    `${diffPreamble}\n`
  );
  const diffCheck = await completedArtifact(
    dataRoot,
    completedId,
    "git-diff-check",
    "application/json",
    JSON.stringify({ passed: true, output: "" })
  );
  const untracked = await completedArtifact(
    dataRoot,
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

  const failedId = "fixture-failed";
  const failedRecorder = `recorder-${failedId}`;
  create(runInput({
    id: failedId,
    startedAt: baseTime + 25_000,
    label: "Provider and process failure evidence"
  }), failedRecorder);
  finishRun(repository, {
    runId: failedId,
    recorderInstanceId: failedRecorder,
    sequence: 0,
    exitCode: 1,
    signal: null,
    providerCompleted: true
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
  const metadataNative = await prepareNativePayload(redactJson({
    prompt: "OMITTED_PROMPT_SENTINEL_RELEASE",
    message: "OMITTED_MESSAGE_SENTINEL_RELEASE",
    command: "OMITTED_COMMAND_SENTINEL_RELEASE",
    output: "OMITTED_OUTPUT_SENTINEL_RELEASE",
    diff: "OMITTED_DIFF_SENTINEL_RELEASE",
    note: "OMITTED_NOTE_SENTINEL_RELEASE",
    sourceId: "OMITTED_SOURCE_ID_SENTINEL_RELEASE",
    databasePath: "OMITTED_DATABASE_PATH_SENTINEL_RELEASE",
    artifactPath: "OMITTED_ARTIFACT_PATH_SENTINEL_RELEASE",
    repositoryPath: "OMITTED_REPOSITORY_PATH_SENTINEL_RELEASE"
  }, {
    policy: "metadata-only",
    key: redactionKey,
    contentClass: "native",
    runId: metadataOnlyId
  }), artifactStore);
  repository.appendEvent(observedEvent({
    runId: metadataOnlyId,
    id: `${metadataOnlyId}-message`,
    sequence: 0,
    kind: "message.agent",
    status: "completed",
    summary: "Metadata-only evidence remains explicit",
    normalizedPayload: {
      prompt: redactText("OMITTED_PROMPT_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "prompt"
      }).text,
      message: redactText("OMITTED_MESSAGE_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "message"
      }).text,
      command: redactText("OMITTED_COMMAND_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "command"
      }).text,
      output: redactText("OMITTED_OUTPUT_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "output"
      }).text,
      diff: redactText("OMITTED_DIFF_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "git-diff"
      }).text,
      note: redactText("OMITTED_NOTE_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "message"
      }).text,
      sourceId: redactText("OMITTED_SOURCE_ID_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "native"
      }).text,
      databasePath: redactText("OMITTED_DATABASE_PATH_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "path"
      }).text,
      artifactPath: redactText("OMITTED_ARTIFACT_PATH_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "path"
      }).text,
      repositoryPath: redactText("OMITTED_REPOSITORY_PATH_SENTINEL_RELEASE", {
        policy: "metadata-only", key: redactionKey, contentClass: "path"
      }).text
    },
    nativePayload: metadataNative
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

  const strictId = "fixture-strict-omitted";
  create(runInput({
    id: strictId,
    startedAt: baseTime - 1_000,
    label: "Strict capture with omitted content",
    capturePolicy: "strict",
    repositoryFingerprint: "repo-private-strict",
    repositoryDisplay: "Redacted repository"
  }), "recorder-fixture-strict");
  const strictNative = await prepareNativePayload(redactJson({
    prompt: "OMITTED_PROMPT_SENTINEL_RELEASE",
    output: "OMITTED_OUTPUT_SENTINEL_RELEASE"
  }, {
    policy: "strict",
    key: redactionKey,
    contentClass: "native",
    runId: strictId
  }), artifactStore);
  repository.appendEvent(observedEvent({
    runId: strictId,
    id: `${strictId}-message`,
    sequence: 0,
    kind: "message.agent",
    status: "completed",
    summary: "Strict evidence retains only policy-safe metadata",
    normalizedPayload: {
      prompt: redactText("OMITTED_PROMPT_SENTINEL_RELEASE", {
        policy: "strict", key: redactionKey, contentClass: "prompt"
      }).text
    },
    nativePayload: strictNative
  }));

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
    "+first bounded file",
    "diff --git a/second.txt b/second.txt",
    "--- a/second.txt",
    "+++ b/second.txt",
    "@@ -0,0 +1 @@",
    "+second bounded file"
  ].join("\n");
  const boundedDiff = await completedArtifact(
    dataRoot,
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

  await appendSyntheticMixedGraph(repository, dataRoot);
  database.close();
  return { root, dataRoot };
}
