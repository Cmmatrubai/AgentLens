import {
  ArtifactStore,
  prepareNativePayload,
  redactJson,
  redactText,
  type CapturePolicy,
  type ContentClass,
  type EventDraftV1,
  type NativePayloadRefV1,
  type RedactionAudit,
  type TraceEventV1
} from "@agentlens/core";
import type { RunRepository } from "@agentlens/storage";

const INLINE_NATIVE_BYTES = 32 * 1024;
const INLINE_NORMALIZED_BYTES = 32 * 1024;

export interface PersistEventContext {
  readonly runId: string;
  readonly capturePolicy: CapturePolicy;
  readonly redactionKey: Buffer;
  readonly artifactStore: ArtifactStore;
  readonly repository: RunRepository;
  readonly committedArtifactIds: Set<string>;
  readonly nextEventId: () => string;
  readonly nextSequence: () => number;
  readonly receivedAt: () => string;
}

function contentClassFor(draft: EventDraftV1): ContentClass {
  if (draft.kind === "message.agent") return "message";
  if (draft.kind === "command") return "command";
  if (draft.kind === "tool") return "tool";
  if (draft.kind === "recorder.stream_diagnostic") {
    const payload = draft.normalizedPayload as { stream?: unknown } | undefined;
    return payload?.stream === "stderr" ? "stderr" : "diagnostic";
  }
  return "summary";
}

function structuralNormalized(draft: EventDraftV1): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (draft.source.eventType) result.eventType = draft.source.eventType;
  if (draft.source.itemType) result.itemType = draft.source.itemType;
  if (draft.kind === "recorder.stream_diagnostic") {
    const payload = draft.normalizedPayload;
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      const value = payload as Record<string, unknown>;
      if (value.stream === "stdout" || value.stream === "stderr") result.stream = value.stream;
      if (typeof value.reason === "string") result.reason = value.reason;
    }
  }
  return result;
}

function audits(...groups: readonly (readonly RedactionAudit[])[]): RedactionAudit[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const audit of group) counts.set(audit.reason, (counts.get(audit.reason) ?? 0) + audit.count);
  }
  return [...counts].map(([reason, count]) => ({ reason, count }));
}

export async function persistEventDraft(
  draft: EventDraftV1,
  context: PersistEventContext
): Promise<TraceEventV1> {
  const contentClass = contentClassFor(draft);
  const summary = redactText(draft.summary, {
    policy: context.capturePolicy,
    key: context.redactionKey,
    contentClass
  });

  let normalizedPayload: unknown;
  let normalizedAudits: readonly RedactionAudit[] = [];
  if (draft.normalizedPayload !== undefined) {
    if (context.capturePolicy === "standard") {
      const normalized = redactJson(draft.normalizedPayload, {
        policy: context.capturePolicy,
        key: context.redactionKey,
        contentClass: "native",
        runId: context.runId
      });
      if (normalized.storage !== "content") throw new Error("Standard normalized payload was omitted.");
      normalizedPayload = normalized.redactedBytes.byteLength <= INLINE_NORMALIZED_BYTES
        ? normalized.redacted
        : { ...structuralNormalized(draft), truncated: true };
      normalizedAudits = normalized.audits;
    } else {
      normalizedPayload = structuralNormalized(draft);
    }
  }

  let nativePayload: NativePayloadRefV1 | undefined;
  let eventNativeAudits: readonly RedactionAudit[] = [];
  if (draft.nativePayload !== undefined) {
    const native = redactJson(draft.nativePayload, {
      policy: context.capturePolicy,
      key: context.redactionKey,
      contentClass: "native",
      runId: context.runId
    });
    if (native.storage === "content" && native.redactedBytes.byteLength > INLINE_NATIVE_BYTES) {
      const completed = await context.artifactStore.writeRedacted({
        runId: context.runId,
        kind: "native-payload",
        redactedBytes: native.redactedBytes,
        mediaType: "application/json"
      });
      if (!context.committedArtifactIds.has(completed.id)) {
        await context.repository.commitArtifactMetadata(completed, native.audits);
        context.committedArtifactIds.add(completed.id);
      }
      nativePayload = Object.freeze({ storage: "artifact" as const, artifactId: completed.id });
    } else {
      nativePayload = await prepareNativePayload(native, context.artifactStore);
      if (native.storage === "content") eventNativeAudits = native.audits;
    }
  }

  const event: TraceEventV1 = {
    id: context.nextEventId(),
    runId: context.runId,
    sequence: context.nextSequence(),
    receivedAt: context.receivedAt(),
    kind: draft.kind,
    status: draft.status,
    provenance: draft.provenance,
    source: draft.source,
    relationships: draft.relationships,
    summary: summary.text,
    ...(normalizedPayload === undefined ? {} : { normalizedPayload }),
    ...(nativePayload === undefined ? {} : { nativePayload }),
    ...(draft.derivation === undefined ? {} : { derivation: draft.derivation })
  };
  return context.repository.appendEvent(
    event,
    audits(summary.audits, normalizedAudits, eventNativeAudits)
  );
}
