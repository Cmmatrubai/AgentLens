import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  ArtifactStore,
  loadOrCreateRedactionKey,
  redactGitDiff,
  redactText,
  redactedTextBytes,
  shouldExcludePath,
  type CapturePolicy,
  type ContentClass,
  type EventDraftV1,
  type RedactionAudit,
  type TraceEventV1
} from "@agentlens/core";
import { decodeCodexLine, normalizeCodexRecord } from "@agentlens/codex";
import {
  openDatabase,
  RunRepository,
  type GitEvidenceInput,
  type OptionalGitEvidenceRef,
  type RequiredGitEvidenceRef,
  type RunRecord
} from "@agentlens/storage";
import type { RecordCommand } from "./args.js";
import { ownerOnlyDatabaseFiles, prepareDataRoot } from "./dataRoot.js";
import {
  derivePersistedTerminalCommand,
  ensureTestDerivationsForRun
} from "./deriveTests.js";
import {
  captureGitAfter,
  captureGitBefore,
  decodeGitPath,
  type GitAfterEvidence,
  type GitBeforeEvidence
} from "./gitEvidence.js";
import { persistEventDraft } from "./persistEvent.js";
import {
  systemProcessIdentityInspector,
  type ProcessGroupState,
  type ProcessIdentityInspector
} from "./processIdentity.js";
import {
  ChildSpawnError,
  ProcessGroupTerminationError,
  runChildProcess,
  type ChildProcessResult
} from "./processRunner.js";
import { resolvePromptInput } from "./promptInput.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export interface RecordRunDependencies {
  readonly cwd?: string;
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: OutputWriter;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly forceTerminationSignal?: AbortSignal;
  readonly terminationGraceMs?: number;
  readonly inspectProcessGroup?: (processGroupId: number) => ProcessGroupState;
  readonly now?: () => number;
  readonly nextId?: () => string;
  readonly processIdentityInspector?: ProcessIdentityInspector;
  readonly recorderPid?: number;
  readonly heartbeatIntervalMs?: number;
  readonly onRunIdPrinted?: (runId: string) => void | Promise<void>;
  readonly onFinalGitPersisted?: () => void | Promise<void>;
  readonly onRecoveryAppended?: () => void | Promise<void>;
  readonly onObservedEventPersisted?: (
    observation: Readonly<{ runId: string; eventId: string }>
  ) => void | Promise<void>;
  readonly derivePersistedTerminalCommand?: typeof derivePersistedTerminalCommand;
  readonly ensureTestDerivationsForRun?: typeof ensureTestDerivationsForRun;
}

export interface RecordResult {
  readonly runId: string;
  readonly status: RunRecord["status"];
  readonly exitCode: number | null;
  readonly terminatingSignal: string | null;
  readonly cliExitCode: number;
  readonly databasePath: string;
}

export interface RecordingState {
  sequence: number;
  providerTerminalEventId?: string;
}

export interface GitPersistenceContext {
  readonly runId: string;
  readonly capturePolicy: CapturePolicy;
  readonly key: Buffer;
  readonly artifactStore: ArtifactStore;
  readonly repository: RunRepository;
  readonly committedArtifactIds: Set<string>;
}

function isEligibleTerminalObservedCommand(event: TraceEventV1): boolean {
  if (
    event.provenance !== "observed" ||
    event.kind !== "command" ||
    (event.status !== "completed" && event.status !== "failed")
  ) return false;
  if (event.source.itemType !== undefined && event.source.itemType !== "command_execution") {
    return false;
  }
  return event.source.eventType === undefined ||
    event.source.eventType === "item.completed" ||
    event.source.eventType === "item.failed";
}

function advanceSequenceFromDerivedEvents(
  state: RecordingState,
  derivedEvents: readonly TraceEventV1[]
): void {
  for (const event of derivedEvents) {
    state.sequence = Math.max(state.sequence, event.sequence + 1);
  }
}

function rebaseSequenceFromDurableEvents(
  repository: RunRepository,
  state: RecordingState,
  runId: string
): void {
  for (const event of repository.getRunDetail(runId).events) {
    state.sequence = Math.max(state.sequence, event.sequence + 1);
  }
}

function runDerivationWithSequenceRebase(
  repository: RunRepository,
  state: RecordingState,
  runId: string,
  derive: () => readonly TraceEventV1[]
): void {
  try {
    advanceSequenceFromDerivedEvents(state, derive());
  } catch (error) {
    try {
      rebaseSequenceFromDurableEvents(repository, state, runId);
    } catch {
      // The derivation persistence error remains primary when durable storage cannot be reread.
    }
    throw error;
  }
}

const VERSION = "0.1.0";

function iso(now: () => number): string {
  return new Date(now()).toISOString();
}

function cliExitCode(run: RunRecord): number {
  if (run.exitCode !== null && run.exitCode !== 0) return run.exitCode;
  return run.status === "completed" ? 0 : 1;
}

function result(run: RunRecord, databasePath: string): RecordResult {
  return Object.freeze({
    runId: run.id,
    status: run.status,
    exitCode: run.exitCode,
    terminatingSignal: run.terminatingSignal,
    cliExitCode: cliExitCode(run),
    databasePath
  });
}

export function repositoryFingerprint(repositoryRoot: string, key: Buffer): string {
  return redactText(repositoryRoot, { policy: "strict", key, contentClass: "path" }).text;
}

function redactedOptionalText(
  value: string | undefined,
  policy: CapturePolicy,
  key: Buffer,
  contentClass: ContentClass
): string | undefined {
  if (value === undefined) return undefined;
  return redactText(value, { policy, key, contentClass }).text;
}

function appendInternalEvent(
  repository: RunRepository,
  state: RecordingState,
  input: Omit<TraceEventV1, "id" | "sequence">,
  nextId: () => string,
  audits: readonly RedactionAudit[] = []
): TraceEventV1 {
  return repository.appendEvent({
    ...input,
    id: nextId(),
    sequence: state.sequence++
  }, audits);
}

function appendInterruption(
  repository: RunRepository,
  state: RecordingState,
  runId: string,
  receivedAt: string,
  nextId: () => string
): TraceEventV1 {
  return appendInternalEvent(repository, state, {
    runId,
    receivedAt,
    kind: "recorder.interruption",
    status: "interrupted",
    provenance: "recorder",
    source: { provider: "codex-exec", correlationId: runId },
    relationships: [],
    summary: "Explicit interruption",
    normalizedPayload: { explicitInterruption: true }
  }, nextId);
}

async function appendRecoveriesForOpenEvents(
  repository: RunRepository,
  state: RecordingState,
  runId: string,
  receivedAt: string,
  nextId: () => string,
  onRecoveryAppended?: () => void | Promise<void>
): Promise<readonly TraceEventV1[]> {
  const recoveries = repository.appendRecoveryForOpenEvents(runId, {
    receivedAt,
    eventIdFor: () => nextId()
  });
  if (recoveries.length === 0) return recoveries;
  state.sequence = recoveries.reduce(
    (nextSequence, recovery) => Math.max(nextSequence, recovery.sequence + 1),
    state.sequence
  );
  await onRecoveryAppended?.();
  return recoveries;
}

function evidencePathFromStatusLine(line: string): string[] {
  if (line.startsWith("? ") || line.startsWith("! ")) return [decodeGitPath(line.slice(2))];
  if (line.startsWith("1 ")) return [decodeGitPath(line.split(" ").slice(8).join(" "))];
  if (line.startsWith("2 ")) {
    const paths = line.split(" ").slice(9).join(" ").split("\t").map(decodeGitPath);
    return paths;
  }
  if (line.startsWith("u ")) return [decodeGitPath(line.split(" ").slice(10).join(" "))];
  return [];
}

function filterSensitiveStatus(status: string): string {
  return status
    .split("\n")
    .map((line) => {
      if (line.length === 0) return line;
      for (const path of evidencePathFromStatusLine(line)) {
        const decision = shouldExcludePath(path, "standard");
        if (decision.exclude) return `[[EXCLUDED:${decision.reason ?? "sensitive-path"}]]`;
      }
      return line;
    })
    .join("\n");
}

function filterSensitiveDiffCheck(output: string): string {
  const filtered: string[] = [];
  let expectedDetail: "include" | "exclude" | undefined;
  for (const line of output.split("\n")) {
    if (expectedDetail !== undefined) {
      if (line.startsWith("+")) {
        if (expectedDetail === "include") filtered.push(line);
        expectedDetail = undefined;
        continue;
      }
      expectedDetail = undefined;
    }
    const header = /^(.*):\d+:\s.*$/.exec(line);
    if (header?.[1]) {
      const decision = shouldExcludePath(decodeGitPath(header[1]), "standard");
      expectedDetail = decision.exclude ? "exclude" : "include";
      filtered.push(decision.exclude
        ? `[[EXCLUDED:${decision.reason ?? "sensitive-path"}]]`
        : line);
      continue;
    }
    filtered.push(line);
  }
  return filtered.join("\n");
}

async function commitRedactedArtifact(
  context: GitPersistenceContext,
  kind: string,
  mediaType: string,
  redacted: ReturnType<typeof redactText>
): Promise<string> {
  const completed = await context.artifactStore.writeRedacted({
    runId: context.runId,
    kind,
    redactedBytes: redactedTextBytes(redacted),
    mediaType
  });
  if (!context.committedArtifactIds.has(completed.id)) {
    await context.repository.commitArtifactMetadata(completed, redacted.audits);
    context.committedArtifactIds.add(completed.id);
  }
  return completed.id;
}

async function requiredTextEvidence(
  context: GitPersistenceContext,
  kind: string,
  raw: string,
  contentClass: ContentClass,
  mediaType = "text/plain"
): Promise<RequiredGitEvidenceRef> {
  if (context.capturePolicy !== "standard") {
    return Object.freeze({ state: "omitted" as const, reason: context.capturePolicy });
  }
  const redacted = contentClass === "git-diff"
    ? redactGitDiff(raw, {
        policy: context.capturePolicy,
        key: context.key,
        contentClass,
        sensitivePathPolicy: { capture: context.capturePolicy }
      })
    : redactText(raw, { policy: context.capturePolicy, key: context.key, contentClass });
  const artifactId = await commitRedactedArtifact(context, kind, mediaType, redacted);
  return Object.freeze({ state: "artifact" as const, artifactId });
}

async function optionalTextEvidence(
  context: GitPersistenceContext,
  kind: string,
  raw: string,
  contentClass: ContentClass,
  mediaType = "text/plain"
): Promise<OptionalGitEvidenceRef> {
  if (raw.length === 0) return Object.freeze({ state: "absent" as const });
  return requiredTextEvidence(context, kind, raw, contentClass, mediaType);
}

export function redactedBranch(value: string | null, policy: CapturePolicy, key: Buffer): string | null {
  if (value === null) return null;
  return redactText(value, { policy, key, contentClass: "path" }).text;
}

async function persistInitialGit(
  before: GitBeforeEvidence,
  context: GitPersistenceContext,
  repository: RunRepository,
  state: RecordingState,
  nextId: () => string,
  receivedAt: string
): Promise<RequiredGitEvidenceRef> {
  const status = context.capturePolicy === "standard"
    ? filterSensitiveStatus(before.initialStatus)
    : before.initialStatus;
  const initialStatus = await requiredTextEvidence(
    context,
    "git-initial-status",
    status,
    "path"
  );
  appendInternalEvent(repository, state, {
    runId: context.runId,
    receivedAt,
    kind: "git.snapshot",
    status: "completed",
    provenance: "git_recovered",
    source: { provider: "codex-exec", correlationId: context.runId },
    relationships: [],
    summary: "Initial Git snapshot",
    normalizedPayload: {
      initialHead: before.initialHead,
      initialBranch: redactedBranch(before.initialBranch, context.capturePolicy, context.key),
      initialStatus
    }
  }, nextId);
  return initialStatus;
}

export async function persistFinalGit(
  before: GitBeforeEvidence,
  after: GitAfterEvidence,
  initialStatus: RequiredGitEvidenceRef,
  context: GitPersistenceContext,
  repository: RunRepository,
  state: RecordingState,
  nextId: () => string,
  receivedAt: string,
  capturedAt: number,
  recovered?: Readonly<{ storedInitialBranch: string | null; branchChanged: boolean }>
): Promise<void> {
  const finalStatusText = context.capturePolicy === "standard"
    ? filterSensitiveStatus(after.finalStatus)
    : after.finalStatus;
  const finalStatus = await requiredTextEvidence(context, "git-final-status", finalStatusText, "path");
  const trackedFinalDiff = await optionalTextEvidence(
    context,
    "git-tracked-final-diff",
    after.trackedFinalDiff,
    "git-diff",
    "text/x-diff"
  );
  const diffCheckRaw = JSON.stringify({
    passed: after.diffCheck.passed,
    output: context.capturePolicy === "standard"
      ? filterSensitiveDiffCheck(after.diffCheck.output)
      : after.diffCheck.output
  });
  const diffCheck = await requiredTextEvidence(
    context,
    "git-diff-check",
    diffCheckRaw,
    "diagnostic",
    "application/json"
  );
  const filteredUntracked = after.untrackedMetadata.map((entry) => {
    const decision = shouldExcludePath(entry.path, context.capturePolicy);
    return decision.exclude
      ? { ...entry, path: `[[EXCLUDED:${decision.reason ?? "sensitive-path"}]]` }
      : entry;
  });
  const untrackedMetadata = await optionalTextEvidence(
    context,
    "git-untracked-file-metadata",
    filteredUntracked.length === 0 ? "" : JSON.stringify(filteredUntracked),
    "path",
    "application/json"
  );
  const input: GitEvidenceInput = {
    initialHead: before.initialHead,
    finalHead: after.finalHead,
    initialBranch: recovered === undefined
      ? redactedBranch(before.initialBranch, context.capturePolicy, context.key)
      : recovered.storedInitialBranch,
    finalBranch: redactedBranch(after.finalBranch, context.capturePolicy, context.key),
    initialStatus,
    finalStatus,
    trackedFinalDiff,
    diffCheck,
    diffCheckPassed: after.diffCheck.passed,
    untrackedMetadata,
    headChanged: after.headChanged,
    branchChanged: recovered?.branchChanged ?? after.branchChanged,
    capturedAt
  };
  repository.saveGitEvidence(context.runId, input);
  appendInternalEvent(repository, state, {
    runId: context.runId,
    receivedAt,
    kind: "git.final_evidence",
    status: after.diffCheck.passed ? "completed" : "failed",
    provenance: "git_recovered",
    source: { provider: "codex-exec", correlationId: context.runId },
    relationships: [],
    summary: "Final Git evidence",
    normalizedPayload: {
      headChanged: after.headChanged,
      branchChanged: recovered?.branchChanged ?? after.branchChanged,
      finalStatus,
      trackedFinalDiff,
      diffCheck,
      diffCheckPassed: after.diffCheck.passed,
      untrackedMetadata
    }
  }, nextId);
}

function processStatus(processResult: ChildProcessResult): TraceEventV1["status"] {
  if (processResult.terminatingSignal !== null) return "interrupted";
  if (processResult.exitCode === null) return "unknown";
  return processResult.exitCode === 0 ? "completed" : "failed";
}

function appendRecorderFailure(
  repository: RunRepository,
  state: RecordingState,
  runId: string,
  phase: string,
  nextId: () => string,
  receivedAt: string
): TraceEventV1 {
  return appendInternalEvent(repository, state, {
    runId,
    receivedAt,
    kind: "error",
    status: "failed",
    provenance: "recorder",
    source: { provider: "codex-exec", correlationId: runId },
    relationships: [],
    summary: "Recorder failure",
    normalizedPayload: { recorderFailure: true, phase }
  }, nextId);
}

function invocationPayload(
  command: RecordCommand,
  promptInput: Awaited<ReturnType<typeof resolvePromptInput>>
): Record<string, unknown> {
  const promptSource = promptInput.mode === "buffered" ? "stdin-buffered" : "tty-inherited";
  if (command.capture !== "standard") {
    return {
      promptSource,
      argv: { state: "omitted", argumentCount: command.childArgs.length },
      stdin: promptInput.mode === "buffered"
        ? { state: "omitted", byteLength: promptInput.bytes.byteLength }
        : { state: "absent" }
    };
  }
  return {
    promptSource,
    argv: { state: "captured", values: [...command.childArgs] },
    stdin: promptInput.mode === "buffered"
      ? {
          state: "captured",
          byteLength: promptInput.bytes.byteLength,
          encoding: "utf8-lossy",
          text: promptInput.bytes.toString("utf8")
        }
      : { state: "absent" }
  };
}

export async function recordRun(
  command: RecordCommand,
  dependencies: RecordRunDependencies = {}
): Promise<RecordResult> {
  const cwd = dependencies.cwd ?? process.cwd();
  const stdin = dependencies.stdin ?? process.stdin;
  const stdout = dependencies.stdout ?? process.stdout;
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const nextId = dependencies.nextId ?? randomUUID;
  const deriveTerminalCommand =
    dependencies.derivePersistedTerminalCommand ?? derivePersistedTerminalCommand;
  const ensureRunTestDerivations =
    dependencies.ensureTestDerivationsForRun ?? ensureTestDerivationsForRun;
  const processIdentityInspector =
    dependencies.processIdentityInspector ?? systemProcessIdentityInspector;
  const recorderPid = dependencies.recorderPid ?? process.pid;
  const recorderStartToken = await processIdentityInspector.captureStartToken(recorderPid);
  if (recorderStartToken === null) {
    throw new Error("AgentLens could not establish the recorder process start identity.");
  }
  const recorderInstanceId = randomUUID();

  const before = await captureGitBefore(cwd);
  const promptInput = await resolvePromptInput(command.childArgs, stdin);
  const dataRoot = resolve(command.dataRoot);
  const databasePath = await prepareDataRoot(dataRoot, before.repositoryRoot);
  const key = await loadOrCreateRedactionKey(dataRoot);
  const database = openDatabase(databasePath);
  await ownerOnlyDatabaseFiles(databasePath);
  const artifactRoot = join(dataRoot, "artifacts", "sha256");
  const repository = new RunRepository(database, { artifactRoot });
  const artifactStore = new ArtifactStore(dataRoot);
  const runId = nextId();
  const state: RecordingState = { sequence: 0 };
  const committedArtifactIds = new Set<string>();
  const gitContext: GitPersistenceContext = {
    runId,
    capturePolicy: command.capture,
    key,
    artifactStore,
    repository,
    committedArtifactIds
  };
  const catchUpTestDerivations = (): void => {
    runDerivationWithSequenceRebase(
      repository,
      state,
      runId,
      () => ensureRunTestDerivations({ repository, runId })
    );
  };

  let initialStatus: RequiredGitEvidenceRef | undefined;
  let markedRunning = false;
  let recorderFailureEventId: string | undefined;
  let interruptionEventId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatFailure: Error | undefined;
  let hasEagerDerivationFailure = false;
  let eagerDerivationFailure: unknown;
  try {
    const redactedLabel = redactedOptionalText(command.label, command.capture, key, "label");
    repository.createRun({
      id: runId,
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: VERSION,
      agentVersion: "unknown",
      capturePolicy: command.capture,
      capturePolicyVersion: "1",
      redactionVersion: "1",
      ...(redactedLabel === undefined ? {} : { label: redactedLabel }),
      promptSource: promptInput.mode === "buffered" ? "stdin-buffered" : "tty-inherited",
      repositoryFingerprint: repositoryFingerprint(before.repositoryRoot, key),
      repositoryDisplay: redactedOptionalText(
        before.repositoryRoot.split("/").filter(Boolean).at(-1) ?? "repository",
        command.capture,
        key,
        "path"
      ) ?? "repository",
      startedAt: now()
    }, {
      recorderInstanceId,
      recorderPid,
      recorderStartToken,
      heartbeatAt: now()
    });
    heartbeatTimer = setInterval(() => {
      try {
        const heartbeatAt = now();
        const refreshed = repository.refreshOwnership(runId, { recorderInstanceId, heartbeatAt });
        if (!refreshed) {
          heartbeatFailure = new Error("Recorder ownership heartbeat was rejected.");
        }
      } catch (error) {
        heartbeatFailure = error instanceof Error ? error : new Error(String(error));
      }
    }, dependencies.heartbeatIntervalMs ?? 1_000);
    stdout.write(`Run ID: ${runId}\n`);
    stdout.write(
      "Warning: secret detection reduces risk but cannot guarantee captured content is free of sensitive material; review before any future export.\n"
    );
    await dependencies.onRunIdPrinted?.(runId);

    initialStatus = await persistInitialGit(
      before,
      gitContext,
      repository,
      state,
      nextId,
      iso(now)
    );

    await persistEventDraft({
      kind: "recorder.invocation",
      status: "completed",
      provenance: "recorder",
      source: { provider: "codex-exec", correlationId: runId },
      relationships: [],
      summary: "Recorder invocation",
      normalizedPayload: invocationPayload(command, promptInput)
    }, {
      runId,
      capturePolicy: command.capture,
      redactionKey: key,
      artifactStore,
      repository,
      committedArtifactIds,
      nextEventId: nextId,
      nextSequence: () => state.sequence++,
      receivedAt: () => iso(now)
    });

    if (dependencies.signal?.aborted) {
      const interruption = appendInterruption(repository, state, runId, iso(now), nextId);
      interruptionEventId = interruption.id;
      const after = await captureGitAfter(before);
      await persistFinalGit(before, after, initialStatus, gitContext, repository, state, nextId, iso(now), now());
      catchUpTestDerivations();
      const run = repository.reconcileRun(runId, {
        eventId: nextId(),
        receivedAt: iso(now),
        endedAt: now(),
        interruptionEventId
      });
      return result(run, databasePath);
    }

    let lineQueue = Promise.resolve();
    const enqueueDrafts = (
      drafts: readonly EventDraftV1[],
      receivedAtIso: string
    ): Promise<void> => {
      lineQueue = lineQueue.then(async () => {
        for (const draft of drafts) {
          const persisted = await persistEventDraft(draft, {
            runId,
            capturePolicy: command.capture,
            redactionKey: key,
            artifactStore,
            repository,
            committedArtifactIds,
            nextEventId: nextId,
            nextSequence: () => state.sequence++,
            receivedAt: () => receivedAtIso
          });
          if (persisted.provenance === "observed") {
            await dependencies.onObservedEventPersisted?.({ runId, eventId: persisted.id });
          }
          if (isEligibleTerminalObservedCommand(persisted) && !hasEagerDerivationFailure) {
            try {
              runDerivationWithSequenceRebase(
                repository,
                state,
                runId,
                () => deriveTerminalCommand({ repository, runId, sourceEventId: persisted.id })
              );
            } catch (error) {
              hasEagerDerivationFailure = true;
              eagerDerivationFailure = error;
            }
          }
          if (
            persisted.provenance === "observed" &&
            (persisted.kind === "turn.completed" || persisted.kind === "turn.failed")
          ) state.providerTerminalEventId = persisted.id;
        }
      });
      return lineQueue;
    };
    const childResult = await runChildProcess({
      childArgs: command.childArgs,
      cwd,
      env,
      promptInput,
      ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
      ...(dependencies.forceTerminationSignal === undefined
        ? {}
        : { forceTerminationSignal: dependencies.forceTerminationSignal }),
      ...(dependencies.terminationGraceMs === undefined
        ? {}
        : { terminationGraceMs: dependencies.terminationGraceMs }),
      ...(dependencies.inspectProcessGroup === undefined
        ? {}
        : { inspectProcessGroup: dependencies.inspectProcessGroup }),
      now,
      onSpawn: async (pid, processGroupId) => {
        repository.markRunning(runId, {
          recorderInstanceId,
          childPid: pid,
          childStartToken: null,
          childProcessGroupId: processGroupId,
          updatedAt: now()
        });
        markedRunning = true;
        const childStartToken = await processIdentityInspector.captureStartToken(pid);
        if (childStartToken === null) {
          throw new Error("AgentLens could not establish the child process start identity.");
        }
        if (!repository.setChildStartToken(runId, {
          recorderInstanceId,
          childPid: pid,
          childStartToken,
          updatedAt: now()
        })) throw new Error("Child process identity could not be attached to recorder ownership.");
      },
      onLine: (stream, line, receivedAt) => {
        const receivedAtIso = new Date(receivedAt).toISOString();
        const decoded = decodeCodexLine(line, stream);
        return enqueueDrafts(
          decoded.type === "diagnostic" ? [decoded.draft] : normalizeCodexRecord(decoded.record),
          receivedAtIso
        );
      },
      onDiagnostic: (diagnostic, receivedAt) => {
        return enqueueDrafts([{
          kind: "recorder.stream_diagnostic",
          status: "unknown",
          provenance: "recorder",
          source: { provider: "codex-exec", correlationId: runId },
          relationships: [],
          summary: "Oversized source line discarded",
          normalizedPayload: {
            stream: diagnostic.stream,
            reason: diagnostic.reason,
            limitBytes: diagnostic.limitBytes,
            observedBytes: diagnostic.observedBytes
          }
        }], new Date(receivedAt).toISOString());
      }
    });
    await lineQueue;
    if (hasEagerDerivationFailure) throw eagerDerivationFailure;
    if (heartbeatFailure) throw heartbeatFailure;

    if (childResult.explicitlyInterrupted) {
      const interruption = appendInterruption(repository, state, runId, iso(now), nextId);
      interruptionEventId = interruption.id;
    }

    const processEvent = appendInternalEvent(repository, state, {
      runId,
      receivedAt: iso(now),
      kind: "recorder.process_exit",
      status: processStatus(childResult),
      provenance: "recorder",
      source: { provider: "codex-exec", correlationId: runId },
      relationships: [],
      summary: "Child process terminal fact",
      normalizedPayload: {
        exitCode: childResult.exitCode,
        terminatingSignal: childResult.terminatingSignal,
        processGroupTermination: childResult.processGroupTermination
      }
    }, nextId);
    repository.recordProcessFact(runId, { eventId: processEvent.id });

    const after = await captureGitAfter(before);
    await persistFinalGit(before, after, initialStatus, gitContext, repository, state, nextId, iso(now), now());
    await dependencies.onFinalGitPersisted?.();
    if (dependencies.signal?.aborted && interruptionEventId === undefined) {
      interruptionEventId = appendInterruption(repository, state, runId, iso(now), nextId).id;
    }
    await appendRecoveriesForOpenEvents(
      repository,
      state,
      runId,
      iso(now),
      nextId,
      dependencies.onRecoveryAppended
    );
    if (dependencies.signal?.aborted && interruptionEventId === undefined) {
      interruptionEventId = appendInterruption(repository, state, runId, iso(now), nextId).id;
    }
    catchUpTestDerivations();
    const run = repository.reconcileRun(runId, {
      eventId: nextId(),
      receivedAt: iso(now),
      endedAt: now(),
      ...(state.providerTerminalEventId === undefined
        ? {}
        : { providerTerminalEventId: state.providerTerminalEventId }),
      ...(interruptionEventId === undefined ? {} : { interruptionEventId })
    });
    return result(run, databasePath);
  } catch (error) {
    const failurePhase = error instanceof ChildSpawnError ? "spawn" : "recording";
    if (error instanceof ProcessGroupTerminationError) {
      try {
        recorderFailureEventId = appendRecorderFailure(
          repository,
          state,
          runId,
          failurePhase,
          nextId,
          iso(now)
        ).id;
        if (dependencies.signal?.aborted && interruptionEventId === undefined) {
          interruptionEventId = appendInterruption(repository, state, runId, iso(now), nextId).id;
        }
        try {
          catchUpTestDerivations();
        } catch {
          // The process-group failure remains the primary fact when derivation storage is unusable.
        }
      } catch (persistenceError) {
        throw new AggregateError(
          [error, persistenceError],
          "AgentLens could not confirm process-group shutdown or persist the conservative failure.",
          { cause: error }
        );
      }
      throw error;
    }
    try {
      const failure = appendRecorderFailure(
        repository,
        state,
        runId,
        failurePhase,
        nextId,
        iso(now)
      );
      recorderFailureEventId = failure.id;

      if (initialStatus !== undefined && repository.getRunDetail(runId).gitEvidence === null) {
        try {
          const after = await captureGitAfter(before);
          await persistFinalGit(
            before,
            after,
            initialStatus,
            gitContext,
            repository,
            state,
            nextId,
            iso(now),
            now()
          );
        } catch {
          // The recorder-failure event still permits terminal reconciliation when final Git
          // evidence cannot be recovered (for example, if the child removed repository state).
        }
      }
      try {
        catchUpTestDerivations();
      } catch {
        // The original recorder failure remains primary when derivation storage is unusable.
      }
      if (markedRunning) {
        await appendRecoveriesForOpenEvents(
          repository,
          state,
          runId,
          iso(now),
          nextId,
          dependencies.onRecoveryAppended
        );
      }
      if (dependencies.signal?.aborted && interruptionEventId === undefined) {
        interruptionEventId = appendInterruption(repository, state, runId, iso(now), nextId).id;
      }
      const run = repository.reconcileRun(runId, {
        eventId: nextId(),
        receivedAt: iso(now),
        endedAt: now(),
        ...(state.providerTerminalEventId === undefined
          ? {}
          : { providerTerminalEventId: state.providerTerminalEventId }),
        ...(interruptionEventId === undefined ? {} : { interruptionEventId }),
        recorderFailureEventId
      });
      return result(run, databasePath);
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        "AgentLens recording failed and terminal reconciliation could not be persisted.",
        { cause: error }
      );
    }
  } finally {
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
    database.close();
    await ownerOnlyDatabaseFiles(databasePath);
  }
}
