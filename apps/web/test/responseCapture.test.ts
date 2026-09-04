import { describe, expect, it } from "vitest";

import {
  captureResponse,
  drainResponseCaptures,
  type ResponseCaptureSource
} from "../e2e/responseCapture.js";

describe("privacy response capture", () => {
  it("fails the drain when a registered response body cannot be read", async () => {
    const response: ResponseCaptureSource = {
      body: async () => { throw new Error("synthetic body read rejection"); },
      headersArray: async () => [{ name: "content-type", value: "application/json" }],
      request: () => ({ method: () => "GET" }),
      status: () => 200,
      url: () => "http://127.0.0.1:4173/api/v1/runs"
    };

    await expect(drainResponseCaptures([captureResponse(response)]))
      .rejects.toThrow("Unable to read raw response body for GET /api/v1/runs");
  });

  it("redacts a consumed bootstrap path from body-read failure evidence", async () => {
    const syntheticBootstrapSegment = "synthetic-bootstrap-segment";
    const response: ResponseCaptureSource = {
      body: async () => { throw new Error("synthetic body read rejection"); },
      headersArray: async () => [],
      request: () => ({ method: () => "GET" }),
      status: () => 200,
      url: () => `http://127.0.0.1:4173/bootstrap/${syntheticBootstrapSegment}`
    };

    let failure: unknown;
    try {
      await drainResponseCaptures([captureResponse(response)]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      message: "Unable to read raw response body for GET /bootstrap/[consumed]: synthetic body read rejection"
    });
    expect(String(failure)).not.toContain(syntheticBootstrapSegment);
  });
});
