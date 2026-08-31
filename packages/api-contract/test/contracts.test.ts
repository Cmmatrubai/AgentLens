import { describe, expect, it } from "vitest";

import {
  apiErrorCodeV1Schema,
  apiErrorV1Schema,
  assessmentConflictResponseV1Schema,
  assessmentResponseV1Schema,
  assessmentUpdateRequestV1Schema,
  browserAddressableEventIdV1Schema,
  currentAssessmentV1Schema,
  eventDetailV1Schema,
  eventStatusFieldV1Schema,
  evidenceValueV1Schema,
  gitDiffContentV1Schema,
  nativeContentResponseV1Schema,
  normalizedContentV1Schema,
  normalizedContentResponseV1Schema,
  presentationClassV1Schema,
  providerFieldV1Schema,
  runStatusFieldV1Schema,
  trajectoryEventV1Schema,
  trajectoryPageV1Schema,
  trajectoryWindowV1Schema
} from "../src/index.js";

const API_ERROR_CODES = [
  "invalid_request",
  "authentication_required",
  "forbidden_origin",
  "run_not_found",
  "event_not_found",
  "invalid_cursor",
  "precondition_required",
  "assessment_conflict",
  "content_unavailable",
  "evidence_binding_mismatch",
  "active_snapshot_unavailable",
  "internal_error"
] as const;

const RUN_STATUSES = [
  "starting",
  "running",
  "completed",
  "failed",
  "interrupted",
  "recorder_error"
] as const;

const EVENT_STATUSES = [
  "in_progress",
  "completed",
  "failed",
  "declined",
  "interrupted",
  "unknown"
] as const;

const PRESENTATION_CLASSES = [
  "lifecycle",
  "message",
  "reasoning",
  "command",
  "file_change",
  "tool",
  "plan",
  "git",
  "recorder",
  "recorder_recovery",
  "test",
  "assessment",
  "error",
  "unknown"
] as const;

const knownStatus = { state: "known", value: "completed" } as const;
const relationships = [{ type: "derived_from", eventId: "source-event" }] as const;
const detailBase = {
  schemaVersion: 1,
  eventId: "event-1",
  runId: "run-1",
  sequence: 4,
  kind: "test.result",
  status: knownStatus,
  provenance: "derived",
  relationships
} as const;
const availableContent = { state: "available" } as const;
const unavailableContent = { state: "unavailable", reason: "not_captured" } as const;

describe("closed v1 browser schemas", () => {
  it("accepts exactly every frozen API error code", () => {
    for (const code of API_ERROR_CODES) expect(apiErrorCodeV1Schema.parse(code)).toBe(code);
    expect(() => apiErrorCodeV1Schema.parse("database_path_leak")).toThrow();
    expect(apiErrorV1Schema.parse({
      schemaVersion: 1,
      error: { code: "invalid_cursor", message: "The cursor is invalid.", retryable: false }
    })).toEqual({
      schemaVersion: 1,
      error: { code: "invalid_cursor", message: "The cursor is invalid.", retryable: false }
    });
    expect(() => apiErrorV1Schema.parse({
      schemaVersion: 1,
      error: { code: "invalid_cursor", message: "invalid", retryable: false, path: "/private/db" }
    })).toThrow();
  });

  it("keeps every canonical run and event status closed", () => {
    for (const status of RUN_STATUSES) {
      expect(runStatusFieldV1Schema.parse({ state: "known", value: status })).toEqual({
        state: "known",
        value: status
      });
    }
    for (const status of EVENT_STATUSES) {
      expect(eventStatusFieldV1Schema.parse({ state: "known", value: status })).toEqual({
        state: "known",
        value: status
      });
    }
    expect(providerFieldV1Schema.parse({ state: "known", value: "codex-exec" }))
      .toEqual({ state: "known", value: "codex-exec" });
    expect(providerFieldV1Schema.parse({ state: "known", value: "claude-code" }))
      .toEqual({ state: "known", value: "claude-code" });
    expect(() => runStatusFieldV1Schema.parse({ state: "known", value: "future" })).toThrow();
    expect(() => eventStatusFieldV1Schema.parse({ state: "known", value: "future" })).toThrow();
  });

  it("bounds unsupported tokens and rejects arbitrary text", () => {
    const token = "future.status_1";
    expect(runStatusFieldV1Schema.parse({ state: "unsupported", safeToken: token }))
      .toEqual({ state: "unsupported", safeToken: token });
    expect(providerFieldV1Schema.parse({ state: "unsupported", safeToken: token }))
      .toEqual({ state: "unsupported", safeToken: token });
    for (const bad of ["", "Uppercase", "contains spaces", "../path", "x".repeat(65)]) {
      expect(() => eventStatusFieldV1Schema.parse({ state: "unsupported", safeToken: bad })).toThrow();
    }
  });

  it("models available and unavailable evidence without nullable values", () => {
    const schema = evidenceValueV1Schema(runStatusFieldV1Schema);
    expect(schema.parse({
      state: "available",
      value: knownStatus,
      origin: { type: "event", provenance: "observed" },
      supportingEventIds: ["event-1"],
      supportingArtifactIds: []
    })).toMatchObject({ state: "available", value: knownStatus });
    expect(schema.parse({
      state: "unavailable",
      reason: "capture_policy",
      origin: null,
      supportingEventIds: [],
      supportingArtifactIds: []
    })).toMatchObject({ state: "unavailable", reason: "capture_policy" });
    expect(() => schema.parse({
      state: "unavailable",
      value: null,
      reason: "capture_policy",
      origin: null,
      supportingEventIds: [],
      supportingArtifactIds: []
    })).toThrow();
  });

  it("keeps trajectory events structural and strict", () => {
    const safeTrajectory = {
      schemaVersion: 1,
      eventId: "event-1",
      runId: "run-1",
      sequence: 4,
      receivedAt: "2026-08-30T12:00:00.000Z",
      sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
      kind: "test.result",
      status: knownStatus,
      provenance: "derived",
      presentationClass: "test",
      safeSummary: "Likely test passed",
      source: {
        opaqueRef: `src_${"a".repeat(64)}`,
        provider: { state: "known", value: "codex-exec" },
        hasSessionOrThread: true,
        hasTurn: true,
        hasItemOrTool: true,
        hasCorrelation: false
      },
      relationships,
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["source-event"],
        confidence: "high",
        identity: "derivation-id"
      },
      nativePayload: { state: "unavailable", reason: "capture_policy" },
      lifecycleGroupKey: null,
      detail: { state: "available" }
    } as const;
    expect(trajectoryEventV1Schema.parse(safeTrajectory)).toEqual(safeTrajectory);
    for (const forbidden of [
      { normalizedPayload: { sentinel: "MUST_NOT_CROSS_HTTP" } },
      { nativePayloadContent: { sentinel: "NATIVE_MUST_NOT_CROSS_HTTP" } },
      { databasePath: "/private/agentlens.sqlite" },
      { sourceId: "raw-provider-source-id" }
    ]) {
      expect(() => trajectoryEventV1Schema.parse({ ...safeTrajectory, ...forbidden })).toThrow();
    }
  });

  it("accepts the exact empty and nonempty trajectory windows", () => {
    const nonempty = {
      state: "nonempty",
      minSequence: 2,
      maxSequence: 5,
      latestCommittedSequence: 8,
      hasEarlier: true,
      hasLater: true,
      earlierCursor: "earlier",
      laterCursor: "later"
    } as const;
    const empty = {
      state: "empty",
      latestCommittedSequence: null,
      hasEarlier: false,
      hasLater: false,
      earlierCursor: null,
      laterCursor: null
    } as const;
    expect(trajectoryWindowV1Schema.parse(nonempty)).toEqual(nonempty);
    expect(trajectoryWindowV1Schema.parse(empty)).toEqual(empty);
    expect(() => trajectoryWindowV1Schema.parse({ ...empty, hasLater: true })).toThrow();
    expect(() => trajectoryWindowV1Schema.parse({ ...nonempty, minSequence: 7, maxSequence: 5 })).toThrow();
    expect(trajectoryPageV1Schema.parse({
      schemaVersion: 1,
      runId: "run-1",
      mode: "head",
      items: [],
      window: empty
    })).toMatchObject({ schemaVersion: 1, mode: "head", window: empty });
  });

  it("defines a closed detail variant for every presentation class", () => {
    const derivation = {
      name: "test-command",
      version: "1",
      sourceEventIds: ["source-event"],
      confidence: "high",
      identity: "derivation-id"
    } as const;
    const fixtures = [
      { ...detailBase, presentationClass: "lifecycle", phase: "turn.completed", content: availableContent },
      { ...detailBase, presentationClass: "message", role: "agent", content: availableContent },
      { ...detailBase, presentationClass: "reasoning", content: availableContent },
      { ...detailBase, presentationClass: "command", lifecycle: "completed", exitCode: 0, output: unavailableContent, content: availableContent },
      { ...detailBase, presentationClass: "file_change", changeCount: 2, content: availableContent },
      { ...detailBase, presentationClass: "tool", toolName: "mcp_tool", toolStatus: knownStatus, content: availableContent },
      { ...detailBase, presentationClass: "plan", steps: { total: 2, completed: 1, inProgress: 1, failed: 0 }, content: availableContent },
      { ...detailBase, presentationClass: "git", evidence: availableContent, content: availableContent },
      { ...detailBase, presentationClass: "recorder", diagnosticClass: "process_exit", content: availableContent },
      { ...detailBase, presentationClass: "recorder_recovery", recoveryClass: "interrupted_open_event", recoveredEventIds: ["source-event"], content: availableContent },
      { ...detailBase, presentationClass: "test", derivation, result: "passed", content: availableContent },
      { ...detailBase, presentationClass: "assessment", revision: "event-1", verdict: "success", taskCompleted: "yes", note: { state: "absent" }, content: availableContent },
      { ...detailBase, presentationClass: "error", errorClass: "provider_error", content: availableContent },
      { ...detailBase, presentationClass: "unknown", content: { state: "unavailable", reason: "unsupported_kind" } }
    ] as const;
    for (const fixture of fixtures) {
      expect(presentationClassV1Schema.parse(fixture.presentationClass)).toBe(fixture.presentationClass);
      expect(eventDetailV1Schema.parse(fixture)).toEqual(fixture);
    }
    expect(() => eventDetailV1Schema.parse({ ...fixtures[13], arbitrary: { secret: true } })).toThrow();
  });

  it("keeps unknown detail structural-only", () => {
    const unknownDetail = {
      ...detailBase,
      presentationClass: "unknown",
      kind: "future.kind",
      content: { state: "unavailable", reason: "unsupported_kind" }
    } as const;
    expect(eventDetailV1Schema.parse(unknownDetail)).toEqual({
      schemaVersion: 1,
      presentationClass: "unknown",
      eventId: unknownDetail.eventId,
      runId: unknownDetail.runId,
      sequence: unknownDetail.sequence,
      kind: unknownDetail.kind,
      status: unknownDetail.status,
      provenance: unknownDetail.provenance,
      relationships: unknownDetail.relationships,
      content: { state: "unavailable", reason: "unsupported_kind" }
    });
    expect(() => eventDetailV1Schema.parse({
      ...unknownDetail,
      normalizedPayload: { sentinel: "MUST_NOT_CROSS_HTTP" }
    })).toThrow();
  });

  it("allows only bounded known normalized-content variants", () => {
    const variants = [
      { kind: "message", role: "agent", text: "redacted message" },
      { kind: "reasoning", text: "redacted reasoning" },
      { kind: "command", command: "pnpm test", exitCode: 0 },
      { kind: "command_output", output: "all tests passed" },
      { kind: "file_change", changes: [{ path: "src/example.ts", kind: "modify" }] },
      { kind: "tool", name: "search", input: "redacted", result: "redacted" },
      { kind: "plan", items: [{ text: "Implement contract", status: "completed" }] },
      { kind: "git", section: "tracked_final_diff", text: "redacted diff" },
      { kind: "recorder", diagnosticClass: "process_exit", message: "child exited" },
      { kind: "test", family: "vitest", outcome: "passed" },
      { kind: "assessment", verdict: "success", taskCompleted: "yes", note: "reviewed" },
      { kind: "error", errorClass: "provider_error", message: "redacted error" }
    ] as const;
    for (const variant of variants) expect(normalizedContentV1Schema.parse(variant)).toEqual(variant);
    expect(() => normalizedContentV1Schema.parse({ kind: "unknown", content: { arbitrary: true } })).toThrow();
    expect(() => normalizedContentV1Schema.parse({ ...variants[0], extra: true })).toThrow();
    expect(normalizedContentResponseV1Schema.parse({
      schemaVersion: 1,
      eventId: "event-1",
      content: variants[0]
    })).toMatchObject({ schemaVersion: 1, eventId: "event-1" });
    expect(nativeContentResponseV1Schema.parse({
      schemaVersion: 1,
      eventId: "event-1",
      content: { format: "json", text: "{\"redacted\":true}", truncated: false }
    })).toMatchObject({ schemaVersion: 1, eventId: "event-1" });
    expect(() => nativeContentResponseV1Schema.parse({
      schemaVersion: 1,
      eventId: "event-1",
      content: { format: "json", value: { arbitrary: true }, truncated: false }
    })).toThrow();
  });

  it("keeps structured Git diff evidence closed and markup-free", () => {
    const diff = {
      schemaVersion: 1,
      kind: "diff",
      files: [{
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        headers: ["diff --git a/src/old.ts b/src/new.ts"],
        metadata: [{ type: "rename_from", text: "rename from src/old.ts" }],
        hunks: [{
          header: "@@ -1,2 +1,2 @@",
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 2,
          lines: [
            { type: "context", oldLineNumber: 1, newLineNumber: 1, text: "same" },
            { type: "delete", oldLineNumber: 2, newLineNumber: null, text: "old" },
            { type: "add", oldLineNumber: null, newLineNumber: 2, text: "new" }
          ]
        }]
      }],
      preamble: [],
      truncated: false,
      malformed: false
    } as const;
    expect(gitDiffContentV1Schema.parse(diff)).toEqual(diff);
    expect(() => gitDiffContentV1Schema.parse({
      ...diff,
      files: [{ ...diff.files[0], html: "<script>unsafe()</script>" }]
    })).toThrow();
    expect(() => gitDiffContentV1Schema.parse({
      ...diff,
      files: [{
        ...diff.files[0],
        hunks: [{
          ...diff.files[0].hunks[0],
          lines: [{
            ...diff.files[0].hunks[0].lines[0],
            oldLineNumber: null
          }]
        }]
      }]
    })).toThrow();
  });

  it("accepts only safe structured Git diff coordinates", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const valid = {
      schemaVersion: 1,
      kind: "diff",
      files: [{
        oldPath: "a.ts",
        newPath: "a.ts",
        headers: ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts"],
        metadata: [],
        hunks: [{
          header: `@@ -${maximum},${maximum} +${maximum},${maximum} @@`,
          oldStart: maximum,
          oldCount: maximum,
          newStart: maximum,
          newCount: maximum,
          lines: [{
            type: "context",
            oldLineNumber: maximum,
            newLineNumber: maximum,
            text: "boundary"
          }]
        }]
      }],
      preamble: [],
      truncated: true,
      malformed: false
    } as const;
    expect(gitDiffContentV1Schema.parse(valid)).toEqual(valid);

    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const baseHunk = valid.files[0].hunks[0];
    const withHunk = (hunk: Record<string, unknown>) => ({
      ...valid,
      files: [{ ...valid.files[0], hunks: [hunk] }]
    });
    for (const candidate of [
      withHunk({ ...baseHunk, oldStart: unsafe }),
      withHunk({ ...baseHunk, oldCount: unsafe }),
      withHunk({ ...baseHunk, newStart: unsafe }),
      withHunk({ ...baseHunk, newCount: unsafe }),
      withHunk({
        ...baseHunk,
        lines: [{ ...baseHunk.lines[0], oldLineNumber: unsafe }]
      }),
      withHunk({
        ...baseHunk,
        lines: [{ ...baseHunk.lines[0], newLineNumber: unsafe }]
      })
    ]) {
      expect(gitDiffContentV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it("requires the correct side-specific coordinate for every changed diff line", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const withLine = (line: {
      type: "add" | "delete" | "excluded";
      oldLineNumber: number | null;
      newLineNumber: number | null;
      text: string;
    }) => ({
      schemaVersion: 1,
      kind: "diff",
      files: [{
        oldPath: "a.ts",
        newPath: "a.ts",
        headers: ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts"],
        metadata: [],
        hunks: [{
          header: `@@ -${maximum} +${maximum} @@`,
          oldStart: maximum,
          oldCount: 1,
          newStart: maximum,
          newCount: 1,
          lines: [line]
        }]
      }],
      preamble: [],
      truncated: false,
      malformed: false
    });

    for (const valid of [
      withLine({ type: "add", oldLineNumber: null, newLineNumber: maximum, text: "added" }),
      withLine({ type: "excluded", oldLineNumber: null, newLineNumber: maximum, text: "excluded" }),
      withLine({ type: "delete", oldLineNumber: maximum, newLineNumber: null, text: "deleted" })
    ]) {
      expect(gitDiffContentV1Schema.safeParse(valid).success).toBe(true);
    }

    for (const missingRequiredCoordinate of [
      withLine({ type: "add", oldLineNumber: null, newLineNumber: null, text: "added" }),
      withLine({ type: "excluded", oldLineNumber: null, newLineNumber: null, text: "excluded" }),
      withLine({ type: "delete", oldLineNumber: null, newLineNumber: null, text: "deleted" })
    ]) {
      expect(gitDiffContentV1Schema.safeParse(missingRequiredCoordinate).success).toBe(false);
    }
  });

  it("preserves projected versus explicit human assessment provenance", () => {
    const projected = {
      schemaVersion: 1,
      state: "projected",
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "absent" },
      provenance: null,
      currentEventId: null,
      reviewedAt: null,
      updatedAt: null
    } as const;
    const explicit = {
      schemaVersion: 1,
      state: "explicit",
      verdict: "success",
      taskCompleted: "yes",
      note: { state: "available" },
      provenance: "human",
      currentEventId: "assessment-event",
      reviewedAt: 1_000,
      updatedAt: 1_100
    } as const;
    expect(currentAssessmentV1Schema.parse(projected)).toEqual(projected);
    expect(currentAssessmentV1Schema.parse(explicit)).toEqual(explicit);
    expect(() => currentAssessmentV1Schema.parse({ ...projected, provenance: "human" })).toThrow();
    expect(assessmentResponseV1Schema.parse({
      schemaVersion: 1,
      assessment: explicit,
      etag: '"assessment-event"'
    })).toMatchObject({ schemaVersion: 1, assessment: explicit });
    expect(assessmentConflictResponseV1Schema.parse({
      schemaVersion: 1,
      error: {
        code: "assessment_conflict",
        message: "Assessment changed.",
        retryable: false
      },
      assessment: explicit,
      etag: '"assessment:ZXZlbnQ"'
    })).toMatchObject({
      error: { code: "assessment_conflict", retryable: false },
      assessment: explicit
    });
    expect(() => assessmentConflictResponseV1Schema.parse({
      schemaVersion: 1,
      error: {
        code: "assessment_conflict",
        message: "Assessment changed.",
        retryable: false,
        databasePath: "/private/agentlens.sqlite"
      },
      assessment: explicit,
      etag: '"assessment:ZXZlbnQ"'
    })).toThrow();
  });

  it("keeps assessment updates closed and enforces the UTF-8 and explicit-unreviewed rules", () => {
    const valid = {
      schemaVersion: 1,
      verdict: "partial",
      taskCompleted: "uncertain",
      note: { state: "text", text: "é".repeat(8 * 1024) }
    } as const;
    expect(assessmentUpdateRequestV1Schema.parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, note: { state: "text", text: `${"é".repeat(8 * 1024)}a` } },
      { ...valid, verdict: "unreviewed", taskCompleted: "yes" },
      { ...valid, rawNote: "must-not-cross" }
    ]) expect(() => assessmentUpdateRequestV1Schema.parse(invalid)).toThrow();
  });

  it("bounds assessment IDs and ETags over the complete canonical UTF-8 domain", () => {
    const maximumEventId = "\u0800".repeat(256);
    const maximumEtag = `"assessment:${Buffer.from(maximumEventId).toString("base64url")}"`;
    const explicit = {
      schemaVersion: 1,
      state: "explicit",
      verdict: "success",
      taskCompleted: "yes",
      note: { state: "absent" },
      provenance: "human",
      currentEventId: maximumEventId,
      reviewedAt: 1,
      updatedAt: 1
    } as const;

    expect(assessmentResponseV1Schema.parse({
      schemaVersion: 1, assessment: explicit, etag: maximumEtag
    }).etag).toBe(maximumEtag);
    expect(() => currentAssessmentV1Schema.parse({
      ...explicit, currentEventId: "a".repeat(257)
    })).toThrow();
    expect(() => currentAssessmentV1Schema.parse({
      ...explicit, currentEventId: "broken-\ud800-surrogate"
    })).toThrow();
  });

  it.each(["\0", "\r", "\n", "\u007f", "\u0080", "\u009f"])(
    "rejects Unicode control U+%s from browser-addressable event IDs",
    (control) => {
      const eventId = `event${control}id`;
      expect(() => browserAddressableEventIdV1Schema.parse(eventId)).toThrow();
      expect(() => currentAssessmentV1Schema.parse({
        schemaVersion: 1,
        state: "explicit",
        verdict: "success",
        taskCompleted: "yes",
        note: { state: "absent" },
        provenance: "human",
        currentEventId: eventId,
        reviewedAt: 1,
        updatedAt: 1
      })).toThrow();
      expect(() => eventDetailV1Schema.parse({
        ...detailBase,
        eventId,
        presentationClass: "assessment",
        revision: eventId,
        verdict: "success",
        taskCompleted: "yes",
        note: { state: "absent" },
        content: availableContent
      })).toThrow();
    }
  );
});
