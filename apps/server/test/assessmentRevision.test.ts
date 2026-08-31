import { describe, expect, it } from "vitest";

import {
  decodeAssessmentRevisionEtag,
  encodeAssessmentRevisionEtag,
  maximumAssessmentRevisionEtagCharacters,
  projectedAssessmentEtag
} from "../src/routes/assessmentRevision.js";

describe("assessment revision ETag codec", () => {
  it.each([
    "valid storage event id with spaces",
    "punctuation !@#$%^&*()[]{};,'?",
    "unicode snowman ☃ and emoji 😀",
    "\u0800".repeat(256)
  ])("round-trips the complete closed assessment ID domain: %s", (eventId) => {
    const etag = encodeAssessmentRevisionEtag(eventId);

    expect(etag.length).toBeLessThanOrEqual(maximumAssessmentRevisionEtagCharacters);
    expect(etag).toMatch(/^"assessment:[A-Za-z0-9_-]+"$/);
    expect(decodeAssessmentRevisionEtag(etag)).toBe(eventId);
  });

  it("round-trips the projected revision sentinel", () => {
    expect(encodeAssessmentRevisionEtag(null)).toBe(projectedAssessmentEtag);
    expect(decodeAssessmentRevisionEtag(projectedAssessmentEtag)).toBeNull();
  });

  it.each([
    "*",
    "W/\"assessment:projected\"",
    "assessment:projected",
    "\"assessment:\"",
    "\"assessment:YQ==\"",
    "\"assessment:YQ\", \"assessment:Yg\"",
    `"assessment:${Buffer.from("a".repeat(257), "utf8").toString("base64url")}"`,
    `"assessment:${Buffer.from([0xff]).toString("base64url")}"`
  ])("rejects an invalid or lossy revision value: %s", (etag) => {
    expect(() => decodeAssessmentRevisionEtag(etag)).toThrow(/assessment revision etag/i);
  });

  it("rejects an event ID that cannot round-trip through UTF-8", () => {
    expect(() => encodeAssessmentRevisionEtag("broken-\ud800-surrogate"))
      .toThrow(/assessment event id/i);
  });
});
