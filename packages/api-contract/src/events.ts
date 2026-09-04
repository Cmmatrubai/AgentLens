import { z } from "zod";

import {
  browserSourceRefV1Schema,
  eventStatusFieldV1Schema,
  provenanceV1Schema,
  safeTokenV1Schema
} from "./evidence.js";
import {
  assessmentNoteAvailabilityV1Schema,
  assessmentVerdictV1Schema,
  browserAddressableEventIdV1Schema,
  taskCompletionV1Schema
} from "./assessment.js";
import { browserAddressableRunIdV1Schema } from "./runs.js";

const boundedId = z.string().min(1).max(256);
const boundedText = z.string().max(262_144);
const boundedSummary = z.string().max(512);
const nonnegativeInteger = z.number().int().nonnegative();

export const eventRelationshipTypeV1Schema = z.enum([
  "derived_from",
  "recovers",
  "correlates_with"
]);

export const eventRelationshipV1Schema = z.object({
  type: eventRelationshipTypeV1Schema,
  eventId: browserAddressableEventIdV1Schema
}).strict();

export const derivationV1Schema = z.object({
  name: safeTokenV1Schema,
  version: safeTokenV1Schema,
  sourceEventIds: z.array(browserAddressableEventIdV1Schema).min(1).max(1_000),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  identity: boundedId.optional()
}).strict();

export const timestampAvailabilityV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), value: z.string().datetime() }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.literal("not_captured") }).strict()
]);

export const contentAvailabilityV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available") }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum([
      "capture_policy",
      "not_captured",
      "artifact_omitted",
      "artifact_unreadable",
      "unsupported_kind"
    ])
  }).strict()
]);

export const nativePayloadAvailabilityV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), storage: z.enum(["inline", "artifact"]) }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum(["capture_policy", "not_captured", "artifact_omitted", "artifact_unreadable"])
  }).strict()
]);

export const detailAvailabilityV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available") }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.literal("unsupported_kind") }).strict()
]);

export const trajectoryLifecycleV1Schema = z.object({
  domain: z.enum(["item", "tool", "thread", "turn"]),
  phase: z.enum(["started", "completed", "failed", "declined", "interrupted"])
}).strict();

export const trajectoryEventV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventId: browserAddressableEventIdV1Schema,
  runId: browserAddressableRunIdV1Schema,
  sequence: nonnegativeInteger,
  receivedAt: z.string().datetime(),
  sourceOccurredAt: timestampAvailabilityV1Schema,
  kind: safeTokenV1Schema,
  status: eventStatusFieldV1Schema,
  provenance: provenanceV1Schema,
  presentationClass: z.enum([
    "lifecycle", "message", "reasoning", "command", "file_change", "tool", "plan",
    "git", "recorder", "recorder_recovery", "test", "assessment", "error", "unknown"
  ]),
  safeSummary: boundedSummary,
  source: browserSourceRefV1Schema,
  relationships: z.array(eventRelationshipV1Schema).max(1_000),
  derivation: derivationV1Schema.nullable(),
  nativePayload: nativePayloadAvailabilityV1Schema,
  lifecycleGroupKey: z.string().regex(/^grp_[a-f0-9]{64}$/).nullable(),
  lifecycle: trajectoryLifecycleV1Schema.nullable(),
  detail: detailAvailabilityV1Schema
}).strict();

const detailBase = {
  schemaVersion: z.literal(1),
  eventId: browserAddressableEventIdV1Schema,
  runId: browserAddressableRunIdV1Schema,
  sequence: nonnegativeInteger,
  kind: safeTokenV1Schema,
  status: eventStatusFieldV1Schema,
  provenance: provenanceV1Schema,
  relationships: z.array(eventRelationshipV1Schema).max(1_000)
};

const lifecycleDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("lifecycle"),
  phase: safeTokenV1Schema,
  content: contentAvailabilityV1Schema
}).strict();
const messageDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("message"),
  role: z.enum(["agent", "user", "system", "unknown"]),
  content: contentAvailabilityV1Schema
}).strict();
const reasoningDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("reasoning"),
  content: contentAvailabilityV1Schema
}).strict();
const commandDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("command"),
  lifecycle: z.enum(["in_progress", "completed", "failed", "declined", "interrupted", "unknown"]),
  exitCode: z.number().int().nullable(),
  output: contentAvailabilityV1Schema,
  content: contentAvailabilityV1Schema
}).strict();
const fileChangeDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("file_change"),
  changeCount: nonnegativeInteger,
  content: contentAvailabilityV1Schema
}).strict();
const toolDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("tool"),
  toolName: safeTokenV1Schema,
  toolStatus: eventStatusFieldV1Schema,
  content: contentAvailabilityV1Schema
}).strict();
const planDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("plan"),
  steps: z.object({
    total: nonnegativeInteger,
    completed: nonnegativeInteger,
    inProgress: nonnegativeInteger,
    failed: nonnegativeInteger
  }).strict(),
  content: contentAvailabilityV1Schema
}).strict();
const gitDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("git"),
  evidence: contentAvailabilityV1Schema,
  content: contentAvailabilityV1Schema
}).strict();
const recorderDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("recorder"),
  diagnosticClass: safeTokenV1Schema,
  content: contentAvailabilityV1Schema
}).strict();
const recorderRecoveryDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("recorder_recovery"),
  recoveryClass: z.literal("interrupted_open_event"),
  recoveredEventIds: z.array(browserAddressableEventIdV1Schema).min(1).max(1_000),
  content: contentAvailabilityV1Schema
}).strict();
const testDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("test"),
  derivation: derivationV1Schema,
  result: z.enum(["passed", "failed", "unknown"]),
  content: contentAvailabilityV1Schema
}).strict();
const assessmentDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("assessment"),
  revision: browserAddressableEventIdV1Schema,
  verdict: assessmentVerdictV1Schema,
  taskCompleted: taskCompletionV1Schema,
  note: assessmentNoteAvailabilityV1Schema,
  content: contentAvailabilityV1Schema
}).strict();
const errorDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("error"),
  errorClass: safeTokenV1Schema,
  content: contentAvailabilityV1Schema
}).strict();
const unknownDetailV1Schema = z.object({
  ...detailBase,
  presentationClass: z.literal("unknown"),
  content: z.object({
    state: z.literal("unavailable"),
    reason: z.literal("unsupported_kind")
  }).strict()
}).strict();

export const eventDetailV1Schema = z.discriminatedUnion("presentationClass", [
  lifecycleDetailV1Schema,
  messageDetailV1Schema,
  reasoningDetailV1Schema,
  commandDetailV1Schema,
  fileChangeDetailV1Schema,
  toolDetailV1Schema,
  planDetailV1Schema,
  gitDetailV1Schema,
  recorderDetailV1Schema,
  recorderRecoveryDetailV1Schema,
  testDetailV1Schema,
  assessmentDetailV1Schema,
  errorDetailV1Schema,
  unknownDetailV1Schema
]);

const messageContentV1Schema = z.object({
  kind: z.literal("message"),
  role: z.enum(["agent", "user", "system", "unknown"]),
  text: boundedText
}).strict();
const reasoningContentV1Schema = z.object({ kind: z.literal("reasoning"), text: boundedText }).strict();
const commandContentV1Schema = z.object({
  kind: z.literal("command"), command: boundedText, exitCode: z.number().int().nullable()
}).strict();
const commandOutputContentV1Schema = z.object({ kind: z.literal("command_output"), output: boundedText }).strict();
const commandEvidenceFieldV1Schema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    text: boundedText,
    truncated: z.boolean()
  }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum(["capture_policy", "not_captured", "artifact_omitted"])
  }).strict()
]);
const commandEvidenceContentV1Schema = z.object({
  kind: z.literal("command_evidence"),
  command: commandEvidenceFieldV1Schema,
  output: commandEvidenceFieldV1Schema
}).strict();
const fileChangeContentV1Schema = z.object({
  kind: z.literal("file_change"),
  changes: z.array(z.object({
    path: z.string().min(1).max(4_096),
    kind: z.enum(["add", "modify", "delete", "rename", "unknown"])
  }).strict()).max(10_000)
}).strict();
const toolContentV1Schema = z.object({
  kind: z.literal("tool"),
  name: z.string().min(1).max(256),
  input: boundedText.optional(),
  result: boundedText.optional()
}).strict();
const planContentV1Schema = z.object({
  kind: z.literal("plan"),
  items: z.array(z.object({
    text: z.string().max(4_096),
    status: z.enum(["pending", "in_progress", "completed", "failed", "unknown"])
  }).strict()).max(1_000)
}).strict();
const gitContentV1Schema = z.object({
  kind: z.literal("git"),
  section: z.enum(["status", "tracked_final_diff", "diff_check", "untracked_metadata"]),
  text: boundedText
}).strict();
const recorderContentV1Schema = z.object({
  kind: z.literal("recorder"), diagnosticClass: safeTokenV1Schema, message: boundedText
}).strict();
const testContentV1Schema = z.object({
  kind: z.literal("test"),
  family: z.enum(["pytest", "jest", "vitest", "npm", "pnpm", "yarn", "cargo", "go", "maven", "gradle"]),
  outcome: z.enum(["passed", "failed", "unknown"])
}).strict();
const assessmentContentV1Schema = z.object({
  kind: z.literal("assessment"),
  verdict: assessmentVerdictV1Schema,
  taskCompleted: taskCompletionV1Schema,
  note: boundedText.optional()
}).strict();
const errorContentV1Schema = z.object({
  kind: z.literal("error"), errorClass: safeTokenV1Schema, message: boundedText
}).strict();

export const normalizedContentV1Schema = z.discriminatedUnion("kind", [
  messageContentV1Schema,
  reasoningContentV1Schema,
  commandContentV1Schema,
  commandOutputContentV1Schema,
  commandEvidenceContentV1Schema,
  fileChangeContentV1Schema,
  toolContentV1Schema,
  planContentV1Schema,
  gitContentV1Schema,
  recorderContentV1Schema,
  testContentV1Schema,
  assessmentContentV1Schema,
  errorContentV1Schema
]);

export const normalizedContentResponseV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventId: browserAddressableEventIdV1Schema,
  content: normalizedContentV1Schema
}).strict();

export const nativeContentResponseV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventId: browserAddressableEventIdV1Schema,
  content: z.object({
    format: z.enum(["json", "text"]),
    text: boundedText,
    truncated: z.boolean()
  }).strict()
}).strict();

const nonemptyTrajectoryWindowV1Schema = z.object({
  state: z.literal("nonempty"),
  minSequence: nonnegativeInteger,
  maxSequence: nonnegativeInteger,
  latestCommittedSequence: nonnegativeInteger,
  hasEarlier: z.boolean(),
  hasLater: z.boolean(),
  earlierCursor: z.string().min(1).max(4_096).nullable(),
  laterCursor: z.string().min(1).max(4_096).nullable()
}).strict().superRefine((window, context) => {
  if (window.minSequence > window.maxSequence || window.maxSequence > window.latestCommittedSequence) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Trajectory window bounds are invalid." });
  }
  if (window.hasEarlier !== (window.earlierCursor !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Earlier cursor availability is inconsistent." });
  }
  if (window.hasLater !== (window.laterCursor !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Later cursor availability is inconsistent." });
  }
});

const emptyTrajectoryWindowV1Schema = z.object({
  state: z.literal("empty"),
  latestCommittedSequence: nonnegativeInteger.nullable(),
  hasEarlier: z.boolean(),
  hasLater: z.literal(false),
  earlierCursor: z.string().min(1).max(4_096).nullable(),
  laterCursor: z.null()
}).strict().superRefine((window, context) => {
  if (window.hasEarlier !== (window.earlierCursor !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Earlier cursor availability is inconsistent." });
  }
  if (window.latestCommittedSequence === null && window.hasEarlier) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A zero-event window cannot have earlier events." });
  }
});

export const trajectoryWindowV1Schema = z.union([
  nonemptyTrajectoryWindowV1Schema,
  emptyTrajectoryWindowV1Schema
]);

export const trajectoryPageV1Schema = z.object({
  schemaVersion: z.literal(1),
  runId: browserAddressableRunIdV1Schema,
  mode: z.enum(["head", "tail", "after", "around", "cursor"]),
  items: z.array(trajectoryEventV1Schema).max(250),
  window: trajectoryWindowV1Schema
}).strict();

export type EventRelationshipTypeV1 = z.infer<typeof eventRelationshipTypeV1Schema>;
export type EventRelationshipV1 = z.infer<typeof eventRelationshipV1Schema>;
export type DerivationV1 = z.infer<typeof derivationV1Schema>;
export type TimestampAvailabilityV1 = z.infer<typeof timestampAvailabilityV1Schema>;
export type ContentAvailabilityV1 = z.infer<typeof contentAvailabilityV1Schema>;
export type NativePayloadAvailabilityV1 = z.infer<typeof nativePayloadAvailabilityV1Schema>;
export type TrajectoryEventV1 = z.infer<typeof trajectoryEventV1Schema>;
export type TrajectoryLifecycleV1 = z.infer<typeof trajectoryLifecycleV1Schema>;
export type EventDetailV1 = z.infer<typeof eventDetailV1Schema>;
export type NormalizedContentV1 = z.infer<typeof normalizedContentV1Schema>;
export type NormalizedContentResponseV1 = z.infer<typeof normalizedContentResponseV1Schema>;
export type NativeContentResponseV1 = z.infer<typeof nativeContentResponseV1Schema>;
export type TrajectoryWindowV1 = z.infer<typeof trajectoryWindowV1Schema>;
export type TrajectoryPageV1 = z.infer<typeof trajectoryPageV1Schema>;
