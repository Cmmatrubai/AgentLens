import { describe, expect, it } from "vitest";

import { classifyFailedRequests } from "../e2e/browserGuard.js";

const origin = "http://127.0.0.1:4173";

describe("browser request cancellation classification", () => {
  it("rejects a distinct duplicate fetch abort after request completion", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      requestId: 1,
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }], [{
      errorText: "net::ERR_ABORTED",
      method: "GET",
      requestId: 2,
      resourceType: "fetch",
      sequence: 2,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }])).toEqual([
      `failed request: GET ${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100 net::ERR_ABORTED ` +
      `(request 2@2; prior distinct completions 1@1)`
    ]);
  });

  it("rejects the same request instance when headers precede its abort", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      requestId: 1,
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }], [{
      errorText: "net::ERR_ABORTED",
      method: "GET",
      requestId: 1,
      resourceType: "fetch",
      sequence: 2,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }])).toContain(
      `failed request: GET ${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100 net::ERR_ABORTED ` +
      `(request 1@2; prior distinct completions none)`
    );
  });

  it("rejects an arbitrary same-identity abort when no journey configured it", () => {
    expect(classifyFailedRequests([{
      method: "POST",
      requestId: 1,
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/assessment`
    }], [{
      errorText: "net::ERR_ABORTED",
      method: "POST",
      requestId: 2,
      resourceType: "fetch",
      sequence: 2,
      url: `${origin}/api/v1/runs/fixture/assessment`
    }])).toEqual([
      `failed request: POST ${origin}/api/v1/runs/fixture/assessment net::ERR_ABORTED ` +
      `(request 2@2; prior distinct completions 1@1)`
    ]);
  });

  it("includes the correlated poll generation when a failed request belongs to one", () => {
    expect(classifyFailedRequests([], [{
      errorText: "net::ERR_ABORTED",
      method: "GET",
      pollGeneration: 4,
      requestId: 9,
      resourceType: "fetch",
      sequence: 12,
      url: `${origin}/api/v1/runs/fixture`
    }])).toEqual([
      `failed request: GET ${origin}/api/v1/runs/fixture net::ERR_ABORTED ` +
      `(request 9@12 poll=4; prior distinct completions none)`
    ]);
  });

  it("reports a later exact completion without treating the earlier abort as allowed", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      requestId: 10,
      resourceType: "fetch",
      sequence: 3,
      url: `${origin}/api/v1/runs/fixture`
    }], [{
      errorText: "net::ERR_ABORTED",
      method: "GET",
      pollGeneration: 2,
      requestId: 9,
      resourceType: "fetch",
      sequence: 2,
      url: `${origin}/api/v1/runs/fixture`
    }])).toEqual([
      `failed request: GET ${origin}/api/v1/runs/fixture net::ERR_ABORTED ` +
      `(request 9@2 poll=2; prior distinct completions none; later distinct completions 10@3)`
    ]);
  });

  it("rejects an aborted fetch with a different query than the prior success", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      requestId: 1,
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }], [{
      errorText: "net::ERR_ABORTED",
      method: "GET",
      requestId: 2,
      resourceType: "fetch",
      sequence: 2,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=11&limit=100`
    }])).toEqual([
      `failed request: GET ${origin}/api/v1/runs/fixture/events?afterSequence=11&limit=100 net::ERR_ABORTED ` +
      `(request 2@2; prior distinct completions none)`
    ]);
  });

  it("rejects every duplicate abort without consuming an exception", () => {
    expect(classifyFailedRequests([{
      method: "GET",
      requestId: 1,
      resourceType: "fetch",
      sequence: 1,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    }], [2, 3].map((sequence) => ({
      errorText: "net::ERR_ABORTED",
      method: "GET",
      requestId: sequence,
      resourceType: "fetch",
      sequence,
      url: `${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100`
    })))).toEqual([
      `failed request: GET ${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100 net::ERR_ABORTED ` +
      `(request 2@2; prior distinct completions 1@1)`,
      `failed request: GET ${origin}/api/v1/runs/fixture/events?afterSequence=10&limit=100 net::ERR_ABORTED ` +
      `(request 3@3; prior distinct completions 1@1)`
    ]);
  });
});
