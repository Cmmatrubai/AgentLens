import type { TrajectoryEventV1 } from "@agentlens/api-contract";

import type { TrajectoryLayoutRow } from "./types.js";

function eventKey(event: TrajectoryEventV1): string {
  return `${event.eventId}:${event.sequence}`;
}

function isGroupCandidate(event: TrajectoryEventV1): boolean {
  return (event.presentationClass === "lifecycle" ||
      event.presentationClass === "command" || event.presentationClass === "tool") &&
    event.lifecycleGroupKey !== null &&
    event.lifecycle !== null;
}

function compatibleLifecyclePair(start: TrajectoryEventV1, terminal: TrajectoryEventV1): boolean {
  if (!isGroupCandidate(start) || !isGroupCandidate(terminal) ||
      start.lifecycleGroupKey !== terminal.lifecycleGroupKey) return false;
  const startLifecycle = start.lifecycle;
  const terminalLifecycle = terminal.lifecycle;
  return startLifecycle?.phase === "started" && terminalLifecycle !== null &&
    terminalLifecycle.phase !== "started" && startLifecycle.domain === terminalLifecycle.domain &&
    start.presentationClass === terminal.presentationClass;
}

function lifecycleInstanceKey(start: TrajectoryEventV1, terminal: TrajectoryEventV1): string {
  return `lifecycle:${start.lifecycleGroupKey}:${eventKey(start)}:${eventKey(terminal)}`;
}

export function findTrajectoryRowIndex(
  rows: readonly TrajectoryLayoutRow[],
  eventId: string
): number {
  return rows.findIndex((row) => row.type === "event"
    ? row.event.eventId === eventId
    : row.events.some((event) => event.eventId === eventId));
}

export function projectTrajectory(input: Readonly<{
  events: readonly TrajectoryEventV1[];
  expandedGroupKeys: ReadonlySet<string>;
}>): readonly TrajectoryLayoutRow[] {
  for (let index = 1; index < input.events.length; index += 1) {
    if (input.events[index - 1]!.sequence >= input.events[index]!.sequence) {
      throw new Error("Trajectory events must remain in strict canonical sequence.");
    }
  }

  const rows: TrajectoryLayoutRow[] = [];
  for (let index = 0; index < input.events.length;) {
    const current = input.events[index]!;
    const candidateKey = current.lifecycleGroupKey;
    let candidateEnd = index;
    const previous = input.events[index - 1];
    const beginsCandidateSegment = previous === undefined || !isGroupCandidate(previous) ||
      previous.lifecycleGroupKey !== candidateKey;
    if (isGroupCandidate(current) && candidateKey !== null && beginsCandidateSegment) {
      while (candidateEnd + 1 < input.events.length) {
        const candidate = input.events[candidateEnd + 1]!;
        if (!isGroupCandidate(candidate) || candidate.lifecycleGroupKey !== candidateKey) break;
        candidateEnd += 1;
      }
    }
    const terminal = candidateEnd === index + 1 ? input.events[index + 1] : undefined;
    if (terminal !== undefined && compatibleLifecyclePair(current, terminal)) {
      const groupKey = lifecycleInstanceKey(current, terminal);
      if (!input.expandedGroupKeys.has(groupKey)) {
        rows.push({
          type: "lifecycle_group",
          key: groupKey,
          events: [current, terminal],
          expanded: false
        });
        index += 2;
        continue;
      }
    }
    rows.push({ type: "event", key: eventKey(current), event: current });
    index += 1;
  }
  return rows;
}
