import test from "node:test";
import assert from "node:assert/strict";
import {
  projectRecordedRun,
  allowBridgeRequest,
} from "../server/recorded-projector.mjs";
const event = (id: string, sequence: number, payload: unknown, extra = {}) => ({
  id,
  runId: "run-1",
  sequence,
  receivedAt: 1000 + sequence,
  kind: "command",
  status: "completed",
  provenance: "observed",
  summary: "Command",
  source: { itemId: id },
  relationships: [],
  normalizedPayload: payload,
  ...extra,
});
const fixture = () => ({
  run: {
    id: "run-1",
    provider: "codex-exec",
    status: "completed",
    capturePolicy: "standard",
    startedAt: 1000,
    endedAt: 5000,
  },
  events: [
    event(
      "event-1",
      0,
      { command: "pnpm test", aggregatedOutput: "failed", exitCode: 1 },
      { status: "failed" },
    ),
    event("event-2", 1, {
      command: "pnpm test focused && pnpm typecheck",
      aggregatedOutput: "20 passed",
      exitCode: 0,
    }),
  ],
  summary: {
    elapsedRecorderTimeMs: { value: 4000, availability: "available" },
    observedTokenUsage: { state: "unavailable", reason: "redacted_by_policy" },
    likelyTests: {
      attempts: { total: 2, passed: 0, failed: 1, unknown: 1 },
      sourceEventIds: ["event-1", "event-2"],
      testCommandDetails: [
        {
          sourceEventId: "event-1",
          commandShape: "shell_wrapped",
          outcomeAttribution: "source_exit",
        },
        {
          sourceEventId: "event-2",
          commandShape: "compound",
          outcomeAttribution: "unavailable",
        },
      ],
      derivationId: "test-command/2",
      durability: "incomplete",
    },
    assessment: {
      state: "projected",
      verdict: "unreviewed",
      taskCompleted: "uncertain",
    },
  },
  reviewerNote: { content: "PRIVATE NOTE" },
  artifacts: [{ path: "/Users/private/secret" }],
});
const context = {
  title: "Recorded task",
  readerRevision: "abc",
  fetchedAt: 6000,
};
test("recorded completion does not turn failed commands into task success", () => {
  const value = projectRecordedRun(fixture(), context);
  assert.equal(value.status, "completed");
  assert.equal(value.failedCommandCount, 1);
  assert.equal(value.assessment.verdict, "unreviewed");
  assert.equal(value.events[0].exitCode, 1);
});
test("compound command output does not become an independently attributed test pass", () => {
  const value = projectRecordedRun(fixture(), context);
  assert.equal(value.events[1].testOutcome, "unknown");
  assert.equal(value.events[0].testOutcome, "fail");
  assert.equal(value.tests.passed, 0);
});
test("missing usage and model metadata stay unavailable", () => {
  const value = projectRecordedRun(fixture(), context);
  assert.equal(value.tokenUsageReason, "redacted_by_policy");
  assert.equal(value.model, null);
});
test("native artifact expansion restores output without exposing native payloads or private notes", () => {
  const input = fixture();
  input.events[0].normalizedPayload = {
    commandEvidence: { state: "available", redactedCommand: "pnpm test" },
    truncated: true,
    exitCode: 1,
  };
  Object.assign(input.events[0], {
    nativeContent: {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "pnpm test",
        aggregated_output: "ACTUAL OUTPUT",
        exit_code: 1,
      },
    },
  });
  const value = projectRecordedRun(input, context);
  assert.equal(value.events[0].output, "ACTUAL OUTPUT");
  assert.equal(value.events[0].outputState, "available");
  assert.ok(!JSON.stringify(value).includes("PRIVATE NOTE"));
  assert.ok(!JSON.stringify(value).includes("nativeContent"));
});
test("missing expanded output is explicitly unavailable", () => {
  const input = fixture();
  input.events[0].normalizedPayload = {
    commandEvidence: { state: "available", redactedCommand: "pnpm test" },
    truncated: true,
    exitCode: 1,
  };
  const value = projectRecordedRun(input, context);
  assert.equal(value.events[0].outputState, "unavailable");
  assert.equal(value.events[0].output, "");
});
test("projection refuses duplicate sequence numbers and foreign event identities", () => {
  const input = fixture();
  input.events[1].sequence = 0;
  assert.throws(() => projectRecordedRun(input, context));
  input.events[1].sequence = 1;
  input.events[1].runId = "other";
  assert.throws(() => projectRecordedRun(input, context));
});
test("evidence text is bounded with visible truncation and local path display masking", () => {
  const input = fixture();
  input.events[0].normalizedPayload = {
    command: "cat /Users/private/work/app.ts",
    aggregatedOutput: "x".repeat(200000),
    exitCode: 1,
  };
  const value = projectRecordedRun(input, context);
  assert.equal(value.events[0].outputState, "truncated");
  assert.ok(value.events[0].output.length <= 180000);
  assert.ok(!value.events[0].command.includes("/Users/private"));
});
test("read-only browser bridge rejects cross-site, rebinding and mutation requests", () => {
  const good = {
    method: "GET",
    url: "/api/recorded-run",
    headers: {
      host: "127.0.0.1:5178",
      "x-agentlens-read": "1",
      "sec-fetch-site": "same-origin",
    },
  };
  assert.equal(allowBridgeRequest(good), true);
  for (const request of [
    { ...good, method: "POST" },
    { ...good, url: "/api/recorded-run?run=other" },
    { ...good, headers: { ...good.headers, host: "evil.test:5178" } },
    { ...good, headers: { ...good.headers, origin: "https://evil.test" } },
    { ...good, headers: { ...good.headers, "sec-fetch-site": "cross-site" } },
    { ...good, headers: { host: "127.0.0.1:5178" } },
  ])
    assert.equal(allowBridgeRequest(request), false);
});
