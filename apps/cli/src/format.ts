import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codexExecCapabilities, type TraceEventV1 } from "@agentlens/core";
import type { RunDetail, RunListRecord, StoredArtifact } from "@agentlens/storage";

export interface RunsJsonOutput {
  readonly runs: readonly ReturnType<typeof runListJson>[];
}

function runListJson(run: RunListRecord) {
  return {
    id: run.id,
    status: run.status,
    provider: run.provider,
    startedAt: new Date(run.startedAt).toISOString(),
    durationMs: run.endedAt === null ? null : Math.max(0, run.endedAt - run.startedAt),
    child: {
      exitCode: run.exitCode,
      terminatingSignal: run.terminatingSignal
    },
    git: {
      headChanged: run.headChanged,
      branchChanged: run.branchChanged
    },
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
    const git = `HEAD changed=${String(run.headChanged)} branch changed=${String(run.branchChanged)}`;
    return `${run.id}  ${run.status}  ${run.provider}  ${new Date(run.startedAt).toISOString()}  ${child}  ${git}`;
  }).join("\n")}\n`;
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
    artifact.redactionState !== "redacted"
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
    capabilities: { ...codexExecCapabilities },
    contradictions: [...detail.run.contradictionCodes],
    events,
    gitEvidence: {
      terminology: {
        trackedFinalDiff: "tracked final diff",
        untrackedMetadata: "untracked-file metadata"
      },
      provenance: "git_recovered" as const,
      available: git !== null,
      ...(git === null ? {} : {
        initialHead: git.initialHead,
        finalHead: git.finalHead,
        initialBranch: git.initialBranch,
        finalBranch: git.finalBranch,
        headChanged: git.headChanged,
        branchChanged: git.branchChanged,
        initialStatus: git.initialStatus,
        finalStatus: git.finalStatus,
        trackedFinalDiff: git.trackedFinalDiff,
        diffCheck: git.diffCheck,
        diffCheckPassed: git.diffCheckPassed,
        untrackedMetadata: git.untrackedMetadata
      })
    },
    artifacts: detail.artifacts,
    redactionAudits: detail.redactionAudits
  };
}

export function inspectText(
  detail: RunDetail,
  events: readonly (TraceEventV1 & { readonly nativeContent?: unknown })[] = detail.events
): string {
  const git = detail.gitEvidence;
  const lines = [
    `Run ${detail.run.id}`,
    `Status: ${detail.run.status}`,
    `Provider: ${detail.run.provider}`,
    `Child: exit=${String(detail.run.exitCode)} signal=${String(detail.run.terminatingSignal)}`,
    `Contradictions: ${detail.run.contradictionCodes.join(", ") || "none"}`,
    "Git terminology: tracked final diff + untracked-file metadata",
    `Git evidence: ${git === null ? "unavailable" : `HEAD changed=${git.headChanged}, branch changed=${git.branchChanged}`}`,
    "Capabilities: file reads unavailable; tool output partial; tool durations unavailable; interruption signal partial",
    "Events:"
  ];
  for (const event of events) {
    lines.push(
      `${event.sequence} [${provenanceLabel(event)}] ${event.kind} ${event.status} — ${event.summary}`
    );
    if (event.relationships.length > 0) {
      lines.push(`  relationships: ${event.relationships.map(({ type, eventId }) => `${type}:${eventId}`).join(", ")}`);
    }
    if (event.nativeContent !== undefined) {
      lines.push(`  native: ${JSON.stringify(event.nativeContent)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
