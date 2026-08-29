import { describe, expect, it } from "vitest";

import {
  eventStatusSchema,
  runStatusSchema,
  traceEventV1Schema
} from "../src/events.js";
import { codexExecCapabilities } from "../src/capabilities.js";

const validEvent = {
  id: "01JEVT00000000000000000000",
  runId: "01JRUN00000000000000000000",
  sequence: 1,
  receivedAt: "2026-08-26T12:00:00.000Z",
  kind: "command",
  status: "completed",
  provenance: "observed",
  source: { provider: "codex-exec", itemId: "fixture-command-001" },
  relationships: [],
  summary: "Command event"
};

describe("frozen event evidence contracts", () => {
  it("keeps run and event lifecycle types separate", () => {
    expect(runStatusSchema.parse("recorder_error")).toBe("recorder_error");
    expect(() => eventStatusSchema.parse("recorder_error")).toThrow();
  });

  it("requires derived events to name their source AgentLens events", () => {
    expect(() =>
      traceEventV1Schema.parse({
        ...validEvent,
        provenance: "derived",
        relationships: [],
        derivation: { name: "test-command", version: "1", sourceEventIds: [] }
      })
    ).toThrow();
  });

  it("rejects derived relationships that do not exactly name their sources", () => {
    const derivedEvent = {
      ...validEvent,
      provenance: "derived" as const,
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["fixture-event-a", "fixture-event-b"]
      }
    };

    expect(() =>
      traceEventV1Schema.parse({
        ...derivedEvent,
        relationships: [
          { type: "derived_from", eventId: "fixture-event-a" },
          { type: "derived_from", eventId: "fixture-event-c" }
        ]
      })
    ).toThrow();

    expect(() =>
      traceEventV1Schema.parse({
        ...derivedEvent,
        relationships: [
          { type: "derived_from", eventId: "fixture-event-a" },
          { type: "derived_from", eventId: "fixture-event-a" },
          { type: "derived_from", eventId: "fixture-event-b" }
        ]
      })
    ).toThrow();

    expect(() =>
      traceEventV1Schema.parse({
        ...derivedEvent,
        derivation: {
          ...derivedEvent.derivation,
          sourceEventIds: ["fixture-event-a", "fixture-event-a"]
        },
        relationships: [{ type: "derived_from", eventId: "fixture-event-a" }]
      })
    ).toThrow();

    expect(
      traceEventV1Schema.parse({
        ...derivedEvent,
        relationships: [
          { type: "derived_from", eventId: "fixture-event-a" },
          { type: "derived_from", eventId: "fixture-event-b" }
        ]
      })
    ).toBeTruthy();
  });

  it("preserves an optional derivation identity without requiring it from legacy derived events", () => {
    const sourceEventId = "fixture-event-a";
    const legacy = traceEventV1Schema.parse({
      ...validEvent,
      provenance: "derived",
      relationships: [{ type: "derived_from", eventId: sourceEventId }],
      derivation: {
        name: "run-reconciliation",
        version: "1",
        sourceEventIds: [sourceEventId]
      }
    });
    const identified = traceEventV1Schema.parse({
      ...validEvent,
      provenance: "derived",
      relationships: [{ type: "derived_from", eventId: sourceEventId }],
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: [sourceEventId],
        identity: "agentlens-derivation-sha256:fixture"
      }
    });

    expect(legacy.derivation).not.toHaveProperty("identity");
    expect(identified.derivation).toMatchObject({
      identity: "agentlens-derivation-sha256:fixture"
    });
  });

  it("supports redacted inline, artifact, and omitted native payloads", () => {
    for (const nativePayload of [
      { storage: "inline", redacted: { future_field: 7 } },
      { storage: "artifact", artifactId: "01JARTIFACT00000000000000" },
      { storage: "omitted", reason: "metadata-only" }
    ]) {
      expect(traceEventV1Schema.parse({ ...validEvent, nativePayload })).toBeTruthy();
    }
  });

  it("declares only the observed Codex capability limits", () => {
    expect(codexExecCapabilities).toEqual({
      sourceTimestamps: false,
      fileReads: "unavailable",
      toolOutput: "partial",
      toolDurations: "unavailable",
      interruptionSignal: "partial"
    });
  });
});
