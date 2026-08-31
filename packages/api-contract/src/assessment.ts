import { z } from "zod";

export const maximumAssessmentEventIdCharacters = 256;
// A canonical 256-code-unit ID needs at most 768 UTF-8 bytes and 1,024
// unpadded base64url characters, plus the fixed quotes and assessment prefix.
export const maximumAssessmentRevisionEtagCharacters =
  13 + 4 * maximumAssessmentEventIdCharacters;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function isCanonicalUtf8(value: string): boolean {
  try {
    return UTF8_DECODER.decode(UTF8_ENCODER.encode(value)) === value;
  } catch {
    return false;
  }
}

export const assessmentEventIdV1Schema = z.string()
  .min(1)
  .max(maximumAssessmentEventIdCharacters)
  .refine(isCanonicalUtf8, "Assessment event ID must round-trip through UTF-8.");

export const assessmentVerdictV1Schema = z.enum([
  "unreviewed",
  "success",
  "partial",
  "failure"
]);

export const taskCompletionV1Schema = z.enum(["yes", "no", "uncertain"]);

export const assessmentNoteAvailabilityV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("absent") }).strict(),
  z.object({ state: z.literal("available") }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum(["capture_policy", "artifact_unreadable"])
  }).strict()
]);

const projectedAssessmentV1Schema = z.object({
  schemaVersion: z.literal(1),
  state: z.literal("projected"),
  verdict: z.literal("unreviewed"),
  taskCompleted: z.literal("uncertain"),
  note: z.object({ state: z.literal("absent") }).strict(),
  provenance: z.null(),
  currentEventId: z.null(),
  reviewedAt: z.null(),
  updatedAt: z.null()
}).strict();

const explicitAssessmentV1Schema = z.object({
  schemaVersion: z.literal(1),
  state: z.literal("explicit"),
  verdict: assessmentVerdictV1Schema,
  taskCompleted: taskCompletionV1Schema,
  note: assessmentNoteAvailabilityV1Schema,
  provenance: z.literal("human"),
  currentEventId: assessmentEventIdV1Schema,
  reviewedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
}).strict();

export const currentAssessmentV1Schema = z.discriminatedUnion("state", [
  projectedAssessmentV1Schema,
  explicitAssessmentV1Schema
]);

export const assessmentUpdateRequestV1Schema = z.object({
  schemaVersion: z.literal(1),
  verdict: assessmentVerdictV1Schema,
  taskCompleted: taskCompletionV1Schema,
  note: z.discriminatedUnion("state", [
    z.object({ state: z.literal("absent") }).strict(),
    z.object({ state: z.literal("text"), text: z.string().max(16_384) }).strict()
  ])
}).strict().superRefine((value, context) => {
  if (value.verdict === "unreviewed" && value.taskCompleted !== "uncertain") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["taskCompleted"],
      message: "Explicit unreviewed requires uncertain task completion."
    });
  }
  if (value.note.state === "text" &&
      new TextEncoder().encode(value.note.text).byteLength > 16 * 1024) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note", "text"],
      message: "Assessment note exceeds the UTF-8 byte limit."
    });
  }
});

export const assessmentResponseV1Schema = z.object({
  schemaVersion: z.literal(1),
  assessment: currentAssessmentV1Schema,
  etag: z.string().min(1).max(maximumAssessmentRevisionEtagCharacters)
}).strict();

export const assessmentConflictResponseV1Schema = z.object({
  schemaVersion: z.literal(1),
  error: z.object({
    code: z.literal("assessment_conflict"),
    message: z.string().max(256),
    retryable: z.literal(false)
  }).strict(),
  assessment: currentAssessmentV1Schema,
  etag: z.string().min(1).max(maximumAssessmentRevisionEtagCharacters)
}).strict();

export const assessmentNoteContentV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventId: assessmentEventIdV1Schema,
  content: z.string().max(16_384)
}).strict();

export type AssessmentVerdictV1 = z.infer<typeof assessmentVerdictV1Schema>;
export type TaskCompletionV1 = z.infer<typeof taskCompletionV1Schema>;
export type AssessmentNoteAvailabilityV1 = z.infer<typeof assessmentNoteAvailabilityV1Schema>;
export type CurrentAssessmentV1 = z.infer<typeof currentAssessmentV1Schema>;
export type AssessmentUpdateRequestV1 = z.infer<typeof assessmentUpdateRequestV1Schema>;
export type AssessmentResponseV1 = z.infer<typeof assessmentResponseV1Schema>;
export type AssessmentConflictResponseV1 = z.infer<typeof assessmentConflictResponseV1Schema>;
export type AssessmentNoteContentV1 = z.infer<typeof assessmentNoteContentV1Schema>;
