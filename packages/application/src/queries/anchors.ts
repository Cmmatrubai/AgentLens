import type { RunDetailV1 } from "@agentlens/api-contract";
import type { TraceEventV1 } from "@agentlens/core";

type RunAnchorsV1 = RunDetailV1["anchors"];

function anchor(event: TraceEventV1 | undefined): { eventId: string; sequence: number } | null {
  return event === undefined ? null : { eventId: event.id, sequence: event.sequence };
}

function chronological(events: readonly TraceEventV1[]): TraceEventV1[] {
  return [...events].sort((left, right) =>
    left.sequence - right.sequence ||
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.id.localeCompare(right.id)
  );
}

export function projectRunAnchors(events: readonly TraceEventV1[]): RunAnchorsV1 {
  const ordered = chronological(events);
  return Object.freeze({
    firstFailure: anchor(ordered.find(({ status }) => status === "failed")),
    recorderRecovery: anchor(ordered.find(({ kind }) => kind === "recorder.recovery")),
    latestLikelyTest: anchor(ordered.filter(({ kind }) => kind === "test.result").at(-1)),
    finalGitEvidence: anchor(ordered.filter(({ kind }) => kind === "git.final_evidence").at(-1)),
    latestEvent: anchor(ordered.at(-1))
  });
}
