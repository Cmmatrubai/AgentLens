import type { CapturePolicy, TraceEventV1 } from "@agentlens/core";

import type { CommandEvidence } from "./types.js";

export const MAX_COMMAND_EVIDENCE_BYTES = 16 * 1024;

function asObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function available(redactedCommand: string): CommandEvidence {
  if (Buffer.byteLength(redactedCommand, "utf8") > MAX_COMMAND_EVIDENCE_BYTES) {
    return Object.freeze({ state: "omitted" as const, reason: "capture-bound" as const });
  }
  return Object.freeze({ state: "available" as const, redactedCommand });
}

function explicitEvidence(value: unknown): CommandEvidence | undefined {
  const evidence = asObject(value);
  if (!evidence) return undefined;

  if (evidence.state === "available" && typeof evidence.redactedCommand === "string") {
    return available(evidence.redactedCommand);
  }
  if (
    evidence.state === "omitted" &&
    (evidence.reason === "metadata-only" ||
      evidence.reason === "strict" ||
      evidence.reason === "capture-bound")
  ) {
    return Object.freeze({ state: "omitted" as const, reason: evidence.reason });
  }
  return undefined;
}

export function parseCommandEvidence(
  event: TraceEventV1,
  capturePolicy: CapturePolicy
): CommandEvidence | undefined {
  if (capturePolicy === "metadata-only" || capturePolicy === "strict") {
    return Object.freeze({ state: "omitted" as const, reason: capturePolicy });
  }

  const normalized = asObject(event.normalizedPayload);
  if (!normalized) return undefined;

  if (Object.prototype.hasOwnProperty.call(normalized, "commandEvidence")) {
    return explicitEvidence(normalized.commandEvidence);
  }
  if (typeof normalized.command === "string") {
    return Object.freeze({
      state: "available" as const,
      redactedCommand: normalized.command
    });
  }
  if (normalized.truncated === true) {
    return Object.freeze({ state: "omitted" as const, reason: "capture-bound" as const });
  }
  return undefined;
}
