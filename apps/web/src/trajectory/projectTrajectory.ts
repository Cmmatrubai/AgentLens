import type { TrajectoryEventV1 } from "@agentlens/api-contract";

import type { TrajectoryLayoutRow } from "./types.js";

function eventKey(event: TrajectoryEventV1): string {
  return `${event.eventId}:${event.sequence}`;
}

function canGroup(event: TrajectoryEventV1): boolean {
  return event.presentationClass === "lifecycle" &&
    event.kind !== "recorder.recovery" &&
    event.lifecycleGroupKey !== null;
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
    const groupKey = current.lifecycleGroupKey;
    if (canGroup(current) && groupKey !== null) {
      const siblings: TrajectoryEventV1[] = [current];
      let nextIndex = index + 1;
      while (nextIndex < input.events.length) {
        const next = input.events[nextIndex]!;
        if (!canGroup(next) || next.lifecycleGroupKey !== groupKey) break;
        siblings.push(next);
        nextIndex += 1;
      }
      if (siblings.length > 1 && !input.expandedGroupKeys.has(groupKey)) {
        rows.push({
          type: "lifecycle_group",
          key: groupKey,
          events: siblings as [TrajectoryEventV1, ...TrajectoryEventV1[]],
          expanded: false
        });
        index = nextIndex;
        continue;
      }
    }
    rows.push({ type: "event", key: eventKey(current), event: current });
    index += 1;
  }
  return rows;
}
