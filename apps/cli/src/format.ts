import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codexExecCapabilities, type TraceEventV1 } from "@agentlens/core";
import type { RunDetail, RunListRecord, StoredArtifact } from "@agentlens/storage";

export interface RunsJsonOutput {
  readonly runs: readonly ReturnType<typeof runListJson>[];
}

function runDurationMs(run: RunListRecord): number | null {
  return run.endedAt === null ? null : Math.max(0, run.endedAt - run.startedAt);
}

function runListJson(run: RunListRecord) {
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
    ownership: { condition: run.ownershipCondition },
    capabilities: { ...codexExecCapabilities }
  };
}

export function runsJson(runs: readonly RunListRecord[]): RunsJsonOutput {
  return { runs: runs.map(runListJson) };
}

function provenanceLabel(event: TraceEventV1): string {
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

export function runsText(runs: readonly RunListRecord[]): string {
  if (runs.length === 0) return "No AgentLens runs found.\n";
  return `${runs.map((run) => {
    const child = run.terminatingSignal ?? (run.exitCode === null ? "pending" : `exit ${run.exitCode}`);
    const duration = runDurationMs(run);
    const git = `HEAD changed=${String(run.headChanged)} branch changed=${String(run.branchChanged)}`;
    return `${run.id}  ${run.status}  ${run.provider}  ${new Date(run.startedAt).toISOString()}  duration=${duration === null ? "null" : `${duration}ms`}  ${child}  ownership=${run.ownershipCondition ?? "unavailable"}  ${git}`;
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
  if (
    !/^[0-9a-f]{64}$/.test(artifact.id) ||
    artifact.sha256 !== artifact.id ||
    artifact.kind !== "native-payload" ||
    artifact.mediaType !== "application/json" ||
    artifact.redactionState !== "redacted" ||
    (artifact.truncated
      ? artifact.originalByteLength <= artifact.byteLength
      : artifact.originalByteLength !== artifact.byteLength)
  ) {
    throw new Error(`Native artifact ${artifact.id} has invalid metadata.`);
  }

  const configuredRoot = resolve(artifactRoot);
  const expectedPath = join(configuredRoot, artifact.id.slice(0, 2), artifact.id);
  if (artifact.path !== expectedPath || resolve(artifact.path) !== expectedPath) {
    throw new Error(`Native artifact ${artifact.id} metadata path is not canonical.`);
  }

  const pathStat = await lstat(expectedPath);
  if (pathStat.isSymbolicLink()) throw new Error(`Native artifact ${artifact.id} cannot be symbolic.`);
  const [canonicalRoot, canonicalPath] = await Promise.all([
    realpath(configuredRoot),
    realpath(expectedPath)
  ]);
  if (canonicalPath !== join(canonicalRoot, artifact.id.slice(0, 2), artifact.id)) {
    throw new Error(`Native artifact ${artifact.id} canonical path escapes the artifact root.`);
  }

  const handle = await open(expectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== pathStat.dev ||
      stat.ino !== pathStat.ino ||
      stat.size !== artifact.byteLength
    ) {
      throw new Error(`Native artifact ${artifact.id} file identity or byte length is invalid.`);
    }
    const bytes = await handle.readFile();
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== artifact.id) throw new Error(`Native artifact ${artifact.id} digest is invalid.`);
    if (artifact.truncated) {
      return Object.freeze({
        state: "truncated" as const,
        truncated: true as const,
        storedByteLength: artifact.byteLength,
        originalByteLength: artifact.originalByteLength
      });
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

export async function inspectJson(detail: RunDetail, native: boolean, artifactRoot?: string) {
  if (native && detail.run.capturePolicy !== "standard") {
    throw new Error("--native is available only for runs recorded with standard capture.");
  }
  const artifacts = new Map(detail.artifacts.map((artifact) => [artifact.id, artifact]));
  const events = await Promise.all(detail.events.map(async (event) => {
    if (!native || event.nativePayload === undefined) return { ...event };
    if (event.nativePayload.storage === "inline") {
      return { ...event, nativeContent: event.nativePayload.redacted };
    }
    if (event.nativePayload.storage === "artifact") {
      const artifact = artifacts.get(event.nativePayload.artifactId);
      if (!artifact) throw new Error(`Native artifact ${event.nativePayload.artifactId} is unavailable.`);
      if (!artifactRoot) throw new Error("Native artifact root is required for expansion.");
      return { ...event, nativeContent: await readValidatedNativeArtifact(artifact, artifactRoot) };
    }
    return { ...event };
  }));
  const git = detail.gitEvidence;
  return {
    run: detail.run,
    ownership: detail.ownership,
    metadataSemantics: metadataSemantics(detail.run),
    capabilities: { ...codexExecCapabilities },
    contradictions: [...detail.run.contradictionCodes],
    warnings: gitWarnings(git),
    events,
    gitEvidence: inspectGitEvidence(git),
    artifacts: detail.artifacts,
    redactionAudits: detail.redactionAudits
  };
}

export function inspectText(
  detail: RunDetail,
  events: readonly (TraceEventV1 & { readonly nativeContent?: unknown })[] = detail.events
): string {
  const git = detail.gitEvidence;
  const warnings = gitWarnings(git);
  const semantics = metadataSemantics(detail.run);
  const lines = [
    `Run ${detail.run.id}`,
    `Status: ${detail.run.status}`,
    `Provider: ${detail.run.provider}`,
    `Child: exit=${String(detail.run.exitCode)} signal=${String(detail.run.terminatingSignal)}`,
    `Ownership: ${detail.ownership?.condition ?? "unavailable"}`,
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
  }
  return `${lines.join("\n")}\n`;
}
