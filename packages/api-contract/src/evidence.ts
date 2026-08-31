import { z } from "zod";

export const safeTokenV1Schema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export const opaqueSourceRefV1Schema = z.string().regex(/^src_[a-f0-9]{64}$/);

export const runStatusV1Schema = z.enum([
  "starting",
  "running",
  "completed",
  "failed",
  "interrupted",
  "recorder_error"
]);

export const eventStatusV1Schema = z.enum([
  "in_progress",
  "completed",
  "failed",
  "declined",
  "interrupted",
  "unknown"
]);

export const provenanceV1Schema = z.enum([
  "observed",
  "derived",
  "git_recovered",
  "recorder",
  "human"
]);

export const providerIdV1Schema = z.enum(["codex-exec", "claude-code"]);

export const presentationClassV1Schema = z.enum([
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
]);

function knownOrUnsupportedV1Schema<T extends z.ZodTypeAny>(known: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("known"), value: known }).strict(),
    z.object({ state: z.literal("unsupported"), safeToken: safeTokenV1Schema }).strict()
  ]);
}

export const runStatusFieldV1Schema = knownOrUnsupportedV1Schema(runStatusV1Schema);
export const eventStatusFieldV1Schema = knownOrUnsupportedV1Schema(eventStatusV1Schema);
export const providerFieldV1Schema = knownOrUnsupportedV1Schema(providerIdV1Schema);

export const browserSourceRefV1Schema = z.object({
  opaqueRef: opaqueSourceRefV1Schema,
  provider: providerFieldV1Schema,
  hasSessionOrThread: z.boolean(),
  hasTurn: z.boolean(),
  hasItemOrTool: z.boolean(),
  hasCorrelation: z.boolean()
}).strict();

export const evidenceUnavailableReasonV1Schema = z.enum([
  "provider_capability",
  "capture_policy",
  "not_captured",
  "not_yet_available",
  "artifact_omitted",
  "artifact_unreadable"
]);

export const evidenceOriginV1Schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event"),
    provenance: provenanceV1Schema
  }).strict(),
  z.object({
    type: z.literal("provider_capability"),
    provider: providerFieldV1Schema
  }).strict()
]);

export function evidenceValueV1Schema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("state", [
    z.object({
      state: z.literal("available"),
      value,
      origin: evidenceOriginV1Schema,
      supportingEventIds: z.array(z.string().min(1).max(256)).max(1_000),
      supportingArtifactIds: z.array(z.string().min(1).max(256)).max(1_000)
    }).strict(),
    z.object({
      state: z.literal("unavailable"),
      reason: evidenceUnavailableReasonV1Schema,
      origin: z.null(),
      supportingEventIds: z.array(z.string().min(1).max(256)).max(1_000),
      supportingArtifactIds: z.array(z.string().min(1).max(256)).max(1_000)
    }).strict()
  ]);
}

export type KnownOrUnsupportedV1<T extends string> =
  | Readonly<{ state: "known"; value: T }>
  | Readonly<{ state: "unsupported"; safeToken: string }>;
export type RunStatusV1 = z.infer<typeof runStatusV1Schema>;
export type EventStatusV1 = z.infer<typeof eventStatusV1Schema>;
export type ProvenanceV1 = z.infer<typeof provenanceV1Schema>;
export type ProviderIdV1 = z.infer<typeof providerIdV1Schema>;
export type PresentationClassV1 = z.infer<typeof presentationClassV1Schema>;
export type RunStatusFieldV1 = z.infer<typeof runStatusFieldV1Schema>;
export type EventStatusFieldV1 = z.infer<typeof eventStatusFieldV1Schema>;
export type ProviderFieldV1 = z.infer<typeof providerFieldV1Schema>;
export type BrowserSourceRefV1 = z.infer<typeof browserSourceRefV1Schema>;
export type EvidenceUnavailableReasonV1 = z.infer<typeof evidenceUnavailableReasonV1Schema>;
export type EvidenceOriginV1 = z.infer<typeof evidenceOriginV1Schema>;
