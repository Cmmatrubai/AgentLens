import { describe, expect, it } from "vitest";

import {
  codexExecCapabilities as coreCodexExecCapabilities,
  eventDraftV1Schema
} from "@agentlens/core";
import {
  codexExecCapabilities,
  normalizeCodexRecord
} from "../src/index.js";

describe("Codex evidence-preserving normalization", () => {
  it("preserves unknown event fields for later redacted persistence", () => {
    const record = { type: "future.event", future: { nested: 7 } };

    const drafts = normalizeCodexRecord(record);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: "source.unknown",
      status: "unknown",
      provenance: "observed",
      source: { provider: "codex-exec", eventType: "future.event" },
      relationships: [],
      normalizedPayload: { eventType: "future.event" },
      nativePayload: { type: "future.event", future: { nested: 7 } }
    });
    expect(Object.isFrozen(drafts)).toBe(true);
    expect(Object.isFrozen(drafts[0])).toBe(true);
    expect(Object.isFrozen(drafts[0]?.nativePayload)).toBe(true);
    expect(Object.isFrozen((drafts[0]?.nativePayload as { future: object }).future)).toBe(true);
    expect(eventDraftV1Schema.parse(drafts[0])).toBeTruthy();
  });

  it.each([
    {
      name: "agent message text",
      item: {
        id: "fixture-agent-message",
        type: "agent_message",
        text: "fixture agent text"
      },
      kind: "message.agent",
      payload: {
        eventType: "item.completed",
        itemType: "agent_message",
        text: "fixture agent text"
      }
    },
    {
      name: "exposed reasoning summary",
      item: {
        id: "fixture-reasoning",
        type: "reasoning",
        text: "fixture exposed reasoning summary"
      },
      kind: "reasoning.summary",
      payload: {
        eventType: "item.completed",
        itemType: "reasoning",
        text: "fixture exposed reasoning summary"
      }
    },
    {
      name: "failed command fields",
      item: {
        id: "fixture-command",
        type: "command_execution",
        command: "fixture_command",
        aggregated_output: "fixture command output",
        exit_code: 7,
        status: "failed"
      },
      kind: "command",
      payload: {
        eventType: "item.completed",
        itemType: "command_execution",
        command: "fixture_command",
        aggregatedOutput: "fixture command output",
        exitCode: 7,
        status: "failed"
      }
    },
    {
      name: "file changes",
      item: {
        id: "fixture-file-change",
        type: "file_change",
        changes: [{ path: "fixture/source.ts", kind: "modify" }],
        status: "completed"
      },
      kind: "file.change",
      payload: {
        eventType: "item.completed",
        itemType: "file_change",
        changes: [{ path: "fixture/source.ts", kind: "modify" }],
        status: "completed"
      }
    },
    {
      name: "successful MCP fields",
      item: {
        id: "fixture-mcp-success",
        type: "mcp_tool_call",
        server: "fixture-server",
        tool: "fixture-tool",
        arguments: { input: "fixture-input" },
        result: { output: "fixture-output" },
        status: "completed"
      },
      kind: "tool",
      payload: {
        eventType: "item.completed",
        itemType: "mcp_tool_call",
        server: "fixture-server",
        tool: "fixture-tool",
        arguments: { input: "fixture-input" },
        result: { output: "fixture-output" },
        status: "completed"
      }
    },
    {
      name: "failed MCP error",
      item: {
        id: "fixture-mcp-error",
        type: "mcp_tool_call",
        server: "fixture-server",
        tool: "fixture-tool",
        arguments: { input: "fixture-input" },
        error: { message: "fixture error" },
        status: "failed"
      },
      kind: "tool",
      payload: {
        eventType: "item.completed",
        itemType: "mcp_tool_call",
        server: "fixture-server",
        tool: "fixture-tool",
        arguments: { input: "fixture-input" },
        error: { message: "fixture error" },
        status: "failed"
      }
    },
    {
      name: "web query",
      item: {
        id: "fixture-web-search",
        type: "web_search",
        query: "fixture query",
        status: "completed"
      },
      kind: "tool",
      payload: {
        eventType: "item.completed",
        itemType: "web_search",
        query: "fixture query",
        status: "completed"
      }
    },
    {
      name: "plan items and text",
      item: {
        id: "fixture-todo-list",
        type: "todo_list",
        items: [{ text: "fixture plan item", completed: false }],
        text: "fixture plan text",
        status: "completed"
      },
      kind: "plan.updated",
      payload: {
        eventType: "item.completed",
        itemType: "todo_list",
        items: [{ text: "fixture plan item", completed: false }],
        text: "fixture plan text",
        status: "completed"
      }
    }
  ])("maps $name without dropping fields", ({ item, kind, payload }) => {
    const [draft] = normalizeCodexRecord({
      type: "item.completed",
      item
    });

    expect(draft).toMatchObject({
      kind,
      provenance: "observed",
      source: {
        provider: "codex-exec",
        eventType: "item.completed",
        itemId: item.id,
        itemType: item.type
      },
      normalizedPayload: payload
    });
  });

  it.each([
    [{}, { classification: "unknown" }],
    [{ type: "future.event" }, { eventType: "future.event" }],
    [{ type: "thread.started" }, { eventType: "thread.started" }],
    [{ type: "turn.started" }, { eventType: "turn.started" }],
    [{ type: "error" }, { eventType: "error" }],
    [
      { type: "item.completed", item: { type: "agent_message" } },
      { eventType: "item.completed", itemType: "agent_message" }
    ]
  ])("always includes structural normalized payload for %#", (record, payload) => {
    const [draft] = normalizeCodexRecord(record);

    expect(draft?.normalizedPayload).toEqual(payload);
  });

  it.each([
    ["turn.started", "turn.started", "in_progress"],
    ["turn.completed", "turn.completed", "completed"],
    ["turn.failed", "turn.failed", "failed"],
    ["error", "error", "failed"]
  ])("maps provider event %s to %s with %s status", (eventType, kind, status) => {
    const [draft] = normalizeCodexRecord({
      type: eventType,
      message: "fixture provider message"
    });

    expect(draft).toMatchObject({
      kind,
      status,
      provenance: "observed",
      source: { provider: "codex-exec", eventType }
    });
  });

  it("preserves every present native source identifier without inventing absent ones", () => {
    const [withIdentifiers] = normalizeCodexRecord({
      type: "item.completed",
      session_id: "fixture-session-001",
      thread_id: "fixture-thread-001",
      turn_id: "fixture-turn-001",
      correlation_id: "fixture-correlation-001",
      item: {
        id: "fixture-item-001",
        type: "mcp_tool_call",
        tool_id: "fixture-tool-001",
        server: "fixture-server",
        tool: "fixture-tool",
        status: "completed"
      }
    });
    const [withoutIdentifiers] = normalizeCodexRecord({ type: "turn.started" });

    expect(withIdentifiers?.source).toEqual({
      provider: "codex-exec",
      sessionId: "fixture-session-001",
      threadId: "fixture-thread-001",
      turnId: "fixture-turn-001",
      itemId: "fixture-item-001",
      toolId: "fixture-tool-001",
      eventType: "item.completed",
      itemType: "mcp_tool_call",
      correlationId: "fixture-correlation-001"
    });
    expect(withoutIdentifiers?.source).toEqual({
      provider: "codex-exec",
      eventType: "turn.started"
    });
    expect(withoutIdentifiers).not.toHaveProperty("sourceOccurredAt");
  });

  it("does not reinterpret a top-level event id as a missing item id", () => {
    const [draft] = normalizeCodexRecord({
      id: "fixture-native-event-001",
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "fixture message"
      }
    });

    expect(draft?.source).toEqual({
      provider: "codex-exec",
      eventType: "item.completed",
      itemType: "agent_message"
    });
    expect(draft?.nativePayload).toMatchObject({ id: "fixture-native-event-001" });
  });

  it("does not invent a missing command exit code", () => {
    const [draft] = normalizeCodexRecord({
      type: "item.started",
      item: {
        id: "fixture-command-001",
        type: "command_execution",
        command: "fixture_command",
        status: "in_progress"
      }
    });

    expect(draft?.normalizedPayload).toEqual({
      eventType: "item.started",
      itemType: "command_execution",
      command: "fixture_command",
      status: "in_progress"
    });
    expect(draft?.normalizedPayload).not.toHaveProperty("exitCode");
  });

  it("projects only approved nonnegative safe-integer turn usage counters", () => {
    const [draft] = normalizeCodexRecord({
      type: "turn.completed",
      usage: {
        input_tokens: 11,
        cached_input_tokens: 3,
        output_tokens: 7,
        reasoning_output_tokens: 2,
        cache_write_input_tokens: 5,
        total_tokens: 123456789,
        access_token: 987654321,
        refresh_token: "UNAPPROVED_SECRET_VALUE",
        future_numeric_usage: 42,
        negative_usage: -1,
        fractional_usage: 0.5,
        nan_equivalent_usage: null,
        unsafe_usage: Number.MAX_SAFE_INTEGER + 1
      }
    });

    expect(draft?.normalizedPayload).toMatchObject({
      usageCounters: {
        input: 11,
        cachedInput: 3,
        output: 7,
        reasoningOutput: 2,
        cacheWriteInput: 5
      }
    });
    expect(draft?.normalizedPayload).not.toHaveProperty("usageCounters.total");
    expect(draft?.normalizedPayload).not.toHaveProperty("usageCounters.access");
    expect(draft?.nativePayload).toMatchObject({
      usage: {
        total_tokens: 123456789,
        access_token: 987654321,
        refresh_token: "UNAPPROVED_SECRET_VALUE",
        future_numeric_usage: 42
      }
    });
  });

  it("omits usage counters when no approved turn usage value is a nonnegative safe integer", () => {
    const [draft] = normalizeCodexRecord({
      type: "turn.completed",
      usage: {
        input_tokens: -1,
        cached_input_tokens: 0.5,
        output_tokens: null,
        reasoning_output_tokens: Number.MAX_SAFE_INTEGER + 1,
        cache_write_input_tokens: -2
      }
    });

    expect(draft?.normalizedPayload).not.toHaveProperty("usageCounters");
  });

  it("omits usage counters when the turn usage object has no approved keys", () => {
    const [draft] = normalizeCodexRecord({
      type: "turn.completed",
      usage: { total_tokens: 123456789, future_numeric_usage: 42 }
    });

    expect(draft?.normalizedPayload).not.toHaveProperty("usageCounters");
  });

  it("re-exports the frozen core Codex capability object as one source of truth", () => {
    expect(codexExecCapabilities).toBe(coreCodexExecCapabilities);
    expect(codexExecCapabilities).toEqual({
      sourceTimestamps: false,
      fileReads: "unavailable",
      toolOutput: "partial",
      toolDurations: "unavailable",
      interruptionSignal: "partial"
    });
  });
});
