import { readFile } from "node:fs/promises";
import { codexExecCapabilities, type TraceEventV1 } from "@agentlens/core";
import type { RunDetail, RunListRecord } from "@agentlens/storage";

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

export async function inspectJson(detail: RunDetail, native: boolean) {
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
      const body = await readFile(artifact.path, "utf8");
      return { ...event, nativeContent: JSON.parse(body) as unknown };
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
