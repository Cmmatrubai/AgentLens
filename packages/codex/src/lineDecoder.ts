import type { EventDraftV1 } from "@agentlens/core";

export type CodexStream = "stdout" | "stderr";
export type CodexRecord = Record<string, unknown>;

export type CodexDecodedLine =
  | Readonly<{ type: "provider_record"; record: CodexRecord }>
  | Readonly<{ type: "diagnostic"; draft: EventDraftV1 }>;

export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;

  const seen = new WeakSet<object>();
  const pending: object[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;

    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const child = Reflect.get(current, key);
      if (child !== null && typeof child === "object" && !seen.has(child)) {
        pending.push(child);
      }
    }
    Object.freeze(current);
  }

  return value;
}

function diagnostic(
  line: string,
  stream: CodexStream,
  reason: "stderr" | "malformed_json" | "non_object_json" | "freeze_failed"
): CodexDecodedLine {
  const draft: EventDraftV1 = {
    kind: "recorder.stream_diagnostic",
    status: "unknown",
    provenance: "recorder",
    source: { provider: "codex-exec" },
    relationships: [],
    summary: `Codex ${stream} stream diagnostic`,
    normalizedPayload: { stream, reason },
    nativePayload: { stream, line }
  };

  return freezeDeep({ type: "diagnostic" as const, draft });
}

/**
 * Decodes one already-split child-process line without allowing malformed or
 * non-provider output to terminate recording.
 */
export function decodeCodexLine(line: string, stream: CodexStream): CodexDecodedLine {
  if (stream === "stderr") return diagnostic(line, stream, "stderr");

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return diagnostic(line, stream, "malformed_json");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return diagnostic(line, stream, "non_object_json");
  }

  try {
    return freezeDeep({
      type: "provider_record" as const,
      record: parsed as CodexRecord
    });
  } catch {
    return diagnostic(line, stream, "freeze_failed");
  }
}
