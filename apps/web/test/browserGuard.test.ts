import { describe, expect, it } from "vitest";

import { classifyFailedRequests } from "../e2e/browserGuard.js";

const origin = "http://127.0.0.1:4173";

describe("browser request cancellation classification", () => {
  it("allows one exact duplicate fetch abort after the matching success", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }], [{
      errorText: "net::ERR_ABORTED",
      method: "GET",
      resourceType: "fetch",
      sequence: 2,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }])).toEqual([]);
  });

  it("rejects an aborted fetch with a different query than the prior success", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }], [{
      errorText: "net::ERR_ABORTED",
      method: "GET",
      resourceType: "fetch",
      sequence: 2,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=11&limit=100`
    }])).toEqual([
      `failed request: GET ${origin}/api/v1/runs/fixture/events?afterSequence=11&limit=100 net::ERR_ABORTED`
    ]);
  });

  it("rejects a second duplicate abort after consuming the one exact exception", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }], [2, 3].map((sequence) => ({
      errorText: "net::ERR_ABORTED",
      method: "GET",
      resourceType: "fetch",
      sequence,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    })))).toEqual([
      `failed request: GET ${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100 net::ERR_ABORTED`
    ]);
  });
});
