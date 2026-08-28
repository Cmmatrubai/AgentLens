import { randomUUID } from "node:crypto";
import { ArtifactStore, loadOrCreateRedactionKey, type CapturePolicy } from "@agentlens/core";
import {
  type RequiredGitEvidenceRef,
  type RunDetail,
  type RunRepository
} from "@agentlens/storage";
import { captureGitAfter, resolveGitRepositoryRoot, type GitBeforeEvidence } from "./gitEvidence.js";
import {
  systemProcessIdentityInspector,
  type ProcessIdentityInspector
} from "./processIdentity.js";
import {
  persistFinalGit,
  redactedBranch,
  repositoryFingerprint,
  type GitPersistenceContext,
  type RecordingState
} from "./recordRun.js";

type ChildState = "alive" | "gone" | "ambiguous";

export interface RecoverStaleRunsInput {
  readonly repository: RunRepository;
  readonly dataRoot: string;
  readonly cwd: string;
  readonly now?: () => number;
  readonly nextId?: () => string;
  readonly recorderPid?: number;
  readonly processIdentityInspector?: ProcessIdentityInspector;
}

export interface RecoverySweepResult {
  readonly recoveredRunIds: readonly string[];
  readonly orphanRunIds: readonly string[];
  readonly ambiguousRunIds: readonly string[];
}

function iso(now: () => number): string {
  return new Date(now()).toISOString();
}

function initialGitSnapshot(detail: RunDetail): {
  initialHead: string;
  initialBranch: string | null;
  initialStatus: RequiredGitEvidenceRef;
} | null {
  const event = detail.events.find(({ kind, provenance }) =>
    kind === "git.snapshot" && provenance === "git_recovered"
  );
  if (
    !event ||
    typeof event.normalizedPayload !== "object" ||
    event.normalizedPayload === null ||
    Array.isArray(event.normalizedPayload)
  ) return null;
  const payload = event.normalizedPayload as Record<string, unknown>;
  const initialHead = payload.initialHead;
  const initialBranch = payload.initialBranch;
  const initialStatus = payload.initialStatus;
  if (
    typeof initialHead !== "string" ||
    !(initialBranch === null || typeof initialBranch === "string") ||
    typeof initialStatus !== "object" ||
    initialStatus === null ||
    !("state" in initialStatus)
  ) return null;
  const state = (initialStatus as { state?: unknown }).state;
  if (state === "artifact" && typeof (initialStatus as { artifactId?: unknown }).artifactId === "string") {
    return { initialHead, initialBranch, initialStatus: initialStatus as RequiredGitEvidenceRef };
  }
  const reason = (initialStatus as { reason?: unknown }).reason;
  if (state === "omitted" && (reason === "metadata-only" || reason === "strict")) {
    return { initialHead, initialBranch, initialStatus: initialStatus as RequiredGitEvidenceRef };
  }
  return null;
}

async function childState(
  detail: RunDetail,
  inspector: ProcessIdentityInspector
): Promise<ChildState> {
  const ownership = detail.ownership;
  if (!ownership || ownership.childPid === null) return "gone";

  const group = ownership.childProcessGroupId === null
    ? "gone"
    : inspector.inspectGroup(ownership.childProcessGroupId);
  if (group === "alive") return "alive";

  if (ownership.childStartToken === null) {
    return group === "gone" ? "gone" : "ambiguous";
  }
  const processState = await inspector.inspect(ownership.childPid, ownership.childStartToken);
  if (processState === "same") return "alive";
  if (processState === "ambiguous" || group === "ambiguous") return "ambiguous";
  return "gone";
}

async function captureFinalGitWhenSafe(
  detail: RunDetail,
  input: RecoverStaleRunsInput,
  key: Buffer,
  state: RecordingState,
  nextId: () => string,
  now: () => number
): Promise<void> {
  if (detail.gitEvidence !== null) return;
  const initial = initialGitSnapshot(detail);
  if (!initial) return;
  const repositoryRoot = await resolveGitRepositoryRoot(input.cwd);
  if (repositoryFingerprint(repositoryRoot, key) !== detail.run.repositoryFingerprint) return;

  const before: GitBeforeEvidence = Object.freeze({
    repositoryRoot,
    initialHead: initial.initialHead,
    initialBranch: initial.initialBranch,
    initialStatus: ""
  });
  const after = await captureGitAfter(before);
  const artifactStore = new ArtifactStore(input.dataRoot);
  const context: GitPersistenceContext = {
    runId: detail.run.id,
    capturePolicy: detail.run.capturePolicy as CapturePolicy,
    key,
    artifactStore,
    repository: input.repository,
    committedArtifactIds: new Set(detail.artifacts.map(({ id }) => id))
  };
  const storedFinalBranch = redactedBranch(after.finalBranch, detail.run.capturePolicy, key);
  await persistFinalGit(
    before,
    after,
    initial.initialStatus,
    context,
    input.repository,
    state,
    nextId,
    iso(now),
    now(),
    {
      storedInitialBranch: initial.initialBranch,
      branchChanged: storedFinalBranch !== initial.initialBranch
    }
  );
}

export async function recoverStaleRuns(
  input: RecoverStaleRunsInput
): Promise<RecoverySweepResult> {
  const ownerships = input.repository.listNonterminalOwnership();
  if (ownerships.length === 0) {
    return Object.freeze({ recoveredRunIds: [], orphanRunIds: [], ambiguousRunIds: [] });
  }

  const now = input.now ?? Date.now;
  const nextId = input.nextId ?? randomUUID;
  const recorderPid = input.recorderPid ?? process.pid;
  const inspector = input.processIdentityInspector ?? systemProcessIdentityInspector;
  const key = await loadOrCreateRedactionKey(input.dataRoot);
  const recoveredRunIds: string[] = [];
  const orphanRunIds: string[] = [];
  const ambiguousRunIds: string[] = [];

  for (const ownership of ownerships) {
    const recorderState = await inspector.inspect(
      ownership.recorderPid,
      ownership.recorderStartToken
    );
    if (recorderState === "same") continue;
    if (recorderState === "ambiguous") {
      input.repository.markOwnershipIdentityAmbiguous(ownership.runId, {
        recorderInstanceId: ownership.recorderInstanceId,
        updatedAt: now()
      });
      ambiguousRunIds.push(ownership.runId);
      continue;
    }

    const lossResult = input.repository.appendOwnershipLossIfCurrent(ownership.runId, {
      expectedRecorderInstanceId: ownership.recorderInstanceId,
      eventId: nextId(),
      receivedAt: iso(now)
    });
    if (lossResult.kind === "already_terminal" || lossResult.kind === "ownership_changed") {
      continue;
    }
    const loss = lossResult.event;
    const detail = input.repository.getRunDetail(ownership.runId);
    const child = await childState(detail, inspector);
    if (child === "alive") {
      input.repository.markOrphanChildActive(ownership.runId, {
        recorderInstanceId: ownership.recorderInstanceId,
        updatedAt: now()
      });
      orphanRunIds.push(ownership.runId);
      continue;
    }
    if (child === "ambiguous") {
      input.repository.markOwnershipIdentityAmbiguous(ownership.runId, {
        recorderInstanceId: ownership.recorderInstanceId,
        updatedAt: now()
      });
      ambiguousRunIds.push(ownership.runId);
      continue;
    }

    const recoveryStartToken = await inspector.captureStartToken(recorderPid);
    if (recoveryStartToken === null) {
      input.repository.markOwnershipIdentityAmbiguous(ownership.runId, {
        recorderInstanceId: ownership.recorderInstanceId,
        updatedAt: now()
      });
      ambiguousRunIds.push(ownership.runId);
      continue;
    }
    const recoveryInstanceId = nextId();
    const claimed = input.repository.claimRecoveryOwnership(ownership.runId, {
      expectedRecorderInstanceId: ownership.recorderInstanceId,
      recovery: {
        recorderInstanceId: recoveryInstanceId,
        recorderPid,
        recorderStartToken: recoveryStartToken,
        heartbeatAt: now()
      }
    });
    if (!claimed) continue;

    const claimedDetail = input.repository.getRunDetail(ownership.runId);
    const state: RecordingState = {
      sequence: claimedDetail.events.reduce(
        (nextSequence, event) => Math.max(nextSequence, event.sequence + 1),
        0
      )
    };
    try {
      await captureFinalGitWhenSafe(claimedDetail, input, key, state, nextId, now);
    } catch {
      // Recovery remains truthful when the matching repository is unavailable or unsafe.
    }
    input.repository.appendRecoveryForOpenEvents(ownership.runId, {
      receivedAt: iso(now),
      eventIdFor: () => nextId()
    });
    const terminalDetail = input.repository.getRunDetail(ownership.runId);
    const providerTerminal = [...terminalDetail.events].reverse().find((event) =>
      event.provenance === "observed" &&
      (event.kind === "turn.completed" || event.kind === "turn.failed")
    );
    input.repository.reconcileRun(ownership.runId, {
      eventId: nextId(),
      receivedAt: iso(now),
      endedAt: now(),
      recorderCrashEventId: loss.id,
      ...(providerTerminal === undefined ? {} : { providerTerminalEventId: providerTerminal.id })
    });
    recoveredRunIds.push(ownership.runId);
  }

  return Object.freeze({ recoveredRunIds, orphanRunIds, ambiguousRunIds });
}
