import {
  normalizedContentResponseV1Schema,
  type NormalizedContentResponseV1
} from "@agentlens/api-contract";
import type { CapturePolicy, TraceEventV1 } from "@agentlens/core";

import {
  projectCommandOutputContentV1,
  projectNormalizedContentV1
} from "../api/projectors.js";

export function projectEventContent(
  event: TraceEventV1,
  capturePolicy: CapturePolicy
): NormalizedContentResponseV1 | null {
  const content = projectCommandOutputContentV1(event, capturePolicy)
    ?? projectNormalizedContentV1(event, capturePolicy);
  return content === null ? null : normalizedContentResponseV1Schema.parse({
    schemaVersion: 1,
    eventId: event.id,
    content
  });
}
