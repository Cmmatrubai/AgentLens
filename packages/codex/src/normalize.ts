import type {
  EventDraftV1,
  EventStatus,
  NativeSourceV1
} from "@agentlens/core";

import { freezeDeep, type CodexRecord } from "./lineDecoder.js";

type JsonObject = Record<string, unknown>;

const ITEM_KINDS: Readonly<Record<string, string>> = {
  agent_message: "message.agent",
  reasoning: "reasoning.summary",
  command_execution: "command",
  file_change: "file.change",
  mcp_tool_call: "tool",
  web_search: "tool",
  todo_list: "plan.updated",
  plan: "plan.updated",
  plan_item: "plan.updated"
};

const EVENT_STATUSES = new Set<EventStatus>([
  "in_progress",
  "completed",
  "failed",
  "declined",
  "interrupted",
  "unknown"
]);

function asObject(value: unknown): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function presentString(
  objects: readonly (JsonObject | undefined)[],
  keys: readonly string[]
): string | undefined {
  for (const object of objects) {
    if (!object) continue;
    for (const key of keys) {
      const value = object[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

function cloneRecord(record: CodexRecord): CodexRecord {
  try {
    return structuredClone(record) as CodexRecord;
  } catch {
    return { ...record };
  }
}

function buildSource(record: JsonObject, item: JsonObject | undefined): NativeSourceV1 {
  const source: NativeSourceV1 = { provider: "codex-exec" };
  const recordThenItem = [record, item] as const;
  const itemThenRecord = [item, record] as const;

  const sessionId = presentString(recordThenItem, ["session_id", "sessionId"]);
  const threadId = presentString(recordThenItem, ["thread_id", "threadId"]);
  const turnId = presentString(recordThenItem, ["turn_id", "turnId"]);
  const itemId =
    presentString([item], ["id", "item_id", "itemId"]) ??
    presentString([record], ["item_id", "itemId"]);
  const toolId = presentString(itemThenRecord, ["tool_id", "toolId"]);
  const eventType = presentString([record], ["type"]);
  const itemType = presentString([item], ["type"]);
  const correlationId = presentString(recordThenItem, [
    "correlation_id",
    "correlationId",
    "call_id",
    "callId"
  ]);

  if (sessionId) source.sessionId = sessionId;
  if (threadId) source.threadId = threadId;
  if (turnId) source.turnId = turnId;
  if (itemId) source.itemId = itemId;
  if (toolId) source.toolId = toolId;
  if (eventType) source.eventType = eventType;
  if (itemType) source.itemType = itemType;
  if (correlationId) source.correlationId = correlationId;

  return source;
}

function statusFromItem(eventType: string | undefined, item: JsonObject): EventStatus {
  const status = item.status;
  if (typeof status === "string" && EVENT_STATUSES.has(status as EventStatus)) {
    return status as EventStatus;
  }
  if (eventType === "item.started") return "in_progress";
  if (eventType === "item.completed") return "completed";
  if (eventType === "item.failed") return "failed";
  return "unknown";
}

function copyPresent(
  target: JsonObject,
  source: JsonObject,
  targetKey: string,
  ...sourceKeys: string[]
): void {
  for (const key of sourceKeys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[targetKey] = source[key];
      return;
    }
  }
}

function itemPayload(itemType: string, item: JsonObject): JsonObject {
  const payload: JsonObject = {};

  switch (itemType) {
    case "agent_message":
    case "reasoning":
      copyPresent(payload, item, "text", "text");
      break;
    case "command_execution":
      copyPresent(payload, item, "command", "command");
      copyPresent(payload, item, "aggregatedOutput", "aggregated_output", "aggregatedOutput");
      copyPresent(payload, item, "exitCode", "exit_code", "exitCode");
      copyPresent(payload, item, "status", "status");
      break;
    case "file_change":
      copyPresent(payload, item, "changes", "changes");
      copyPresent(payload, item, "status", "status");
      break;
    case "mcp_tool_call":
      copyPresent(payload, item, "server", "server");
      copyPresent(payload, item, "tool", "tool");
      copyPresent(payload, item, "arguments", "arguments");
      copyPresent(payload, item, "result", "result");
      copyPresent(payload, item, "error", "error");
      copyPresent(payload, item, "status", "status");
      break;
    case "web_search":
      copyPresent(payload, item, "query", "query");
      copyPresent(payload, item, "status", "status");
      break;
    case "todo_list":
    case "plan":
    case "plan_item":
      copyPresent(payload, item, "items", "items");
      copyPresent(payload, item, "text", "text");
      copyPresent(payload, item, "status", "status");
      break;
  }

  return payload;
}

function itemSummary(itemType: string): string {
  switch (itemType) {
    case "agent_message":
      return "Codex agent message";
    case "reasoning":
      return "Codex reasoning summary";
    case "command_execution":
      return "Codex command execution";
    case "file_change":
      return "Codex file change";
    case "mcp_tool_call":
      return "Codex MCP tool call";
    case "web_search":
      return "Codex web search";
    case "todo_list":
    case "plan":
    case "plan_item":
      return "Codex plan update";
    default:
      return "Unknown Codex item";
  }
}

function unknownDraft(record: JsonObject, item: JsonObject | undefined): EventDraftV1 {
  return {
    kind: "source.unknown",
    status: "unknown",
    provenance: "observed",
    source: buildSource(record, item),
    relationships: [],
    summary: "Unknown Codex source record",
    nativePayload: record
  };
}

function eventDraft(record: JsonObject, eventType: string): EventDraftV1 | undefined {
  const source = buildSource(record, undefined);
  const base = {
    provenance: "observed" as const,
    source,
    relationships: [],
    nativePayload: record
  };

  switch (eventType) {
    case "thread.started":
      return {
        ...base,
        kind: "thread.started",
        status: "in_progress",
        summary: "Codex thread started"
      };
    case "turn.started":
      return {
        ...base,
        kind: "turn.started",
        status: "in_progress",
        summary: "Codex turn started"
      };
    case "turn.completed": {
      const draft: EventDraftV1 = {
        ...base,
        kind: "turn.completed",
        status: "completed",
        summary: "Codex turn completed"
      };
      if (Object.prototype.hasOwnProperty.call(record, "usage")) {
        draft.normalizedPayload = { usage: record.usage };
      }
      return draft;
    }
    case "turn.failed": {
      const draft: EventDraftV1 = {
        ...base,
        kind: "turn.failed",
        status: "failed",
        summary: "Codex turn failed"
      };
      const payload: JsonObject = {};
      copyPresent(payload, record, "message", "message");
      copyPresent(payload, record, "error", "error");
      if (Object.keys(payload).length > 0) draft.normalizedPayload = payload;
      return draft;
    }
    case "error": {
      const draft: EventDraftV1 = {
        ...base,
        kind: "error",
        status: "failed",
        summary: "Codex provider error"
      };
      const payload: JsonObject = {};
      copyPresent(payload, record, "message", "message");
      copyPresent(payload, record, "error", "error");
      if (Object.keys(payload).length > 0) draft.normalizedPayload = payload;
      return draft;
    }
    default:
      return undefined;
  }
}

/**
 * Normalizes one accepted provider object to exactly one immutable draft. The
 * complete provider object remains attached in memory for Task 5 redaction.
 */
export function normalizeCodexRecord(record: CodexRecord): EventDraftV1[] {
  const nativeRecord = cloneRecord(record);
  const eventType = presentString([nativeRecord], ["type"]);
  const item = asObject(nativeRecord.item);

  let draft: EventDraftV1;
  if (eventType?.startsWith("item.") && item) {
    const itemType = presentString([item], ["type"]);
    const kind = itemType ? ITEM_KINDS[itemType] : undefined;
    if (!itemType || !kind) {
      draft = unknownDraft(nativeRecord, item);
    } else {
      const payload = itemPayload(itemType, item);
      draft = {
        kind,
        status: statusFromItem(eventType, item),
        provenance: "observed",
        source: buildSource(nativeRecord, item),
        relationships: [],
        summary: itemSummary(itemType),
        nativePayload: nativeRecord
      };
      if (Object.keys(payload).length > 0) draft.normalizedPayload = payload;
    }
  } else if (eventType) {
    draft = eventDraft(nativeRecord, eventType) ?? unknownDraft(nativeRecord, item);
  } else {
    draft = unknownDraft(nativeRecord, item);
  }

  return freezeDeep([draft]);
}
