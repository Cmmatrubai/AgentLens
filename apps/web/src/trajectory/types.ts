import type { TrajectoryEventV1 } from "@agentlens/api-contract";

export type TrajectoryLayoutRow =
  | Readonly<{
      type: "event";
      key: string;
      event: TrajectoryEventV1;
    }>
  | Readonly<{
      type: "lifecycle_group";
      key: string;
      events: readonly [TrajectoryEventV1, ...TrajectoryEventV1[]];
      expanded: boolean;
    }>;

export type TrajectoryAnchor = Readonly<{
  eventId: string;
  offsetFromViewportTop: number;
}>;

export type PreservedTrajectoryAnchor = TrajectoryAnchor & Readonly<{ index: number }>;
