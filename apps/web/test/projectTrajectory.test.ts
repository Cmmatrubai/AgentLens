import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { describe, expect, it } from "vitest";

import { findTrajectoryRowIndex, projectTrajectory } from "../src/trajectory/projectTrajectory.js";

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
    kind: "turn.started",
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
          kind: "turn.completed",
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
      kind: "turn.completed",
      lifecycleGroupKey: groupA,
      status: { state: "known", value: "completed" }
    });

    const instanceKey = `lifecycle:${groupA}:start-a:1:terminal-a:2`;
    expect(projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set() }))
      .toEqual([{ type: "lifecycle_group", key: instanceKey, events: [start, terminal], expanded: false }]);
    expect(projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set([instanceKey]) }))
      .toEqual([
        { type: "event", key: "start-a:1", event: start },
        { type: "event", key: "terminal-a:2", event: terminal }
      ]);
  });

  it("uses stable unique instance keys for separated pairs that reuse one opaque key", () => {
    const firstStart = event("start-1", 1, { lifecycleGroupKey: groupA });
    const firstTerminal = event("terminal-1", 2, {
      kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA
    });
    const separator = event("message", 3, { kind: "message.agent", presentationClass: "message" });
    const secondStart = event("start-2", 4, { lifecycleGroupKey: groupA });
    const secondTerminal = event("terminal-2", 5, {
      kind: "turn.failed", status: { state: "known", value: "failed" }, lifecycleGroupKey: groupA
    });
    const firstKey = `lifecycle:${groupA}:start-1:1:terminal-1:2`;
    const secondKey = `lifecycle:${groupA}:start-2:4:terminal-2:5`;

    expect(projectTrajectory({
      events: [firstStart, firstTerminal, separator, secondStart, secondTerminal],
      expandedGroupKeys: new Set([firstKey])
    })).toEqual([
      { type: "event", key: "start-1:1", event: firstStart },
      { type: "event", key: "terminal-1:2", event: firstTerminal },
      { type: "event", key: "message:3", event: separator },
      { type: "lifecycle_group", key: secondKey, events: [secondStart, secondTerminal], expanded: false }
    ]);
  });

  it("does not group repeated starts, repeated terminals, or mismatched lifecycle domains", () => {
    const rows = projectTrajectory({
      events: [
        event("start-1", 1, { lifecycleGroupKey: groupA }),
        event("start-2", 2, { lifecycleGroupKey: groupA }),
        event("terminal-1", 3, {
          kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA
        }),
        event("terminal-2", 4, {
          kind: "turn.failed", status: { state: "known", value: "failed" }, lifecycleGroupKey: groupA
        }),
        event("thread-start", 5, { kind: "thread.started", lifecycleGroupKey: groupA }),
        event("turn-terminal", 6, {
          kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA
        })
      ],
      expandedGroupKeys: new Set()
    });

    expect(rows.every(({ type }) => type === "event")).toBe(true);
  });

  it("retains a compact pair key when unrelated earlier events are prepended", () => {
    const start = event("start", 10, { lifecycleGroupKey: groupA });
    const terminal = event("terminal", 11, {
      kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA
    });
    const before = projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set() });
    const after = projectTrajectory({
      events: [event("earlier", 1, { kind: "message.agent", presentationClass: "message" }), start, terminal],
      expandedGroupKeys: new Set()
    });

    expect(before[0]!.key).toBe(`lifecycle:${groupA}:start:10:terminal:11`);
    expect(after[1]!.key).toBe(before[0]!.key);
  });

  it("resolves a scroll anchor by immutable event identity when prepend changes its row key", () => {
    const start = event("start", 10, { lifecycleGroupKey: groupA });
    const terminal = event("terminal", 11, {
      kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA
    });
    const before = projectTrajectory({ events: [terminal], expandedGroupKeys: new Set() });
    const after = projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set() });

    expect(before[0]!.key).toBe("terminal:11");
    expect(after[0]!.key).not.toBe(before[0]!.key);
    expect(findTrajectoryRowIndex(after, terminal.eventId)).toBe(0);
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
