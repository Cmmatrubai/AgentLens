import type { TraceEventV1 } from "@agentlens/core";
import {
  buildTestDerivationDrafts,
  classifyTestCommand,
  parseCommandEvidence
} from "@agentlens/derivations";
import type { RunRepository } from "@agentlens/storage";

export interface DerivePersistedTerminalCommandInput {
  readonly repository: RunRepository;
  readonly runId: string;
  readonly sourceEventId: string;
}

export interface EnsureTestDerivationsForRunInput {
  readonly repository: RunRepository;
  readonly runId: string;
}

function asObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}

function isEligibleTerminalCommand(event: TraceEventV1): event is TraceEventV1 & {
  status: "completed" | "failed";
} {
  if (
    event.provenance !== "observed" ||
    event.kind !== "command" ||
    (event.status !== "completed" && event.status !== "failed")
  ) return false;
  if (event.source.itemType !== undefined && event.source.itemType !== "command_execution") {
    return false;
  }
  return event.source.eventType === undefined ||
    event.source.eventType === "item.completed" ||
    event.source.eventType === "item.failed";
}

function numericExitCode(event: TraceEventV1): number | null {
  const value = asObject(event.normalizedPayload)?.exitCode;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function derivePersistedTerminalCommand(
  input: DerivePersistedTerminalCommandInput
): readonly TraceEventV1[] {
  if (!input.repository.schemaCapabilities.derivationIdentities) return [];
  const detail = input.repository.getRunDetail(input.runId);
  if (detail.run.capturePolicy !== "standard") return [];
  const source = detail.events.find(({ id }) => id === input.sourceEventId);
  if (!source || !isEligibleTerminalCommand(source)) return [];

  const evidence = parseCommandEvidence(source, detail.run.capturePolicy);
  if (evidence?.state !== "available") return [];
  const exitCode = numericExitCode(source);
  let classification;
  try {
    classification = classifyTestCommand({
      command: evidence.redactedCommand,
      exitCode,
      eventStatus: source.status
    });
  } catch {
    return [];
  }
  if (!classification) return [];

  return buildTestDerivationDrafts({
    runId: source.runId,
    sourceEventId: source.id,
    sourceProvider: detail.run.provider,
    eventStatus: source.status,
    exitCode,
    classification
  }).map((draft) => input.repository.appendDerivedEvent({
    identity: draft.derivation.identity,
    sourceEventId: source.id,
    eventId: draft.id,
    receivedAt: source.receivedAt,
    kind: draft.kind,
    status: draft.status,
    sourceProvider: detail.run.provider,
    summary: draft.summary,
    normalizedPayload: draft.normalizedPayload,
    derivation: {
      name: draft.derivation.name,
      version: draft.derivation.version,
      identity: draft.derivation.identity,
      confidence: draft.derivation.confidence
    }
  }));
}

export function ensureTestDerivationsForRun(
  input: EnsureTestDerivationsForRunInput
): readonly TraceEventV1[] {
  if (!input.repository.schemaCapabilities.derivationIdentities) return [];
  const detail = input.repository.getRunDetail(input.runId);
  if (detail.run.capturePolicy !== "standard") return [];

  const winners: TraceEventV1[] = [];
  for (const event of detail.events) {
    if (!isEligibleTerminalCommand(event)) continue;
    winners.push(...derivePersistedTerminalCommand({
      repository: input.repository,
      runId: input.runId,
      sourceEventId: event.id
    }));
  }
  return winners;
}
