import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import type { TraceEventV1 } from "@agentlens/core";
import { describe, expect, it } from "vitest";

import {
  projectTrajectoryEventV1
} from "../../../packages/application/src/api/projectors.js";
import {
  createSourceRefProjector
} from "../../../packages/application/src/api/sourceRefs.js";
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
    lifecycle: { domain: "turn", phase: "started" },
    detail: { state: "available" },
    ...overrides
  };
}

function projectedEvent(input: Readonly<{
  eventId: string;
  sequence: number;
  eventType: string;
  status: TraceEventV1["status"] | string;
  kind?: string;
  itemId?: string;
  toolId?: string;
}>): TrajectoryEventV1 {
  return projectTrajectoryEventV1({
    id: input.eventId,
    runId: "run-projected",
    sequence: input.sequence,
    receivedAt: new Date(Date.UTC(2026, 7, 31, 13, 0, input.sequence)).toISOString(),
    kind: input.kind ?? "command",
    status: input.status as TraceEventV1["status"],
    provenance: "observed",
    source: {
      provider: "codex-exec",
      sessionId: "RAW_SESSION_MUST_NOT_CROSS_HTTP",
      turnId: "RAW_TURN_MUST_NOT_CROSS_HTTP",
      itemId: input.itemId,
      toolId: input.toolId,
      eventType: input.eventType,
      itemType: input.kind === "tool" ? "mcp_tool_call" : "command_execution"
    },
    relationships: [],
    summary: `Projected ${input.eventId}`
  }, createSourceRefProjector(new Uint8Array(32).fill(0x77)), "metadata-only");
}

describe("projectTrajectory", () => {
  it("does not collapse same-item progress and snapshot records from presentation status", () => {
    const progress = projectedEvent({
      eventId: "progress",
      sequence: 1,
      eventType: "item.progress",
      status: "in_progress",
      itemId: "RAW_ITEM_MUST_NOT_CROSS_HTTP"
    });
    const snapshot = projectedEvent({
      eventId: "snapshot",
      sequence: 2,
      eventType: "item.snapshot",
      status: "completed",
      itemId: "RAW_ITEM_MUST_NOT_CROSS_HTTP"
    });

    expect(progress.lifecycleGroupKey).toBe(snapshot.lifecycleGroupKey);
    expect(progress.lifecycle).toBeNull();
    expect(snapshot.lifecycle).toBeNull();
    expect(projectTrajectory({ events: [progress, snapshot], expandedGroupKeys: new Set() })
      .map(({ type }) => type)).toEqual(["event", "event"]);
  });

  it("keeps projected unknown kinds inspectable even with recognized provider lifecycle names", () => {
    const started = projectedEvent({
      eventId: "future-started",
      sequence: 1,
      eventType: "item.started",
      status: "in_progress",
      kind: "future.event",
      itemId: "RAW_FUTURE_ITEM"
    });
    const completed = projectedEvent({
      eventId: "future-completed",
      sequence: 2,
      eventType: "item.completed",
      status: "completed",
      kind: "future.event",
      itemId: "RAW_FUTURE_ITEM"
    });

    expect(started.lifecycle).toEqual({ domain: "item", phase: "started" });
    expect(completed.lifecycle).toEqual({ domain: "item", phase: "completed" });
    expect(projectTrajectory({ events: [started, completed], expandedGroupKeys: new Set() })
      .map(({ type }) => type)).toEqual(["event", "event"]);
  });

  it.each([
    ["item.completed", "unknown"],
    ["item.failed", "future_status"],
    ["item.declined", "unknown"],
    ["item.interrupted", "future_status"]
  ] as const)("collapses an explicit %s terminal even when its status is %s", (eventType, status) => {
    const started = projectedEvent({
      eventId: "started",
      sequence: 1,
      eventType: "item.started",
      status: "in_progress",
      itemId: "RAW_ITEM_MUST_NOT_CROSS_HTTP"
    });
    const terminal = projectedEvent({
      eventId: "terminal",
      sequence: 2,
      eventType,
      status,
      itemId: "RAW_ITEM_MUST_NOT_CROSS_HTTP"
    });

    expect(projectTrajectory({ events: [started, terminal], expandedGroupKeys: new Set() }))
      .toHaveLength(1);
    expect(JSON.stringify([started, terminal])).not.toMatch(
      /RAW_(?:SESSION|TURN|ITEM)_MUST_NOT_CROSS_HTTP|item\.(?:started|completed|failed)/
    );
  });

  it("groups true tool lifecycle records but not mixed or repeated provider phases", () => {
    const toolStarted = projectedEvent({
      eventId: "tool-started",
      sequence: 1,
      eventType: "tool.started",
      status: "unknown",
      kind: "tool",
      itemId: "RAW_SHARED_ITEM",
      toolId: "RAW_SHARED_TOOL"
    });
    const toolCompleted = projectedEvent({
      eventId: "tool-completed",
      sequence: 2,
      eventType: "tool.completed",
      status: "unknown",
      kind: "tool",
      itemId: "RAW_SHARED_ITEM",
      toolId: "RAW_SHARED_TOOL"
    });
    const itemStarted = projectedEvent({
      eventId: "item-started",
      sequence: 1,
      eventType: "item.started",
      status: "in_progress",
      kind: "tool",
      itemId: "RAW_SHARED_ITEM",
      toolId: "RAW_SHARED_TOOL"
    });

    expect(projectTrajectory({ events: [toolStarted, toolCompleted], expandedGroupKeys: new Set() }))
      .toHaveLength(1);
    expect(itemStarted.lifecycleGroupKey).toBe(toolCompleted.lifecycleGroupKey);
    expect(projectTrajectory({ events: [itemStarted, toolCompleted], expandedGroupKeys: new Set() })
      .map(({ type }) => type)).toEqual(["event", "event"]);
    expect(projectTrajectory({
      events: [
        itemStarted,
        { ...itemStarted, eventId: "item-started-again", sequence: 2, status: { state: "known", value: "completed" } }
      ],
      expandedGroupKeys: new Set()
    }).map(({ type }) => type)).toEqual(["event", "event"]);
  });

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
        event("unrelated", 2, { presentationClass: "message", kind: "message", lifecycle: null }),
        event("terminal-a", 3, {
          kind: "turn.completed",
          lifecycleGroupKey: groupA,
          lifecycle: { domain: "turn", phase: "completed" },
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
      lifecycle: { domain: "turn", phase: "completed" },
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

  it.each([
    ["command", "command"],
    ["tool", "tool"]
  ] as const)("compacts an exact contiguous %s item start and terminal", (_label, presentationClass) => {
    const start = event(`${presentationClass}-start`, 1, {
      kind: presentationClass,
      presentationClass,
      status: { state: "known", value: "in_progress" },
      lifecycleGroupKey: groupA,
      lifecycle: { domain: presentationClass === "command" ? "item" : "tool", phase: "started" }
    });
    const terminal = event(`${presentationClass}-terminal`, 2, {
      kind: presentationClass,
      presentationClass,
      status: { state: "known", value: "completed" },
      lifecycleGroupKey: groupA,
      lifecycle: { domain: presentationClass === "command" ? "item" : "tool", phase: "completed" }
    });

    expect(projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set() }))
      .toEqual([{
        type: "lifecycle_group",
        key: `lifecycle:${groupA}:${presentationClass}-start:1:${presentationClass}-terminal:2`,
        events: [start, terminal],
        expanded: false
      }]);
  });

  it("does not compact mismatched command/tool item domains with the same opaque key", () => {
    const rows = projectTrajectory({
      events: [
        event("command-start", 1, {
          kind: "command", presentationClass: "command",
          status: { state: "known", value: "in_progress" }, lifecycleGroupKey: groupA,
          lifecycle: { domain: "item", phase: "started" }
        }),
        event("tool-terminal", 2, {
          kind: "tool", presentationClass: "tool",
          status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA,
          lifecycle: { domain: "tool", phase: "completed" }
        })
      ],
      expandedGroupKeys: new Set()
    });

    expect(rows.map(({ type }) => type)).toEqual(["event", "event"]);
  });

  it("does not compact repeated command starts or terminals", () => {
    const command = (eventId: string, sequence: number, status: "in_progress" | "completed") =>
      event(eventId, sequence, {
        kind: "command",
        presentationClass: "command",
        status: { state: "known", value: status },
        lifecycleGroupKey: groupA,
        lifecycle: { domain: "item", phase: status === "in_progress" ? "started" : "completed" }
      });

    expect(projectTrajectory({
      events: [
        command("command-start-1", 1, "in_progress"),
        command("command-start-2", 2, "in_progress"),
        command("command-terminal", 3, "completed")
      ],
      expandedGroupKeys: new Set()
    }).every(({ type }) => type === "event")).toBe(true);
    expect(projectTrajectory({
      events: [
        command("command-start", 1, "in_progress"),
        command("command-terminal-1", 2, "completed"),
        command("command-terminal-2", 3, "completed")
      ],
      expandedGroupKeys: new Set()
    }).every(({ type }) => type === "event")).toBe(true);
  });

  it("uses stable unique instance keys for separated pairs that reuse one opaque key", () => {
    const firstStart = event("start-1", 1, { lifecycleGroupKey: groupA });
    const firstTerminal = event("terminal-1", 2, {
      kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA,
      lifecycle: { domain: "turn", phase: "completed" }
    });
    const separator = event("message", 3, {
      kind: "message.agent", presentationClass: "message", lifecycle: null
    });
    const secondStart = event("start-2", 4, { lifecycleGroupKey: groupA });
    const secondTerminal = event("terminal-2", 5, {
      kind: "turn.failed", status: { state: "known", value: "failed" }, lifecycleGroupKey: groupA,
      lifecycle: { domain: "turn", phase: "failed" }
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
          kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA,
          lifecycle: { domain: "turn", phase: "completed" }
        }),
        event("terminal-2", 4, {
          kind: "turn.failed", status: { state: "known", value: "failed" }, lifecycleGroupKey: groupA,
          lifecycle: { domain: "turn", phase: "failed" }
        }),
        event("thread-start", 5, {
          kind: "thread.started", lifecycleGroupKey: groupA,
          lifecycle: { domain: "thread", phase: "started" }
        }),
        event("turn-terminal", 6, {
          kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA,
          lifecycle: { domain: "turn", phase: "completed" }
        })
      ],
      expandedGroupKeys: new Set()
    });

    expect(rows.every(({ type }) => type === "event")).toBe(true);
  });

  it("retains a compact pair key when unrelated earlier events are prepended", () => {
    const start = event("start", 10, { lifecycleGroupKey: groupA });
    const terminal = event("terminal", 11, {
      kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA,
      lifecycle: { domain: "turn", phase: "completed" }
    });
    const before = projectTrajectory({ events: [start, terminal], expandedGroupKeys: new Set() });
    const after = projectTrajectory({
      events: [event("earlier", 1, {
        kind: "message.agent", presentationClass: "message", lifecycle: null
      }), start, terminal],
      expandedGroupKeys: new Set()
    });

    expect(before[0]!.key).toBe(`lifecycle:${groupA}:start:10:terminal:11`);
    expect(after[1]!.key).toBe(before[0]!.key);
  });

  it("resolves a scroll anchor by immutable event identity when prepend changes its row key", () => {
    const start = event("start", 10, { lifecycleGroupKey: groupA });
    const terminal = event("terminal", 11, {
      kind: "turn.completed", status: { state: "known", value: "completed" }, lifecycleGroupKey: groupA,
      lifecycle: { domain: "turn", phase: "completed" }
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
          lifecycleGroupKey: groupA,
          lifecycle: null
        }),
        event("future", 2, {
          kind: "future.event",
          presentationClass: "unknown",
          lifecycleGroupKey: groupA,
          lifecycle: null,
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
