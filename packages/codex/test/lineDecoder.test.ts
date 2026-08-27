import { describe, expect, it } from "vitest";

import { decodeCodexLine } from "../src/lineDecoder.js";

function expectDiagnostic(
  line: string,
  stream: "stdout" | "stderr",
  reason: string
): void {
  const decoded = decodeCodexLine(line, stream);

  expect(decoded).toMatchObject({
    type: "diagnostic",
    draft: {
      kind: "recorder.stream_diagnostic",
      status: "unknown",
      provenance: "recorder",
      source: { provider: "codex-exec" },
      relationships: [],
      normalizedPayload: { stream, reason },
      nativePayload: { stream, line }
    }
  });
  expect(Object.isFrozen(decoded)).toBe(true);
  if (decoded.type === "diagnostic") {
    expect(Object.isFrozen(decoded.draft)).toBe(true);
    expect(Object.isFrozen(decoded.draft.nativePayload)).toBe(true);
  }
}

describe("Codex JSONL line decoder", () => {
  it("returns a provider candidate only for a valid JSON object on stdout", () => {
    const record = { type: "thread.started", thread_id: "fixture-thread-001" };

    const decoded = decodeCodexLine(JSON.stringify(record), "stdout");

    expect(decoded).toEqual({ type: "provider_record", record });
    expect(Object.isFrozen(decoded)).toBe(true);
    if (decoded.type === "provider_record") {
      expect(Object.isFrozen(decoded.record)).toBe(true);
    }
  });

  it("turns malformed and unexpected stdout into recorder diagnostics", () => {
    expectDiagnostic("{not-json", "stdout", "malformed_json");
    expectDiagnostic(
      "Reading additional input from stdin...",
      "stdout",
      "malformed_json"
    );
  });

  it.each(["null", "7", "true", '"fixture text"', "[]"])(
    "turns non-object JSON %s into a recorder diagnostic",
    (line) => {
      expectDiagnostic(line, "stdout", "non_object_json");
    }
  );

  it("always treats stderr as a recorder diagnostic without parsing it", () => {
    const line = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } });

    expectDiagnostic(line, "stderr", "stderr");
    const decoded = decodeCodexLine(line, "stderr");
    expect(decoded.type).toBe("diagnostic");
    if (decoded.type === "diagnostic") {
      expect(decoded.draft.source.eventType).toBeUndefined();
    }
  });
});
