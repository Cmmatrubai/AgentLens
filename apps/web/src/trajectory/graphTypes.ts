import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import type { RecorderTiming } from "./types.js";

export interface ExecutionGraph {
  readonly nodes: readonly ExecutionGraphNode[];
  readonly edges: readonly ExecutionGraphEdge[];
  readonly eventNodeIndex: ReadonlyMap<string, number>;
}

export interface ExecutionGraphNode {
  readonly key: string;
  readonly type: "event" | "lifecycle_group" | "routine_cluster";
  readonly events: readonly TrajectoryEventV1[];
  readonly expanded: boolean;
  readonly weight: "routine" | "action" | "landmark";
  readonly lane: 0 | 1;
  readonly estimatedHeight: number;
  readonly recorderTiming?: RecorderTiming;
}

export interface ExecutionGraphEdge {
  readonly key: string;
  readonly sourceEventId: string;
  readonly targetEventId: string;
  readonly type: TrajectoryEventV1["relationships"][number]["type"];
  readonly sourceNodeIndex: number;
  readonly targetNodeIndex: number | null;
}
