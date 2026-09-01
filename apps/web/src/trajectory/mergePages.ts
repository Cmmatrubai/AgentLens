import type { TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";

import type { PreservedTrajectoryAnchor, TrajectoryAnchor } from "./types.js";

function equalEvent(left: TrajectoryEventV1, right: TrajectoryEventV1): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entry]) => [key, canonical(entry)]));
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
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
    if (page.window.latestCommittedSequence < page.window.maxSequence) {
      throw new Error("Trajectory window snapshot precedes its items.");
    }
  } else if (page.items.length !== 0) {
    throw new Error("Trajectory window metadata does not match its items.");
  }
  if (page.window.hasEarlier !== (page.window.earlierCursor !== null) ||
      page.window.hasLater !== (page.window.laterCursor !== null)) {
    throw new Error("Trajectory window cursor metadata is incompatible.");
  }
}

function validateTopology(pages: readonly TrajectoryPageV1[]): void {
  const lineage = pages.filter((page) =>
    page.mode === "head" || page.mode === "tail" || page.mode === "cursor"
  );
  const snapshot = lineage[0]?.window.latestCommittedSequence;
  if (snapshot !== undefined && lineage.some((page) => page.window.latestCommittedSequence !== snapshot)) {
    throw new Error("Trajectory cursor snapshot lineage is incompatible.");
  }
  const windows = pages.filter((page) => page.window.state === "nonempty")
    .sort((left, right) => {
      if (left.window.state !== "nonempty" || right.window.state !== "nonempty") return 0;
      return left.window.minSequence - right.window.minSequence;
    });
  for (let index = 0; index < windows.length - 1; index += 1) {
    const left = windows[index]!;
    const right = windows[index + 1]!;
    if (left.window.state !== "nonempty" || right.window.state !== "nonempty") continue;
    if (left.window.maxSequence + 1 < right.window.minSequence &&
        (left.window.laterCursor === null || right.window.earlierCursor === null)) {
      throw new Error("Trajectory page gap lacks compatible bounded cursors.");
    }
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
  validateTopology(pages);
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
