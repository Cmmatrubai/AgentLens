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
