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
import {
  MAX_COMMAND_EVIDENCE_BYTES,
  type CommandEvidence
} from "@agentlens/derivations";
import type { RunRepository } from "@agentlens/storage";

const INLINE_NATIVE_BYTES = 32 * 1024;
const INLINE_NORMALIZED_BYTES = 32 * 1024;

function asObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function isObservedCommand(draft: EventDraftV1): boolean {
  return draft.provenance === "observed" && draft.kind === "command";
}

function omittedCommandEvidence(
  reason: "metadata-only" | "strict" | "capture-bound"
): CommandEvidence {
  return Object.freeze({ state: "omitted" as const, reason });
}

function commandEvidenceFromRedacted(
  draft: EventDraftV1,
  redactedNormalized: unknown
): CommandEvidence | undefined {
  if (!isObservedCommand(draft)) return undefined;
  const command = asObject(redactedNormalized)?.command;
  if (
    typeof command !== "string" ||
    Buffer.byteLength(command, "utf8") > MAX_COMMAND_EVIDENCE_BYTES
  ) {
    return omittedCommandEvidence("capture-bound");
  }
  return Object.freeze({ state: "available" as const, redactedCommand: command });
}

function withCommandEvidence(payload: unknown, evidence: CommandEvidence | undefined): unknown {
  if (!evidence) return payload;
  return { ...(asObject(payload) ?? {}), commandEvidence: evidence };
}

function truncatedCommandFields(
  redactedNormalized: unknown,
  evidence: CommandEvidence | undefined
): Record<string, unknown> {
  if (!evidence) return {};
  const exitCode = asObject(redactedNormalized)?.exitCode;
  return {
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    commandEvidence: evidence
  };
}

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
  if (draft.kind === "recorder.invocation") return "prompt";
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
      if (typeof value.limitBytes === "number") result.limitBytes = value.limitBytes;
      if (typeof value.observedBytes === "number") result.observedBytes = value.observedBytes;
    }
  }
  if (draft.kind === "recorder.invocation") {
    const payload = draft.normalizedPayload;
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      const value = payload as Record<string, unknown>;
      if (value.promptSource === "stdin-buffered" || value.promptSource === "tty-inherited") {
        result.promptSource = value.promptSource;
      }
      const argv = value.argv;
      if (typeof argv === "object" && argv !== null && !Array.isArray(argv)) {
        const argumentCount = (argv as Record<string, unknown>).argumentCount;
        if (typeof argumentCount === "number") {
          result.argv = { state: "omitted", argumentCount };
        }
      }
      const stdin = value.stdin;
      if (typeof stdin === "object" && stdin !== null && !Array.isArray(stdin)) {
        const stdinValue = stdin as Record<string, unknown>;
        if (stdinValue.state === "absent") result.stdin = { state: "absent" };
        else if (typeof stdinValue.byteLength === "number") {
          result.stdin = { state: "omitted", byteLength: stdinValue.byteLength };
        }
      }
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
      const commandEvidence = commandEvidenceFromRedacted(draft, normalized.redacted);
      const augmentedNormalized = withCommandEvidence(normalized.redacted, commandEvidence);
      const augmentedSerialized = JSON.stringify(augmentedNormalized);
      if (augmentedSerialized === undefined) {
        throw new Error("Redacted normalized payload must be JSON-serializable.");
      }
      normalizedPayload = Buffer.byteLength(augmentedSerialized, "utf8") <= INLINE_NORMALIZED_BYTES
        ? augmentedNormalized
        : {
            ...structuralNormalized(draft),
            ...truncatedCommandFields(normalized.redacted, commandEvidence),
            truncated: true
          };
      normalizedAudits = normalized.audits;
    } else {
      normalizedPayload = withCommandEvidence(
        structuralNormalized(draft),
        isObservedCommand(draft)
          ? omittedCommandEvidence(context.capturePolicy)
          : undefined
      );
    }
  } else if (isObservedCommand(draft)) {
    normalizedPayload = {
      commandEvidence: context.capturePolicy === "standard"
        ? omittedCommandEvidence("capture-bound")
        : omittedCommandEvidence(context.capturePolicy)
    };
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
