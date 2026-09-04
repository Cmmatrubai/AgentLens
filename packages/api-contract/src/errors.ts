import { z } from "zod";

export const apiErrorCodeV1Schema = z.enum([
  "invalid_request",
  "authentication_required",
  "forbidden_origin",
  "run_not_found",
  "event_not_found",
  "invalid_cursor",
  "precondition_required",
  "assessment_conflict",
  "content_unavailable",
  "evidence_binding_mismatch",
  "active_snapshot_unavailable",
  "internal_error"
]);

export const apiErrorV1Schema = z.object({
  schemaVersion: z.literal(1),
  error: z.object({
    code: apiErrorCodeV1Schema,
    message: z.string().min(1).max(512),
    retryable: z.boolean()
  }).strict()
}).strict();

export type ApiErrorCodeV1 = z.infer<typeof apiErrorCodeV1Schema>;
export type ApiErrorV1 = z.infer<typeof apiErrorV1Schema>;
