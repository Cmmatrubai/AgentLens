import type { IncomingMessage, ServerResponse } from "node:http";
import { TextDecoder } from "node:util";

import {
  assessmentConflictResponseV1Schema,
  assessmentResponseV1Schema,
  assessmentUpdateRequestV1Schema,
  maximumAssessmentRequestEnvelopeBytes
} from "@agentlens/api-contract";
import {
  AssessmentConflictError,
  projectCurrentAssessmentV1
} from "@agentlens/application";

import {
  RouteRequestError,
  endError,
  endJson,
  routeId,
  type RouteContext
} from "./routeContext.js";
import {
  decodeAssessmentRevisionEtag,
  encodeAssessmentRevisionEtag,
  projectedAssessmentEtag
} from "./assessmentRevision.js";

export const maximumAssessmentRequestBytes = maximumAssessmentRequestEnvelopeBytes;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export function explicitAssessmentEtag(eventId: string): string {
  return encodeAssessmentRevisionEtag(eventId);
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  let value: string | undefined;
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() !== name) continue;
    count += 1;
    value = request.rawHeaders[index + 1];
  }
  if (count > 1) throw new RouteRequestError();
  return value;
}

function parsePrecondition(request: IncomingMessage) {
  const value = singleHeader(request, "if-match");
  if (value === undefined) return undefined;
  try {
    return { state: "match", currentEventId: decodeAssessmentRevisionEtag(value) } as const;
  } catch {
    throw new RouteRequestError();
  }
}

function parseBody(request: IncomingMessage, body: Buffer | undefined) {
  if (singleHeader(request, "content-type") !== "application/json" || body === undefined) {
    throw new RouteRequestError();
  }
  let value: unknown;
  try {
    value = JSON.parse(UTF8.decode(body)) as unknown;
  } catch {
    throw new RouteRequestError();
  }
  const parsed = assessmentUpdateRequestV1Schema.safeParse(value);
  if (!parsed.success) throw new RouteRequestError();
  return parsed.data;
}

export async function handleAssessmentRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RouteContext,
  requestBody: Buffer | undefined
): Promise<boolean> {
  if (request.method !== "PUT") return false;
  const match = /^\/api\/v1\/runs\/([^/]+)\/assessment$/.exec(url.pathname);
  if (match === null) return false;
  if (url.search !== "") throw new RouteRequestError();
  const expectedRevision = parsePrecondition(request);
  if (expectedRevision === undefined) {
    endError(response, 428, "precondition_required", "Assessment revision is required.");
    return true;
  }
  const input = parseBody(request, requestBody);
  try {
    const assessment = await context.assessment.assess({
      runId: routeId(match[1]!),
      verdict: input.verdict,
      taskCompleted: input.taskCompleted,
      ...(input.note.state === "text" ? { note: input.note.text } : {}),
      expectedRevision
    });
    const etag = explicitAssessmentEtag(assessment.currentEventId);
    endJson(response, 200, assessmentResponseV1Schema.parse({
      schemaVersion: 1,
      assessment: projectCurrentAssessmentV1(assessment),
      etag
    }), { ETag: etag });
    return true;
  } catch (error) {
    if (!(error instanceof AssessmentConflictError)) throw error;
    const etag = error.current.currentEventId === null
      ? projectedAssessmentEtag
      : explicitAssessmentEtag(error.current.currentEventId);
    endJson(response, 412, assessmentConflictResponseV1Schema.parse({
      schemaVersion: 1,
      error: {
        code: "assessment_conflict",
        message: "Assessment changed; review the current assessment before retrying.",
        retryable: false
      },
      assessment: projectCurrentAssessmentV1(error.current),
      etag
    }), { ETag: etag });
    return true;
  }
}
