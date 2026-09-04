import { describe, expect, it } from "vitest";

import {
  installE2ERequestCorrelation,
  requestCorrelationHeader,
  RequestLifecycleLedger,
  type BrowserRequestLike
} from "../e2e/requestLifecycle.js";

const origin = "http://127.0.0.1:4173";

function request(
  path: string,
  method = "GET",
  resourceType = "fetch",
  errorText: string | null = null,
  correlation: string | null = null,
  requestInstance: string | null = null
): BrowserRequestLike {
  const candidate = {
    failure: () => errorText === null ? null : { errorText },
    headers: () => ({
      ...(correlation === null ? {} : { "x-agentlens-e2e-request-correlation": correlation }),
      ...(requestInstance === null ? {} : { "x-agentlens-e2e-request-instance": requestInstance })
    }),
    method: () => method,
    resourceType: () => resourceType,
    url: () => `${origin}${path}`
  };
  return candidate;
}

describe("shared browser request lifecycle ledger", () => {
  it("assigns the same test-only correlation to fetches sharing one exact AbortSignal", async () => {
    const observed: Array<{ headers: Headers; url: string }> = [];
    const settled: unknown[] = [];
    const target = {
      Headers,
      Request,
      ReadableStream,
      ReadableStreamDefaultReader,
      Response,
      crypto: {
        randomUUID: () => "00000000-0000-4000-8000-000000000001" as `${string}-${string}-${string}-${string}-${string}`
      },
      __agentLensE2EReportRequestLifecycle: async (observation: unknown) => { settled.push(observation); },
      fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        observed.push({
          headers: new Headers(init?.headers),
          url: input.toString()
        });
        return new Response(null, { status: 204 });
      }) as typeof fetch
    };
    installE2ERequestCorrelation(target);
    const shared = new AbortController();
    const independent = new AbortController();

    await target.fetch(`${origin}/api/v1/runs/fixture`, { signal: shared.signal });
    await target.fetch(`${origin}/api/v1/runs/fixture/events?limit=100`, { signal: shared.signal });
    await target.fetch(`${origin}/api/v1/runs/fixture`, { signal: independent.signal });
    await target.fetch(`${origin}/api/v1/runs?limit=50`);

    expect(observed.map(({ url }) => url)).toEqual([
      `${origin}/api/v1/runs/fixture`,
      `${origin}/api/v1/runs/fixture/events?limit=100`,
      `${origin}/api/v1/runs/fixture`,
      `${origin}/api/v1/runs?limit=50`
    ]);
    expect(observed.map(({ headers }) => headers.get(requestCorrelationHeader))).toEqual([
      "00000000-0000-4000-8000-000000000001:1",
      "00000000-0000-4000-8000-000000000001:1",
      "00000000-0000-4000-8000-000000000001:2",
      null
    ]);
    expect(observed.map(({ headers }) => headers.get("x-agentlens-e2e-request-instance"))).toEqual([
      "00000000-0000-4000-8000-000000000001:request:1",
      "00000000-0000-4000-8000-000000000001:request:2",
      "00000000-0000-4000-8000-000000000001:request:3",
      "00000000-0000-4000-8000-000000000001:request:4"
    ]);
    expect(settled).toEqual([
      expect.objectContaining({ requestInstance: "00000000-0000-4000-8000-000000000001:request:1", state: "finished" }),
      expect.objectContaining({ requestInstance: "00000000-0000-4000-8000-000000000001:request:2", state: "finished" }),
      expect.objectContaining({ requestInstance: "00000000-0000-4000-8000-000000000001:request:3", state: "finished" }),
      expect.objectContaining({ requestInstance: "00000000-0000-4000-8000-000000000001:request:4", state: "finished" })
    ]);
  });

  it("uses exact page-consumption evidence without hiding a genuine browser fetch failure", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const transportFalseFailure = request(
      "/api/v1/runs/fixture-running",
      "GET",
      "fetch",
      "net::ERR_ABORTED",
      "poll-1",
      "request-1"
    );
    ledger.started(transportFalseFailure);
    ledger.failed(transportFalseFailure);
    expect(ledger.snapshot()[0]).toMatchObject({
      terminal: { state: "active" },
      transportTerminal: { state: "failed", errorText: "net::ERR_ABORTED" }
    });

    ledger.pageSettled({
      requestInstance: "request-1",
      method: "GET",
      url: `${origin}/api/v1/runs/fixture-running`,
      state: "finished"
    });
    expect(ledger.snapshot()[0]).toMatchObject({
      terminal: { state: "finished" },
      transportTerminal: { state: "failed", errorText: "net::ERR_ABORTED" }
    });

    const genuineFailure = request(
      "/api/v1/runs/fixture-running/events?limit=100",
      "GET",
      "fetch",
      "net::ERR_ABORTED",
      "poll-1",
      "request-2"
    );
    ledger.started(genuineFailure);
    ledger.failed(genuineFailure);
    ledger.pageSettled({
      requestInstance: "request-2",
      method: "GET",
      url: `${origin}/api/v1/runs/fixture-running/events?limit=100`,
      state: "failed",
      errorText: "signal_aborted"
    });
    expect(ledger.snapshot()[1]).toMatchObject({
      terminal: { state: "failed", errorText: "signal_aborted" },
      transportTerminal: { state: "failed", errorText: "net::ERR_ABORTED" }
    });
  });

  it("reports an exact aborted fetch as failed rather than reconciling it as success", async () => {
    const settled: unknown[] = [];
    const target = {
      Headers,
      Request,
      ReadableStream,
      ReadableStreamDefaultReader,
      Response,
      crypto: {
        randomUUID: () => "00000000-0000-4000-8000-000000000002" as `${string}-${string}-${string}-${string}-${string}`
      },
      __agentLensE2EReportRequestLifecycle: async (observation: unknown) => { settled.push(observation); },
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return new Response(null, { status: 204 });
      }) as typeof fetch
    };
    installE2ERequestCorrelation(target);
    const controller = new AbortController();
    controller.abort();

    await expect(target.fetch(`${origin}/api/v1/runs/fixture`, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(settled).toEqual([{
      requestInstance: "00000000-0000-4000-8000-000000000002:request:1",
      method: "GET",
      url: `${origin}/api/v1/runs/fixture`,
      state: "failed",
      errorText: "signal_aborted"
    }]);
  });

  it("reports completion only after Response.json consumes the exact response body", async () => {
    const settled: unknown[] = [];
    class BrowserLikeResponse {
      readonly body = new ReadableStream();

      async json(): Promise<unknown> {
        return { unavailable: true };
      }
    }
    const target = {
      Headers,
      Request,
      ReadableStream,
      ReadableStreamDefaultReader,
      Response: BrowserLikeResponse as unknown as typeof Response,
      crypto: {
        randomUUID: () => "00000000-0000-4000-8000-000000000003" as `${string}-${string}-${string}-${string}-${string}`
      },
      __agentLensE2EReportRequestLifecycle: async (observation: unknown) => { settled.push(observation); },
      fetch: (async (): Promise<Response> => new BrowserLikeResponse() as unknown as Response) as typeof fetch
    };
    installE2ERequestCorrelation(target);

    const response = await target.fetch(`${origin}/api/v1/runs/fixture/events/message/content`);
    expect(settled).toEqual([]);
    await expect(response.json()).resolves.toEqual({ unavailable: true });
    expect(settled).toEqual([{
      requestInstance: "00000000-0000-4000-8000-000000000003:request:1",
      method: "GET",
      url: `${origin}/api/v1/runs/fixture/events/message/content`,
      state: "finished"
    }]);
  });

  it("uses checkpoints and exact request identity instead of accepting an older duplicate completion", async () => {
    const ledger = new RequestLifecycleLedger(origin);
    const first = request("/api/v1/runs?limit=50");
    expect(ledger.started(first).id).toBe(1);
    ledger.finished(first);
    const checkpoint = ledger.checkpoint();
    let resolved = false;
    const nextCompletion = ledger.waitForTerminal(checkpoint, {
      method: "GET",
      pathname: "/api/v1/runs",
      search: "?limit=50"
    }).then((record) => {
      resolved = true;
      return record;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    const second = request("/api/v1/runs?limit=50");
    expect(ledger.started(second).id).toBe(2);
    ledger.finished(second);

    await expect(nextCompletion).resolves.toMatchObject({
      id: 2,
      pollGeneration: null,
      terminal: { state: "finished" }
    });
  });

  it("tracks finished, failed, and active states independently for duplicate URLs", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const finished = request("/api/v1/runs/fixture");
    const failed = request("/api/v1/runs/fixture", "GET", "fetch", "net::ERR_ABORTED");
    const active = request("/api/v1/runs/fixture");

    ledger.started(finished);
    ledger.finished(finished);
    ledger.started(failed);
    ledger.failed(failed);
    ledger.started(active);

    expect(ledger.snapshot().map(({ id, terminal }) => ({ id, terminal }))).toEqual([
      { id: 1, terminal: { state: "finished" } },
      { id: 2, terminal: { state: "failed", errorText: "net::ERR_ABORTED" } },
      { id: 3, terminal: { state: "active" } }
    ]);
    expect(ledger.active().map(({ id }) => id)).toEqual([3]);
  });

  it("correlates concurrent duplicate poll requests by explicit identity instead of LIFO order", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const runA1 = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A1");
    const runA2 = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A2");
    const eventsA1 = request("/api/v1/runs/fixture-running/events?limit=100", "GET", "fetch", null, "A1");
    const eventsA2 = request("/api/v1/runs/fixture-running/events?limit=100", "GET", "fetch", null, "A2");

    for (const candidate of [runA1, runA2, eventsA1, eventsA2]) ledger.started(candidate);

    expect(ledger.snapshot().map(({ id, pollGeneration }) => ({ id, pollGeneration }))).toEqual([
      { id: 1, pollGeneration: 1 },
      { id: 2, pollGeneration: 2 },
      { id: 3, pollGeneration: 1 },
      { id: 4, pollGeneration: 2 }
    ]);
  });

  it("correlates events-before-run ordering by explicit identity", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const events = request("/api/v1/runs/fixture-running/events?limit=100", "GET", "fetch", null, "A1");
    const run = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A1");

    ledger.started(events);
    ledger.started(run);

    expect(ledger.snapshot().map(({ id, pollGeneration }) => ({ id, pollGeneration }))).toEqual([
      { id: 1, pollGeneration: 1 },
      { id: 2, pollGeneration: 1 }
    ]);
  });

  it("keeps independent initial loads unclassified and numbers the first active poll as generation one", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const initialRun = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "initial-run");
    const initialEvents = request(
      "/api/v1/runs/fixture-running/events?limit=100",
      "GET",
      "fetch",
      null,
      "initial-events"
    );
    const activeRun = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "active-1");
    const activeEvents = request(
      "/api/v1/runs/fixture-running/events?limit=100",
      "GET",
      "fetch",
      null,
      "active-1"
    );

    for (const candidate of [initialRun, initialEvents, activeRun, activeEvents]) ledger.started(candidate);

    expect(ledger.snapshot().map(({ id, pollGeneration }) => ({ id, pollGeneration }))).toEqual([
      { id: 1, pollGeneration: null },
      { id: 2, pollGeneration: null },
      { id: 3, pollGeneration: 1 },
      { id: 4, pollGeneration: 1 }
    ]);
  });

  it("keeps inverted concurrent active generations independent", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const runA1 = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A1");
    const eventsA2 = request("/api/v1/runs/fixture-running/events?limit=100", "GET", "fetch", null, "A2");
    const eventsA1 = request("/api/v1/runs/fixture-running/events?limit=100", "GET", "fetch", null, "A1");
    const runA2 = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A2");

    for (const candidate of [runA1, eventsA2, eventsA1, runA2]) ledger.started(candidate);

    expect(ledger.snapshot().map(({ id, pollGeneration }) => ({ id, pollGeneration }))).toEqual([
      { id: 1, pollGeneration: 1 },
      { id: 2, pollGeneration: 2 },
      { id: 3, pollGeneration: 1 },
      { id: 4, pollGeneration: 2 }
    ]);
  });

  it("retains one failed and one finished member in the same explicit poll generation", async () => {
    const ledger = new RequestLifecycleLedger(origin);
    const checkpoint = ledger.checkpoint();
    const generation = ledger.waitForPollGeneration(checkpoint, {
      runId: "fixture-running",
      eventSearch: "?limit=100&afterSequence=9"
    });
    const run = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A1");
    const events = request(
      "/api/v1/runs/fixture-running/events?limit=100&afterSequence=9",
      "GET",
      "fetch",
      "net::ERR_ABORTED",
      "A1"
    );

    ledger.started(run);
    ledger.started(events);
    ledger.finished(run);
    ledger.failed(events);

    await expect(generation).resolves.toMatchObject({
      generation: 1,
      run: { id: 1, terminal: { state: "finished" } },
      events: { id: 2, terminal: { state: "failed", errorText: "net::ERR_ABORTED" } }
    });
  });

  it("rejects correlation reuse without assigning one request to a second generation", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const run = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A1");
    const events = request("/api/v1/runs/fixture-running/events?limit=100", "GET", "fetch", null, "A1");
    const duplicateRun = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "A1");

    ledger.started(run);
    ledger.started(events);
    ledger.started(duplicateRun);

    expect(ledger.snapshot().map(({ id, pollGeneration }) => ({ id, pollGeneration }))).toEqual([
      { id: 1, pollGeneration: 1 },
      { id: 2, pollGeneration: 1 },
      { id: 3, pollGeneration: null }
    ]);
    expect(ledger.violations()).toEqual([
      "correlation A1 assigned more than one run request for run fixture-running"
    ]);
  });

  it("reports active request IDs and poll generations for teardown diagnosis", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const run = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "active-1");
    const events = request(
      "/api/v1/runs/fixture-running/events?limit=100&afterSequence=11",
      "GET",
      "fetch",
      null,
      "active-1"
    );
    ledger.started(run);
    ledger.started(events);

    expect(ledger.describeActive()).toEqual([
      `#1 poll=1 correlation=active-1 fetch GET ${origin}/api/v1/runs/fixture-running`,
      `#2 poll=1 correlation=active-1 fetch GET ${origin}/api/v1/runs/fixture-running/events?limit=100&afterSequence=11`
    ]);
  });

  it("describes every exact request instance in lifecycle order for failure diagnosis", () => {
    const ledger = new RequestLifecycleLedger(origin);
    const run = request("/api/v1/runs/fixture-running", "GET", "fetch", null, "active-1");
    const events = request(
      "/api/v1/runs/fixture-running/events?limit=100",
      "GET",
      "fetch",
      "net::ERR_ABORTED",
      "active-1"
    );
    ledger.started(run);
    ledger.started(events);
    ledger.finished(run);
    ledger.failed(events);

    expect(ledger.describe()).toEqual([
      `#1 poll=1 correlation=active-1 terminal=finished@0 transport=finished@0 fetch GET ${origin}/api/v1/runs/fixture-running`,
      `#2 poll=1 correlation=active-1 terminal=failed@1(net::ERR_ABORTED) transport=failed@1(net::ERR_ABORTED) fetch GET ${origin}/api/v1/runs/fixture-running/events?limit=100`
    ]);
  });
});
