import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { describe, expect, it } from "vitest";

import { projectExecutionGraph } from "../src/trajectory/projectExecutionGraph.js";

const sourceRef = `src_${"1".repeat(64)}`;
const lifecycleGroup = `grp_${"a".repeat(64)}`;
const lifecycleGroupB = `grp_${"b".repeat(64)}`;
const lifecycleGroupC = `grp_${"c".repeat(64)}`;

function event(
  eventId: string,
  sequence: number,
  overrides: Partial<TrajectoryEventV1> = {}
): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId,
    runId: "run-execution-graph",
    sequence,
    receivedAt: new Date(Date.UTC(2026, 8, 5, 12, 0, sequence)).toISOString(),
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "message.agent",
    status: { state: "known", value: "completed" },
    provenance: "observed",
    presentationClass: "message",
    safeSummary: `Event ${sequence}`,
    source: {
      opaqueRef: sourceRef,
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
    lifecycle: null,
    detail: { state: "available" },
    ...overrides
  };
}

describe("projectExecutionGraph", () => {
  it("rejects non-increasing input without sorting or mutating caller events", () => {
    const events = [event("later", 2), event("earlier", 1)];
    const before = structuredClone(events);

    expect(() => projectExecutionGraph({ events, expandedGroupKeys: new Set() }))
      .toThrow(/strict canonical sequence/i);
    expect(events).toEqual(before);
  });

  it("assigns routine, action, and preserved landmark weights from bounded DTO facts", () => {
    const events = [
      event("message", 1),
      event("reasoning", 2, { kind: "reasoning.summary", presentationClass: "reasoning" }),
      event("command", 3, { kind: "command", presentationClass: "command" }),
      event("failure", 4, { status: { state: "known", value: "failed" } }),
      event("recovery", 5, {
        kind: "recorder.recovery", provenance: "recorder", presentationClass: "recorder_recovery"
      }),
      event("test", 6, { kind: "test.completed", provenance: "derived", presentationClass: "test" }),
      event("git", 7, { kind: "git.diff", provenance: "git_recovered", presentationClass: "git" }),
      event("human", 8, {
        kind: "assessment.recorded", provenance: "human", presentationClass: "assessment"
      }),
      event("error", 9, { kind: "error.provider", presentationClass: "error" }),
      event("unknown", 10, {
        kind: "future.event", presentationClass: "unknown",
        detail: { state: "unavailable", reason: "unsupported_kind" }
      })
    ];

    const graph = projectExecutionGraph({
      events,
      expandedGroupKeys: new Set(),
      clusterRoutine: false
    });

    expect(graph.nodes.map(({ key, type, weight, estimatedHeight }) => ({
      key, type, weight, estimatedHeight
    }))).toEqual([
      { key: "message:1", type: "event", weight: "routine", estimatedHeight: 128 },
      { key: "reasoning:2", type: "event", weight: "routine", estimatedHeight: 128 },
      { key: "command:3", type: "event", weight: "action", estimatedHeight: 160 },
      { key: "failure:4", type: "event", weight: "landmark", estimatedHeight: 184 },
      { key: "recovery:5", type: "event", weight: "landmark", estimatedHeight: 184 },
      { key: "test:6", type: "event", weight: "landmark", estimatedHeight: 184 },
      { key: "git:7", type: "event", weight: "landmark", estimatedHeight: 184 },
      { key: "human:8", type: "event", weight: "landmark", estimatedHeight: 184 },
      { key: "error:9", type: "event", weight: "landmark", estimatedHeight: 184 },
      { key: "unknown:10", type: "event", weight: "landmark", estimatedHeight: 184 }
    ]);
    expect(graph.nodes.flatMap(({ events: members }) => members.map(({ eventId }) => eventId)))
      .toEqual(events.map(({ eventId }) => eventId));
  });

  it("reuses the exact compatible lifecycle pair key and preserves member identity", () => {
    const start = event("command-start", 1, {
      kind: "command.started",
      status: { state: "known", value: "in_progress" },
      presentationClass: "command",
      lifecycleGroupKey: lifecycleGroup,
      lifecycle: { domain: "item", phase: "started" }
    });
    const terminal = event("command-terminal", 2, {
      kind: "command.completed",
      presentationClass: "command",
      lifecycleGroupKey: lifecycleGroup,
      lifecycle: { domain: "item", phase: "completed" }
    });
    const key = `lifecycle:${lifecycleGroup}:command-start:1:command-terminal:2`;

    const compact = projectExecutionGraph({
      events: [start, terminal], expandedGroupKeys: new Set()
    });
    const expanded = projectExecutionGraph({
      events: [start, terminal], expandedGroupKeys: new Set([key])
    });

    expect(compact.nodes).toEqual([{
      key,
      type: "lifecycle_group",
      events: [start, terminal],
      expanded: false,
      weight: "action",
      lane: 0,
      estimatedHeight: 160
    }]);
    expect(expanded.nodes[0]).toMatchObject({ key, expanded: true, estimatedHeight: 224 });
    expect(expanded.nodes[0]?.events[0]).toBe(start);
    expect(expanded.nodes[0]?.events[1]).toBe(terminal);
    expect([...compact.eventNodeIndex]).toEqual([
      ["command-start", 0],
      ["command-terminal", 0]
    ]);
  });

  it("splits lifecycle pairs that contain failures or loaded relationship endpoints", () => {
    const lifecycleEvent = (
      eventId: string,
      sequence: number,
      phase: "started" | "completed" | "failed",
      overrides: Partial<TrajectoryEventV1> = {}
    ) => event(eventId, sequence, {
      kind: `command.${phase}`,
      status: { state: "known", value: phase === "started" ? "in_progress" : phase },
      presentationClass: "command",
      lifecycleGroupKey: lifecycleGroup,
      lifecycle: { domain: "item", phase },
      ...overrides
    });
    const events = [
      lifecycleEvent("failed-start", 1, "started"),
      lifecycleEvent("failed-terminal", 2, "failed"),
      lifecycleEvent("incoming-start", 3, "started", { lifecycleGroupKey: lifecycleGroupB }),
      lifecycleEvent("incoming-terminal", 4, "completed", { lifecycleGroupKey: lifecycleGroupB }),
      event("relationship-source", 5, {
        relationships: [{ type: "correlates_with", eventId: "incoming-start" }]
      }),
      lifecycleEvent("outgoing-start", 6, "started", {
        lifecycleGroupKey: lifecycleGroupC,
        relationships: [{ type: "derived_from", eventId: "relationship-source" }]
      }),
      lifecycleEvent("outgoing-terminal", 7, "completed", { lifecycleGroupKey: lifecycleGroupC })
    ];

    const graph = projectExecutionGraph({ events, expandedGroupKeys: new Set() });

    expect(graph.nodes.map(({ type }) => type)).toEqual(events.map(() => "event"));
    expect(graph.nodes.map(({ key }) => key)).toEqual(events.map(({ eventId, sequence }) =>
      `${eventId}:${sequence}`));
    expect(graph.nodes[1]?.weight).toBe("landmark");
    expect([...graph.eventNodeIndex]).toEqual(events.map(({ eventId }, index) => [eventId, index]));
  });

  it("clusters three to six eligible routine events with stable first-member identity", () => {
    const firstSix = Array.from({ length: 6 }, (_, index) =>
      event(`routine-${index + 1}`, index + 1));
    const seventh = event("routine-7", 7);
    const events = [...firstSix, seventh];
    const key = "routine:routine-1:1";

    const compact = projectExecutionGraph({ events, expandedGroupKeys: new Set() });
    const expanded = projectExecutionGraph({
      events,
      expandedGroupKeys: new Set([key])
    });
    const unclustered = projectExecutionGraph({
      events,
      expandedGroupKeys: new Set([key]),
      clusterRoutine: false
    });

    expect(compact.nodes.map(({ key: nodeKey, type, events: members, expanded: isExpanded }) => ({
      key: nodeKey,
      type,
      memberIds: members.map(({ eventId }) => eventId),
      expanded: isExpanded
    }))).toEqual([
      {
        key,
        type: "routine_cluster",
        memberIds: firstSix.map(({ eventId }) => eventId),
        expanded: false
      },
      { key: "routine-7:7", type: "event", memberIds: ["routine-7"], expanded: false }
    ]);
    expect(expanded.nodes[0]).toMatchObject({
      key,
      type: "routine_cluster",
      expanded: true,
      weight: "routine",
      estimatedHeight: 448
    });
    expect([...expanded.eventNodeIndex]).toEqual([
      ...firstSix.map(({ eventId }) => [eventId, 0] as const),
      ["routine-7", 1]
    ]);
    expect(unclustered.nodes).toHaveLength(7);
    expect(unclustered.nodes.every(({ type }) => type === "event")).toBe(true);

    const reasoning = [1, 2, 3].map((sequence) => event(`reasoning-${sequence}`, sequence, {
      kind: "reasoning.summary",
      presentationClass: "reasoning"
    }));
    expect(projectExecutionGraph({
      events: reasoning,
      expandedGroupKeys: new Set()
    }).nodes).toMatchObject([{
      key: "routine:reasoning-1:1",
      type: "routine_cluster",
      events: reasoning
    }]);
  });

  it.each([
    ["fewer than three members", [event("one", 1), event("two", 2)]],
    ["a nonconsecutive sequence gap", [event("one", 1), event("two", 2), event("four", 4)]],
    ["different presentation classes", [
      event("one", 1),
      event("reasoning", 2, { kind: "reasoning.summary", presentationClass: "reasoning" }),
      event("three", 3)
    ]],
    ["an incomplete member", [
      event("one", 1), event("two", 2),
      event("three", 3, { status: { state: "known", value: "in_progress" } })
    ]],
    ["a non-observed member", [
      event("one", 1), event("two", 2), event("three", 3, { provenance: "derived" })
    ]],
    ["an outgoing relationship", [
      event("one", 1), event("two", 2),
      event("three", 3, { relationships: [{ type: "derived_from", eventId: "outside" }] })
    ]],
    ["a lifecycle member", [
      event("one", 1), event("two", 2),
      event("three", 3, { lifecycle: { domain: "turn", phase: "completed" } })
    ]],
    ["a derived member", [
      event("one", 1), event("two", 2),
      event("three", 3, {
        derivation: {
          name: "likely_test", version: "1", sourceEventIds: ["one"], confidence: "high"
        }
      })
    ]],
    ["a loaded incoming relationship endpoint", [
      event("one", 1),
      event("two", 2),
      event("three", 3, { relationships: [{ type: "correlates_with", eventId: "one" }] })
    ]]
  ] as const)("does not cluster routine events across %s", (_reason, events) => {
    expect(projectExecutionGraph({ events, expandedGroupKeys: new Set() }).nodes
      .every(({ type }) => type === "event")).toBe(true);
  });

  it("keeps projection deterministic across prepend and selection-shaped caller metadata", () => {
    const routine = [10, 11, 12].map((sequence) => event(`routine-${sequence}`, sequence));
    const baseline = projectExecutionGraph({ events: routine, expandedGroupKeys: new Set() });
    const callerInput = {
      events: routine,
      expandedGroupKeys: new Set<string>(),
      selectedEventId: "routine-11"
    };
    const withCallerSelection = projectExecutionGraph(callerInput);
    const prepended = projectExecutionGraph({
      events: [event("earlier-action", 1, { kind: "command", presentationClass: "command" }), ...routine],
      expandedGroupKeys: new Set()
    });

    expect(withCallerSelection).toEqual(baseline);
    expect(prepended.nodes[1]?.key).toBe(baseline.nodes[0]?.key);
    expect(prepended.nodes[1]?.events).toEqual(routine);
  });

  it("projects exact directional relationships, deduplicates, and bounds backward lanes", () => {
    const first = event("first", 1, {
      relationships: [{ type: "correlates_with", eventId: "second" }]
    });
    const second = event("second", 2, {
      relationships: [
        { type: "derived_from", eventId: "first" },
        { type: "derived_from", eventId: "first" },
        { type: "correlates_with", eventId: "first" },
        { type: "recovers", eventId: "not-loaded" },
        { type: "correlates_with", eventId: "second" }
      ]
    });
    const third = event("third", 3, {
      relationships: [{ type: "derived_from", eventId: "fourth" }]
    });
    const fourth = event("fourth", 4);
    const provenanceOnly = event("provenance-only", 5, { provenance: "derived" });
    const events = [first, second, third, fourth, provenanceOnly];
    const before = structuredClone(events);

    const graph = projectExecutionGraph({ events, expandedGroupKeys: new Set() });

    expect(graph.edges).toEqual([
      {
        key: "relationship:first:correlates_with:second",
        sourceEventId: "first",
        targetEventId: "second",
        type: "correlates_with",
        sourceNodeIndex: 0,
        targetNodeIndex: 1
      },
      {
        key: "relationship:second:derived_from:first",
        sourceEventId: "second",
        targetEventId: "first",
        type: "derived_from",
        sourceNodeIndex: 1,
        targetNodeIndex: 0
      },
      {
        key: "relationship:second:correlates_with:first",
        sourceEventId: "second",
        targetEventId: "first",
        type: "correlates_with",
        sourceNodeIndex: 1,
        targetNodeIndex: 0
      },
      {
        key: "relationship:second:recovers:not-loaded",
        sourceEventId: "second",
        targetEventId: "not-loaded",
        type: "recovers",
        sourceNodeIndex: 1,
        targetNodeIndex: null
      },
      {
        key: "relationship:third:derived_from:fourth",
        sourceEventId: "third",
        targetEventId: "fourth",
        type: "derived_from",
        sourceNodeIndex: 2,
        targetNodeIndex: 3
      }
    ]);
    expect(graph.nodes.map(({ lane }) => lane)).toEqual([0, 1, 0, 0, 0]);
    expect(graph.nodes[1]?.events[0]).toBe(second);
    expect(second.relationships.at(-1)).toEqual({ type: "correlates_with", eventId: "second" });
    expect(events).toEqual(before);
  });
});
