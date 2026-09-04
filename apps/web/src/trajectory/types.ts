import type { TrajectoryEventV1 } from "@agentlens/api-contract";

export type RecorderTiming =
  | Readonly<{
      state: "available";
      elapsedMs: number;
      basis: "recorder_received_at";
      provenance: "derived";
      supportingEventIds: readonly [string, string];
    }>
  | Readonly<{
      state: "unavailable";
      reason: "missing_pair" | "invalid_recorder_time";
    }>;

export type TrajectoryLayoutRow =
  | Readonly<{
      type: "event";
      key: string;
      event: TrajectoryEventV1;
      recorderTiming: RecorderTiming;
    }>
  | Readonly<{
      type: "lifecycle_group";
      key: string;
      events: readonly [TrajectoryEventV1, ...TrajectoryEventV1[]];
      expanded: boolean;
      recorderTiming: RecorderTiming;
    }>;

export type TrajectoryAnchor = Readonly<{
  eventId: string;
  offsetFromViewportTop: number;
}>;

export type PreservedTrajectoryAnchor = TrajectoryAnchor & Readonly<{ index: number }>;
