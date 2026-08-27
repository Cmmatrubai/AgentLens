import { describe, expect, it, vi } from "vitest";

import { decodeCodexLine } from "../src/lineDecoder.js";
import { normalizeCodexRecord } from "../src/normalize.js";

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

  it("decodes and normalizes deeply nested valid JSON without truncation or stack overflow", () => {
    const depth = 20_000;
    const line =
      '{"type":"future.event","future":' +
      '{"next":'.repeat(depth) +
      '{"leaf":7}' +
      "}".repeat(depth) +
      "}";

    const decoded = decodeCodexLine(line, "stdout");

    expect(decoded.type).toBe("provider_record");
    if (decoded.type !== "provider_record") return;

    const [draft] = normalizeCodexRecord(decoded.record);
    expect(draft).toMatchObject({
      kind: "source.unknown",
      normalizedPayload: { eventType: "future.event" }
    });

    let cursor = (draft?.nativePayload as { future: unknown }).future;
    for (let index = 0; index < depth; index += 1) {
      cursor = (cursor as { next: unknown }).next;
    }
    expect(cursor).toEqual({ leaf: 7 });
    expect(Object.isFrozen(cursor)).toBe(true);
  });

  it("converts an unexpected provider freeze failure into a recorder diagnostic", () => {
    const originalFreeze = Object.freeze;
    let shouldFail = true;
    const freezeSpy = vi.spyOn(Object, "freeze").mockImplementation(
      ((value: object) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("fixture freeze failure");
        }
        return originalFreeze(value);
      }) as typeof Object.freeze
    );

    try {
      expect(decodeCodexLine('{"type":"future.event"}', "stdout")).toMatchObject({
        type: "diagnostic",
        draft: {
          kind: "recorder.stream_diagnostic",
          normalizedPayload: { stream: "stdout", reason: "freeze_failed" }
        }
      });
    } finally {
      freezeSpy.mockRestore();
    }
  });
});
