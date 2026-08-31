import { TextDecoder } from "node:util";

import {
  assessmentEventIdV1Schema,
  maximumAssessmentRevisionEtagCharacters
} from "@agentlens/api-contract";

export { maximumAssessmentRevisionEtagCharacters };

export const projectedAssessmentEtag = '"assessment:projected"';
const prefix = '"assessment:';
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function invalidEtag(): Error {
  return new Error("Assessment revision ETag is invalid.");
}

function requireEventId(value: string): string {
  const parsed = assessmentEventIdV1Schema.safeParse(value);
  if (!parsed.success) throw new Error("Assessment event ID is invalid.");
  return parsed.data;
}

export function encodeAssessmentRevisionEtag(eventId: string | null): string {
  if (eventId === null) return projectedAssessmentEtag;
  return `${prefix}${Buffer.from(requireEventId(eventId), "utf8").toString("base64url")}"`;
}

export function decodeAssessmentRevisionEtag(value: string): string | null {
  if (value === projectedAssessmentEtag) return null;
  if (value.length > maximumAssessmentRevisionEtagCharacters ||
      !/^"assessment:[A-Za-z0-9_-]+"$/.test(value)) {
    throw invalidEtag();
  }
  const encoded = value.slice(prefix.length, -1);
  let eventId: string;
  try {
    eventId = UTF8.decode(Buffer.from(encoded, "base64url"));
  } catch {
    throw invalidEtag();
  }
  if (Buffer.from(eventId, "utf8").toString("base64url") !== encoded ||
      !assessmentEventIdV1Schema.safeParse(eventId).success) {
    throw invalidEtag();
  }
  return eventId;
}
