import type { RunDetailV1, TrajectoryEventV1 } from "@agentlens/api-contract";

export function initialGraphEventId(
  anchors: RunDetailV1["anchors"],
  events: readonly TrajectoryEventV1[]
): string | null {
  return anchors.firstFailure?.eventId ??
    anchors.recorderRecovery?.eventId ??
    anchors.latestLikelyTest?.eventId ??
    events[0]?.eventId ??
    null;
}
