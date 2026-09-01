import type { TrajectoryEventV1 } from "@agentlens/api-contract";

import type { TrajectoryLayoutRow } from "./types.js";

function eventKey(event: TrajectoryEventV1): string {
  return `${event.eventId}:${event.sequence}`;
}

function isGroupCandidate(event: TrajectoryEventV1): boolean {
  return event.kind !== "recorder.recovery" &&
    event.lifecycleGroupKey !== null &&
    lifecyclePhase(event) !== null;
}

function lifecyclePhase(event: TrajectoryEventV1): Readonly<{
  domain: "thread" | "turn" | "command" | "tool";
  phase: "started" | "completed" | "failed" | "declined" | "interrupted";
}> | null {
  const match = /^(thread|turn)\.(started|completed|failed|declined|interrupted)$/.exec(event.kind);
  if (match !== null && event.presentationClass === "lifecycle") {
    return {
      domain: match[1] as "thread" | "turn",
      phase: match[2] as "started" | "completed" | "failed" | "declined" | "interrupted"
    };
  }
  if (event.presentationClass !== "command" && event.presentationClass !== "tool") return null;
  if (event.status.state !== "known" || event.status.value === "unknown") return null;
  return {
    domain: event.presentationClass,
    phase: event.status.value === "in_progress" ? "started" : event.status.value
  };
}

function compatibleLifecyclePair(start: TrajectoryEventV1, terminal: TrajectoryEventV1): boolean {
  if (!isGroupCandidate(start) || !isGroupCandidate(terminal) ||
      start.lifecycleGroupKey !== terminal.lifecycleGroupKey) return false;
  const startPhase = lifecyclePhase(start);
  const terminalPhase = lifecyclePhase(terminal);
  if (startPhase?.phase !== "started" || terminalPhase === null ||
      terminalPhase.phase === "started" || startPhase.domain !== terminalPhase.domain) return false;
  return start.status.state === "known" && start.status.value === "in_progress" &&
    terminal.status.state === "known" && terminal.status.value === terminalPhase.phase;
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
