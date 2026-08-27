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
      nativePayload: { type: "future.event", future: { nested: 7 } }
    });
    expect(Object.isFrozen(drafts)).toBe(true);
    expect(Object.isFrozen(drafts[0])).toBe(true);
    expect(Object.isFrozen(drafts[0]?.nativePayload)).toBe(true);
    expect(Object.isFrozen((drafts[0]?.nativePayload as { future: object }).future)).toBe(true);
    expect(eventDraftV1Schema.parse(drafts[0])).toBeTruthy();
  });

  it.each([
    ["agent_message", "message.agent"],
    ["reasoning", "reasoning.summary"],
    ["command_execution", "command"],
    ["file_change", "file.change"],
    ["mcp_tool_call", "tool"],
    ["web_search", "tool"],
    ["todo_list", "plan.updated"],
    ["plan", "plan.updated"],
    ["plan_item", "plan.updated"]
  ])("maps planned item type %s to %s", (itemType, kind) => {
    const [draft] = normalizeCodexRecord({
      type: "item.completed",
      item: {
        id: `fixture-${itemType}`,
        type: itemType,
        status: "completed",
        text: "fixture content",
        items: [{ text: "fixture plan item", completed: false }]
      }
    });

    expect(draft).toMatchObject({
      kind,
      status: "completed",
      provenance: "observed",
      source: {
        provider: "codex-exec",
        eventType: "item.completed",
        itemId: `fixture-${itemType}`,
        itemType
      }
    });
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
      command: "fixture_command",
      status: "in_progress"
    });
    expect(draft?.normalizedPayload).not.toHaveProperty("exitCode");
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
