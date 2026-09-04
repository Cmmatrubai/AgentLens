import type {
  EventDetailV1,
  TrajectoryEventV1,
  TrajectoryPageV1
} from "@agentlens/api-contract";
import { describe, expect, it, vi } from "vitest";

import type { AgentLensApiClient } from "../src/api/client.js";
import {
  mergeTrajectoryPages,
  preserveTrajectoryAnchor
} from "../src/trajectory/mergePages.js";
import {
  resolveTrajectorySelection,
  trajectoryPageCursors
} from "../src/trajectory/useTrajectoryPages.js";

function event(eventId: string, sequence: number, summary = `Event ${sequence}`): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId,
    runId: "run-pages",
    sequence,
    receivedAt: new Date(Date.UTC(2026, 7, 31, 12, 0, sequence)).toISOString(),
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "message",
    status: { state: "known", value: "completed" },
    provenance: "observed",
    presentationClass: "message",
    safeSummary: summary,
    source: {
      opaqueRef: "src_fixture",
      provider: { state: "known", value: "codex-exec" },
      hasSessionOrThread: true,
      hasTurn: true,
      hasItemOrTool: true,
      hasCorrelation: false
    },
    relationships: [],
    derivation: null,
    nativePayload: { state: "unavailable", reason: "not_captured" },
    lifecycleGroupKey: null,
    lifecycle: null,
    detail: { state: "available" }
  };
}

function page(
  mode: TrajectoryPageV1["mode"],
  items: readonly TrajectoryEventV1[],
  options: { hasEarlier?: boolean; hasLater?: boolean; latest?: number | null } = {}
): TrajectoryPageV1 {
  if (items.length === 0) {
    const latest = options.latest ?? null;
    const hasEarlier = options.hasEarlier ?? latest !== null;
    return {
      schemaVersion: 1,
      runId: "run-pages",
      mode,
      items: [],
      window: {
        state: "empty",
        latestCommittedSequence: latest,
        hasEarlier,
        hasLater: false,
        earlierCursor: hasEarlier ? "earlier" : null,
        laterCursor: null
      }
    };
  }
  const hasEarlier = options.hasEarlier ?? false;
  const hasLater = options.hasLater ?? false;
  return {
    schemaVersion: 1,
    runId: "run-pages",
    mode,
    items: [...items],
    window: {
      state: "nonempty",
      minSequence: items[0]!.sequence,
      maxSequence: items.at(-1)!.sequence,
      latestCommittedSequence: options.latest ?? items.at(-1)!.sequence,
      hasEarlier,
      hasLater,
      earlierCursor: hasEarlier ? "earlier" : null,
      laterCursor: hasLater ? "later" : null
    }
  };
}

describe("mergeTrajectoryPages", () => {
  it("merges head, tail, after, around, and cursor windows chronologically", () => {
    const pages = [
      page("tail", [event("event-5", 5), event("event-6", 6)], { hasEarlier: true, latest: 6 }),
      page("cursor", [event("event-3", 3), event("event-4", 4)], { hasEarlier: true, hasLater: true, latest: 6 }),
      page("head", [event("event-1", 1), event("event-2", 2)], { hasLater: true, latest: 6 }),
      page("after", [event("event-7", 7)], { hasEarlier: true, latest: 7 }),
      page("around", [event("event-4", 4), event("event-5", 5)], { hasEarlier: true, hasLater: true, latest: 6 })
    ];

    expect(mergeTrajectoryPages(pages).map(({ sequence }) => sequence))
      .toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("treats exact repeats as idempotent and rejects every ID/sequence contradiction", () => {
    const canonical = event("event-2", 2);
    expect(mergeTrajectoryPages([
      page("head", [canonical]),
      page("around", [canonical])
    ])).toEqual([canonical]);

    expect(() => mergeTrajectoryPages([
      page("head", [canonical]),
      page("around", [event("event-2", 2, "conflicting summary")])
    ])).toThrow(/contradictory duplicate/i);
    expect(() => mergeTrajectoryPages([
      page("head", [canonical]),
      page("around", [event("event-2", 3)])
    ])).toThrow(/event id/i);
    expect(() => mergeTrajectoryPages([
      page("head", [canonical]),
      page("around", [event("different-event", 2)])
    ])).toThrow(/sequence/i);
  });

  it("deduplicates a bounded overlap by event and canonical sequence", () => {
    const overlap = event("event-100", 100);
    expect(mergeTrajectoryPages([
      page("head", [event("event-99", 99), overlap], { hasLater: true, latest: 101 }),
      page("cursor", [overlap, event("event-101", 101)], { hasEarlier: true, latest: 101 })
    ]).map(({ sequence }) => sequence)).toEqual([99, 100, 101]);
  });

  it("accepts empty windows but rejects cross-run pages and incompatible item metadata", () => {
    expect(mergeTrajectoryPages([page("head", []), page("after", [], { latest: 4 })]))
      .toEqual([]);

    const crossRun = { ...page("head", [event("event-1", 1)]), runId: "other-run" };
    expect(() => mergeTrajectoryPages([page("head", []), crossRun])).toThrow(/same run/i);

    const wrongBounds = page("head", [event("event-1", 1)]);
    if (wrongBounds.window.state === "nonempty") wrongBounds.window.maxSequence = 2;
    expect(() => mergeTrajectoryPages([wrongBounds])).toThrow(/window metadata/i);
  });

  it("preserves the selected row and its measured offset across prepend and append", () => {
    const previous = [event("event-3", 3), event("event-4", 4)];
    const anchor = { eventId: "event-4", offsetFromViewportTop: 27 };

    expect(preserveTrajectoryAnchor(previous, [
      event("event-1", 1), event("event-2", 2), ...previous, event("event-5", 5)
    ], anchor)).toEqual({ eventId: "event-4", index: 3, offsetFromViewportTop: 27 });
  });

  it("uses the outermost loaded windows so a terminal page clears a stale later cursor", () => {
    expect(trajectoryPageCursors([
      page("head", [event("event-1", 1), event("event-2", 2)], { hasLater: true, latest: 4 }),
      page("cursor", [event("event-3", 3), event("event-4", 4)], { hasEarlier: true, latest: 4 })
    ])).toEqual({ earlier: null, later: null });
  });

  it("clears only the exact consumed outer boundary after an empty cursor response", () => {
    const middle = page("head", [event("event-50", 50)], {
      hasEarlier: true, hasLater: true, latest: 100
    });
    const empty = page("cursor", [], { latest: 100 });

    expect(trajectoryPageCursors(
      [middle, empty],
      [null, { direction: "later", cursor: "later" }]
    )).toEqual({ earlier: "earlier", later: null });
    expect(trajectoryPageCursors(
      [middle, empty],
      [null, { direction: "earlier", cursor: "earlier" }]
    )).toEqual({ earlier: null, later: "later" });
  });

  it("does not let a repeated or nonmatching empty response erase another boundary", () => {
    const middle = page("head", [event("event-50", 50)], {
      hasEarlier: true, hasLater: true, latest: 100
    });
    const empty = page("cursor", [], { latest: 100 });

    expect(trajectoryPageCursors(
      [middle, empty, empty],
      [null, { direction: "later", cursor: "already-consumed" }, { direction: "earlier", cursor: "earlier" }]
    )).toEqual({ earlier: null, later: "later" });
  });

  it("retains bounded cursors into a gap between head and around windows", () => {
    expect(trajectoryPageCursors([
      page("head", [event("event-1", 1), event("event-2", 2)], { hasLater: true, latest: 100 }),
      page("around", [event("event-99", 99), event("event-100", 100)], {
        hasEarlier: true,
        latest: 100
      })
    ])).toEqual({ earlier: "earlier", later: "later" });
  });

  it("rejects incompatible cursor snapshot lineage but accepts a newer around-selection snapshot", () => {
    const head = page("head", [event("event-1", 1), event("event-2", 2)], {
      hasLater: true,
      latest: 2
    });
    const cursor = page("cursor", [event("event-3", 3)], { hasEarlier: true, latest: 999 });
    expect(() => mergeTrajectoryPages([head, cursor])).toThrow(/snapshot/i);

    const around = page("around", [event("event-99", 99), event("event-100", 100)], {
      hasEarlier: true,
      latest: 100
    });
    expect(mergeTrajectoryPages([head, around]).map(({ sequence }) => sequence))
      .toEqual([1, 2, 99, 100]);
  });

  it("rejects a disjoint topology without cursors pointing into its gap", () => {
    expect(() => mergeTrajectoryPages([
      page("head", [event("event-1", 1)], { latest: 100 }),
      page("around", [event("event-100", 100)], { hasEarlier: true, latest: 100 })
    ])).toThrow(/gap/i);
  });

  it("treats structurally equal DTOs as exact repeats regardless of object property order", () => {
    const canonical = event("event-2", 2);
    const reordered = {
      ...canonical,
      source: {
        hasCorrelation: canonical.source.hasCorrelation,
        hasItemOrTool: canonical.source.hasItemOrTool,
        hasTurn: canonical.source.hasTurn,
        hasSessionOrThread: canonical.source.hasSessionOrThread,
        provider: canonical.source.provider,
        opaqueRef: canonical.source.opaqueRef
      }
    } satisfies TrajectoryEventV1;

    expect(mergeTrajectoryPages([
      page("head", [canonical]),
      page("around", [reordered])
    ])).toEqual([canonical]);
  });
});

describe("deep-link selection", () => {
  it("resolves an unloaded selected event through detail then aroundSequence", async () => {
    const detail = {
      schemaVersion: 1,
      eventId: "event-44",
      runId: "run-pages",
      sequence: 44,
      kind: "message",
      status: { state: "known", value: "completed" },
      provenance: "observed",
      relationships: [],
      presentationClass: "message",
      role: "agent",
      content: { state: "unavailable", reason: "not_captured" }
    } satisfies EventDetailV1;
    const around = page("around", [event("event-43", 43), event("event-44", 44), event("event-45", 45)], {
      hasEarlier: true,
      hasLater: true,
      latest: 100
    });
    const getEvent = vi.fn(async () => detail);
    const getEvents = vi.fn(async () => around);
    const client = { getEvent, getEvents } as Pick<AgentLensApiClient, "getEvent" | "getEvents">;

    await expect(resolveTrajectorySelection({
      client,
      runId: "run-pages",
      eventId: "event-44",
      loadedEvents: [event("event-1", 1)],
      limit: 100
    })).resolves.toEqual({ state: "resolved", event: around.items[1], page: around });
    expect(getEvent).toHaveBeenCalledWith("run-pages", "event-44", undefined);
    expect(getEvents).toHaveBeenCalledWith("run-pages", { limit: 100, aroundSequence: 44 }, undefined);
  });

  it("does not fetch aroundSequence when the selected event is already loaded", async () => {
    const selected = event("event-4", 4);
    const client = { getEvent: vi.fn(), getEvents: vi.fn() } as Pick<
      AgentLensApiClient,
      "getEvent" | "getEvents"
    >;

    await expect(resolveTrajectorySelection({
      client,
      runId: "run-pages",
      eventId: "event-4",
      loadedEvents: [selected],
      limit: 100
    })).resolves.toEqual({ state: "resolved", event: selected, page: null });
    expect(client.getEvent).not.toHaveBeenCalled();
    expect(client.getEvents).not.toHaveBeenCalled();
  });
});
