import type { TrajectoryEventV1 } from "@agentlens/api-contract";

export type TrajectoryRelationship = TrajectoryEventV1["relationships"][number];

export function uniqueRelationships(
  relationships: readonly TrajectoryRelationship[]
): readonly TrajectoryRelationship[] {
  const seen = new Set<string>();
  return relationships.filter((relationship) => {
    const identity = `${relationship.type}\u0000${relationship.eventId}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
