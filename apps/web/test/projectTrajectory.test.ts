import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { describe, expect, it } from "vitest";

import { projectTrajectory } from "../src/trajectory/projectTrajectory.js";

const groupA = `grp_${"a".repeat(64)}`;

function event(
  eventId: string,
  sequence: number,
  overrides: Partial<TrajectoryEventV1> = {}
): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId,
    runId: "run-trajectory",
    sequence,
    receivedAt: new Date(Date.UTC(2026, 7, 31, 12, 0, sequence)).toISOString(),
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "turn.lifecycle",
    status: { state: "known", value: "in_progress" },
    provenance: "observed",
    presentationClass: "lifecycle",
    safeSummary: `Event ${sequence}`,
    source: {
      opaqueRef: "src_fixture",
      provider: { state: "known", value: "codex-exec" },
      hasSessionOrThread: true,
      hasTurn: true,
      hasItemOrTool: false,
      hasCorrelation: false
    },
    relationships: [],
    derivation: null,
    nativePayload: { state: "unavailable", reason: "not_captured" },
    lifecycleGroupKey: null,
    detail: { state: "available" },
    ...overrides
  };
}

describe("projectTrajectory", () => {
  it("rejects contradictory sequence input instead of sorting it", () => {
    expect(() => projectTrajectory({
      events: [event("event-2", 2), event("event-1", 1)],
      expandedGroupKeys: new Set()
    })).toThrow(/canonical sequence/i);
  });

  it("groups only contiguous compatible lifecycle siblings", () => {
    const rows = projectTrajectory({
      events: [
        event("start-a", 1, { lifecycleGroupKey: groupA }),
        event("unrelated", 2, { presentationClass: "message", kind: "message" }),
        event("terminal-a", 3, {
          lifecycleGroupKey: groupA,
          status: { state: "known", value: "completed" }
        })
      ],
      expandedGroupKeys: new Set()
    });

    expect(rows.map((row) => row.type)).toEqual(["event", "event", "event"]);
  });

  it("keeps compacted source events immutable and restores each one in order when expanded", () => {
    const start = event("start-a", 1, { lifecycleGroupKey: groupA });
    const terminal = event("terminal-a", 2, {
      lifecycleGroupKey: groupA,
      status: { state: "known", value: "completed" }
    });

    expect(projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set() }))
      .toEqual([{ type: "lifecycle_group", key: groupA, events: [start, terminal], expanded: false }]);
    expect(projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set([groupA]) }))
      .toEqual([
        { type: "event", key: "start-a:1", event: start },
        { type: "event", key: "terminal-a:2", event: terminal }
      ]);
  });

  it("keeps recorder recovery and unknown kinds as independent inspectable rows", () => {
    const rows = projectTrajectory({
      events: [
        event("recovery", 1, {
          kind: "recorder.recovery",
          provenance: "recorder",
          presentationClass: "recorder_recovery",
          lifecycleGroupKey: groupA
        }),
        event("future", 2, {
          kind: "future.event",
          presentationClass: "unknown",
          lifecycleGroupKey: groupA,
          detail: { state: "unavailable", reason: "unsupported_kind" }
        })
      ],
      expandedGroupKeys: new Set()
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.type === "event")).toBe(true);
    expect(rows.map((row) => row.key)).toEqual(["recovery:1", "future:2"]);
  });
});
