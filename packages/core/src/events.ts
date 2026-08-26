import { z } from "zod";

export const provenanceSchema = z.enum([
  "observed",
  "derived",
  "git_recovered",
  "recorder",
  "human"
]);

export const eventStatusSchema = z.enum([
  "in_progress",
  "completed",
  "failed",
  "declined",
  "interrupted",
  "unknown"
]);

export const runStatusSchema = z.enum([
  "starting",
  "running",
  "completed",
  "failed",
  "interrupted",
  "recorder_error"
]);

export const eventRelationshipTypeSchema = z.enum([
  "derived_from",
  "recovers",
  "correlates_with"
]);

export const eventRelationshipV1Schema = z.object({
  type: eventRelationshipTypeSchema,
  eventId: z.string().min(1)
});

export const nativeSourceV1Schema = z.object({
  provider: z.enum(["codex-exec", "claude-code"]),
  sessionId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  itemType: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional()
});

export const nativePayloadRefV1Schema = z.discriminatedUnion("storage", [
  z.object({ storage: z.literal("inline"), redacted: z.unknown() }),
  z.object({ storage: z.literal("artifact"), artifactId: z.string().min(1) }),
  z.object({ storage: z.literal("omitted"), reason: z.string().min(1) })
]);

const derivationSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  sourceEventIds: z.array(z.string().min(1)).min(1),
  confidence: z.enum(["high", "medium", "low"]).optional()
});

const canonicalEventFields = {
  kind: z.string().min(1),
  status: eventStatusSchema,
  provenance: provenanceSchema,
  source: nativeSourceV1Schema,
  relationships: z.array(eventRelationshipV1Schema),
  summary: z.string(),
  normalizedPayload: z.unknown().optional(),
  derivation: derivationSchema.optional()
};

function requireDerivedSources(
  value: {
    provenance: z.infer<typeof provenanceSchema>;
    relationships: z.infer<typeof eventRelationshipV1Schema>[];
    derivation?: z.infer<typeof derivationSchema> | undefined;
  },
  context: z.RefinementCtx
): void {
  if (value.provenance !== "derived") return;

  if (!value.derivation || value.derivation.sourceEventIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["derivation", "sourceEventIds"],
      message: "Derived events require source AgentLens event IDs."
    });
  }

  if (!value.relationships.some((relationship) => relationship.type === "derived_from")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["relationships"],
      message: "Derived events require a derived_from relationship."
    });
  }

  if (!value.derivation) return;

  const sourceEventIds = value.derivation.sourceEventIds;
  const derivedFromEventIds = value.relationships
    .filter((relationship) => relationship.type === "derived_from")
    .map((relationship) => relationship.eventId);
  const sourceEventIdSet = new Set(sourceEventIds);
  const derivedFromEventIdSet = new Set(derivedFromEventIds);

  if (sourceEventIdSet.size !== sourceEventIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["derivation", "sourceEventIds"],
      message: "Derived event source IDs must be unique."
    });
  }

  if (derivedFromEventIdSet.size !== derivedFromEventIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["relationships"],
      message: "Derived event source relationships must be unique."
    });
  }

  if (
    sourceEventIdSet.size !== derivedFromEventIdSet.size ||
    [...sourceEventIdSet].some((eventId) => !derivedFromEventIdSet.has(eventId))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["relationships"],
      message: "Derived event source relationships must match derivation source IDs."
    });
  }
}

export const traceEventV1Schema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    receivedAt: z.string().datetime(),
    sourceOccurredAt: z.string().datetime().optional(),
    ...canonicalEventFields,
    nativePayload: nativePayloadRefV1Schema.optional()
  })
  .superRefine(requireDerivedSources);

/**
 * A transient adapter result. `nativePayload` is intentionally unknown here:
 * adapters retain the complete provider object in memory, then Task 5 redacts
 * it into the explicit NativePayloadRefV1 durable representation.
 */
export const eventDraftV1Schema = z
  .object({
    ...canonicalEventFields,
    nativePayload: z.unknown().optional()
  })
  .superRefine(requireDerivedSources);

export type Provenance = z.infer<typeof provenanceSchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type EventRelationshipType = z.infer<typeof eventRelationshipTypeSchema>;
export type EventRelationshipV1 = z.infer<typeof eventRelationshipV1Schema>;
export type NativeSourceV1 = z.infer<typeof nativeSourceV1Schema>;
export type NativePayloadRefV1 = z.infer<typeof nativePayloadRefV1Schema>;
export type TraceEventV1 = z.infer<typeof traceEventV1Schema>;
export type EventDraftV1 = z.infer<typeof eventDraftV1Schema>;
