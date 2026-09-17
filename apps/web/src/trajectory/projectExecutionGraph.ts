import type { TrajectoryEventV1 } from "@agentlens/api-contract";

import type {
  ExecutionGraph,
  ExecutionGraphEdge,
  ExecutionGraphNode
} from "./graphTypes.js";
import { projectTrajectory } from "./projectTrajectory.js";

type ExecutionWeight = ExecutionGraphNode["weight"];

function eventKey(event: TrajectoryEventV1): string {
  return `${event.eventId}:${event.sequence}`;
}

function relationshipKey(
  sourceEventId: string,
  type: TrajectoryEventV1["relationships"][number]["type"],
  targetEventId: string
): string {
  return `relationship:${encodeURIComponent(sourceEventId)}:${type}:${encodeURIComponent(targetEventId)}`;
}

function isFailure(event: TrajectoryEventV1): boolean {
  return event.status.state === "known" &&
      (event.status.value === "failed" || event.status.value === "declined" ||
        event.status.value === "interrupted") ||
    event.lifecycle?.phase === "failed" || event.lifecycle?.phase === "declined" ||
    event.lifecycle?.phase === "interrupted";
}

function eventWeight(event: TrajectoryEventV1): ExecutionWeight {
  if (isFailure(event) || event.provenance === "human") return "landmark";
  switch (event.presentationClass) {
    case "message":
    case "reasoning":
      return "routine";
    case "git":
    case "recorder_recovery":
    case "test":
    case "assessment":
    case "error":
    case "unknown":
      return "landmark";
    default:
      return "action";
  }
}

function weightForEvents(events: readonly TrajectoryEventV1[]): ExecutionWeight {
  const weights = events.map(eventWeight);
  if (weights.includes("landmark")) return "landmark";
  if (weights.includes("action")) return "action";
  return "routine";
}

function estimatedHeight(
  weight: ExecutionWeight,
  expanded: boolean,
  memberCount: number
): number {
  const base = weight === "routine" ? 128 : weight === "action" ? 160 : 184;
  return expanded ? base + Math.max(0, memberCount - 1) * 64 : base;
}

function isRoutineClusterCandidate(
  event: TrajectoryEventV1,
  relationshipEndpointIds: ReadonlySet<string>
): boolean {
  return (event.presentationClass === "message" || event.presentationClass === "reasoning") &&
    event.status.state === "known" && event.status.value === "completed" &&
    event.provenance === "observed" && event.relationships.length === 0 &&
    event.lifecycle === null && event.derivation === null &&
    !relationshipEndpointIds.has(event.eventId);
}

export function projectExecutionGraph(input: Readonly<{
  events: readonly TrajectoryEventV1[];
  expandedGroupKeys: ReadonlySet<string>;
  clusterRoutine?: boolean;
}>): ExecutionGraph {
  const loadedEventIds = new Set(input.events.map(({ eventId }) => eventId));
  const relationshipEndpointIds = new Set<string>();
  for (const event of input.events) {
    if (event.relationships.length > 0) relationshipEndpointIds.add(event.eventId);
    for (const relationship of event.relationships) {
      if (loadedEventIds.has(relationship.eventId)) {
        relationshipEndpointIds.add(relationship.eventId);
      }
    }
  }
  const rows = projectTrajectory({
    events: input.events,
    expandedGroupKeys: input.expandedGroupKeys
  });
  const nodeForEvents = (
    key: string,
    type: ExecutionGraphNode["type"],
    events: readonly TrajectoryEventV1[],
    expanded: boolean
  ): ExecutionGraphNode => {
    const weight = weightForEvents(events);
    return {
      key,
      type,
      events,
      expanded,
      weight,
      lane: 0,
      estimatedHeight: estimatedHeight(weight, expanded, events.length)
    };
  };
  const baseNodes = rows.flatMap((row): ExecutionGraphNode[] => {
    const events = row.type === "event" ? [row.event] : row.events;
    if (row.type === "lifecycle_group" && events.some((event) =>
      isFailure(event) || relationshipEndpointIds.has(event.eventId))) {
      return events.map((event, index) => ({
        ...nodeForEvents(eventKey(event), "event", [event], false),
        ...(index === events.length - 1 ? { recorderTiming: row.recorderTiming } : {})
      }));
    }
    const expanded = row.type === "lifecycle_group" && row.expanded;
    return [{ ...nodeForEvents(row.key, row.type, events, expanded), recorderTiming: row.recorderTiming }];
  });
  const nodes: ExecutionGraphNode[] = [];
  for (let index = 0; index < baseNodes.length;) {
    const current = baseNodes[index]!;
    const currentEvent = current.type === "event" ? current.events[0] : undefined;
    if (input.clusterRoutine !== false && currentEvent !== undefined &&
        isRoutineClusterCandidate(currentEvent, relationshipEndpointIds)) {
      const candidates = [currentEvent];
      while (candidates.length < 6 && index + candidates.length < baseNodes.length) {
        const nextNode = baseNodes[index + candidates.length]!;
        const nextEvent = nextNode.type === "event" ? nextNode.events[0] : undefined;
        const previousEvent = candidates.at(-1)!;
        if (nextEvent === undefined ||
            !isRoutineClusterCandidate(nextEvent, relationshipEndpointIds) ||
            nextEvent.presentationClass !== currentEvent.presentationClass ||
            nextEvent.sequence !== previousEvent.sequence + 1) break;
        candidates.push(nextEvent);
      }
      if (candidates.length >= 3) {
        const key = `routine:${eventKey(currentEvent)}`;
        nodes.push(nodeForEvents(
          key,
          "routine_cluster",
          candidates,
          input.expandedGroupKeys.has(key)
        ));
        index += candidates.length;
        continue;
      }
    }
    nodes.push(current);
    index += 1;
  }
  const eventNodeIndex = new Map<string, number>();
  nodes.forEach((node, index) => {
    for (const member of node.events) eventNodeIndex.set(member.eventId, index);
  });

  const edges: ExecutionGraphEdge[] = [];
  const seenEdges = new Set<string>();
  const backwardSourceNodeIndexes = new Set<number>();
  for (const event of input.events) {
    const sourceNodeIndex = eventNodeIndex.get(event.eventId)!;
    for (const relationship of event.relationships) {
      if (relationship.eventId === event.eventId) continue;
      const identity = `${event.eventId}\u0000${relationship.type}\u0000${relationship.eventId}`;
      if (seenEdges.has(identity)) continue;
      seenEdges.add(identity);
      const targetNodeIndex = eventNodeIndex.get(relationship.eventId) ?? null;
      if (targetNodeIndex !== null && targetNodeIndex < sourceNodeIndex) {
        backwardSourceNodeIndexes.add(sourceNodeIndex);
      }
      edges.push({
        key: relationshipKey(event.eventId, relationship.type, relationship.eventId),
        sourceEventId: event.eventId,
        targetEventId: relationship.eventId,
        type: relationship.type,
        sourceNodeIndex,
        targetNodeIndex
      });
    }
  }
  const positionedNodes = nodes.map((node, index): ExecutionGraphNode =>
    backwardSourceNodeIndexes.has(index) ? { ...node, lane: 1 } : node);

  return { nodes: positionedNodes, edges, eventNodeIndex };
}
