import type { TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";

import type { PreservedTrajectoryAnchor, TrajectoryAnchor } from "./types.js";

function equalEvent(left: TrajectoryEventV1, right: TrajectoryEventV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePage(page: TrajectoryPageV1): void {
  for (let index = 0; index < page.items.length; index += 1) {
    const item = page.items[index]!;
    if (item.runId !== page.runId) throw new Error("Trajectory page item does not belong to the same run.");
    if (index > 0 && page.items[index - 1]!.sequence >= item.sequence) {
      throw new Error("Trajectory page items violate canonical sequence.");
    }
  }
  if (page.window.state === "nonempty") {
    const first = page.items[0];
    const last = page.items.at(-1);
    if (first === undefined || last === undefined ||
        first.sequence !== page.window.minSequence || last.sequence !== page.window.maxSequence) {
      throw new Error("Trajectory window metadata does not match its items.");
    }
  } else if (page.items.length !== 0) {
    throw new Error("Trajectory window metadata does not match its items.");
  }
}

export function mergeTrajectoryPages(
  pages: readonly TrajectoryPageV1[]
): readonly TrajectoryEventV1[] {
  if (pages.length === 0) return [];
  const runId = pages[0]!.runId;
  const byId = new Map<string, TrajectoryEventV1>();
  const bySequence = new Map<number, TrajectoryEventV1>();
  for (const page of pages) {
    if (page.runId !== runId) throw new Error("Trajectory pages must belong to the same run.");
    validatePage(page);
    for (const event of page.items) {
      const idMatch = byId.get(event.eventId);
      const sequenceMatch = bySequence.get(event.sequence);
      if (idMatch !== undefined && idMatch.sequence !== event.sequence) {
        throw new Error("Trajectory event ID maps to contradictory sequences.");
      }
      if (sequenceMatch !== undefined && sequenceMatch.eventId !== event.eventId) {
        throw new Error("Trajectory sequence maps to contradictory event IDs.");
      }
      if (idMatch !== undefined && !equalEvent(idMatch, event)) {
        throw new Error("Trajectory contains a contradictory duplicate event.");
      }
      if (idMatch === undefined) {
        byId.set(event.eventId, event);
        bySequence.set(event.sequence, event);
      }
    }
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function preserveTrajectoryAnchor(
  _previous: readonly TrajectoryEventV1[],
  next: readonly TrajectoryEventV1[],
  anchor: TrajectoryAnchor
): PreservedTrajectoryAnchor | null {
  const index = next.findIndex(({ eventId }) => eventId === anchor.eventId);
  return index === -1 ? null : { ...anchor, index };
}
