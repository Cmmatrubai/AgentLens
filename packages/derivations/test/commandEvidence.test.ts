import type { CapturePolicy, TraceEventV1 } from "@agentlens/core";
import { describe, expect, it } from "vitest";

import { parseCommandEvidence } from "../src/index.js";

function event(
  normalizedPayload: unknown,
  overrides: Partial<TraceEventV1> = {}
): TraceEventV1 {
  return {
    id: "event-command-1",
    runId: "run-command-1",
    sequence: 1,
    receivedAt: "2026-08-29T12:00:00.000Z",
    kind: "command",
    status: "completed",
    provenance: "observed",
    source: {
      provider: "codex-exec",
      eventType: "item.completed",
      itemType: "command_execution"
    },
    relationships: [],
    summary: "Command event",
    normalizedPayload,
    ...overrides
  };
}

function parse(eventValue: TraceEventV1, capturePolicy: CapturePolicy) {
  return parseCommandEvidence(eventValue, capturePolicy);
}

describe("durable command evidence", () => {
  it("prefers explicit structured evidence over a legacy command", () => {
    expect(parse(event({
      command: "legacy command",
      commandEvidence: { state: "available", redactedCommand: "pnpm test" }
    }), "standard")).toEqual({
      state: "available",
      redactedCommand: "pnpm test"
    });
  });

  it("preserves explicit structured omission", () => {
    expect(parse(event({
      commandEvidence: { state: "omitted", reason: "capture-bound" }
    }), "standard")).toEqual({
      state: "omitted",
      reason: "capture-bound"
    });
  });

  it("accepts a top-level redacted command from a standard Task 5 event", () => {
    expect(parse(event({ command: "pnpm vitest --run" }), "standard")).toEqual({
      state: "available",
      redactedCommand: "pnpm vitest --run"
    });
  });

  it("accepts a legacy standard command at exactly the 16 KiB UTF-8 boundary", () => {
    const redactedCommand = "x".repeat(16 * 1024);

    expect(parse(event({ command: redactedCommand }), "standard")).toEqual({
      state: "available",
      redactedCommand
    });
  });

  it("omits a multibyte legacy standard command above the 16 KiB UTF-8 boundary", () => {
    const evidence = parse(event({ command: "🙂".repeat(4_097) }), "standard");

    expect(evidence).toEqual({ state: "omitted", reason: "capture-bound" });
    expect(evidence).not.toHaveProperty("redactedCommand");
  });

  it("treats a truncated legacy payload without command text as capture-bound", () => {
    expect(parse(event({ truncated: true }), "standard")).toEqual({
      state: "omitted",
      reason: "capture-bound"
    });
  });

  it.each(["metadata-only", "strict"] as const)(
    "returns %s omission without inspecting stored command fields",
    (capturePolicy) => {
      expect(parse(event({
        command: "pnpm test",
        commandEvidence: { state: "available", redactedCommand: "npm test" }
      }), capturePolicy)).toEqual({
        state: "omitted",
        reason: capturePolicy
      });
    }
  );

  it("never falls back to summary or native payload content", () => {
    expect(parse(event({}, {
      summary: "pnpm test",
      nativePayload: {
        storage: "inline",
        redacted: { command: "pnpm test" }
      }
    }), "standard")).toBeUndefined();
  });

  it("returns no evidence for malformed or unknown normalized payloads", () => {
    expect(parse(event("future-payload"), "standard")).toBeUndefined();
    expect(parse(event({
      commandEvidence: { state: "available", redactedCommand: 7 }
    }), "standard")).toBeUndefined();
  });
});
