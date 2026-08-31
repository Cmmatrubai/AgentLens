import type {
  EventDetailV1,
  RunDetailV1,
  RunPageV1,
  TrajectoryPageV1
} from "@agentlens/api-contract";
import { describe, expect, it, vi } from "vitest";

import {
  AgentLensClientError,
  createAgentLensApiClient
} from "../src/api/client.js";

const emptyRunPage: RunPageV1 = {
  schemaVersion: 1,
  items: [],
  nextCursor: null
};

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    ...init
  });
}

describe("AgentLens authenticated API client", () => {
  it("keeps bearer material closure-only while forwarding auth, JSON acceptance, and abort", async () => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn(async () => json(emptyRunPage));
    const client = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl
    });

    await expect(client.listRuns({ limit: 50 }, signal)).resolves.toEqual(emptyRunPage);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/v1/runs?limit=50",
      expect.objectContaining({
        redirect: "error",
        signal,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer fixture-bearer"
        }
      })
    );
    expect(JSON.stringify(client)).toBe("{}");
    expect(Object.values(client).every((value) => typeof value === "function")).toBe(true);
  });

  it("constructs deterministic closed query strings and encodes caller IDs exactly once", async () => {
    const responses: unknown[] = [
      emptyRunPage,
      { schemaVersion: 1, runId: "run/id %", eventCount: 0 } satisfies Partial<RunDetailV1>,
      { schemaVersion: 1, runId: "run/id %", mode: "head", items: [] } satisfies Partial<TrajectoryPageV1>,
      { schemaVersion: 1, runId: "run/id %", eventId: "event/id %" } satisfies Partial<EventDetailV1>
    ];
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input));
      return json(responses.shift());
    });
    const client = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123/",
      bearerToken: "fixture-bearer",
      fetchImpl
    });

    await client.listRuns({
      limit: 25,
      cursor: "cursor value",
      status: "failed",
      repository: "repo/value",
      assessment: "partial"
    }).catch(() => undefined);
    await client.getRun("run/id %").catch(() => undefined);
    await client.getEvents("run/id %", { limit: 100, aroundSequence: 7 }).catch(() => undefined);
    await client.getEvent("run/id %", "event/id %").catch(() => undefined);

    expect(requested).toEqual([
      "http://127.0.0.1:43123/api/v1/runs?limit=25&cursor=cursor+value&status=failed&repository=repo%2Fvalue&assessment=partial",
      "http://127.0.0.1:43123/api/v1/runs/run%2Fid%20%25",
      "http://127.0.0.1:43123/api/v1/runs/run%2Fid%20%25/events?limit=100&aroundSequence=7",
      "http://127.0.0.1:43123/api/v1/runs/run%2Fid%20%25/events/event%2Fid%20%25"
    ]);
  });

  it("rejects non-loopback, credential-bearing, and non-origin inputs", () => {
    for (const origin of [
      "https://127.0.0.1:43123",
      "http://localhost:43123",
      "http://0.0.0.0:43123",
      "http://user:pass@127.0.0.1:43123",
      "http://127.0.0.1:43123/private",
      "http://127.0.0.1:43123?token=value"
    ]) {
      expect(() => createAgentLensApiClient({
        origin,
        bearerToken: "fixture-bearer",
        fetchImpl: vi.fn()
      }), origin).toThrow(AgentLensClientError);
    }
  });

  it("rejects redirects, non-JSON, malformed JSON, oversized bodies, and invalid DTOs without reflecting raw bytes", async () => {
    const rawSentinel = "/private/RAW_RESPONSE_SENTINEL";
    const cases = [
      new Response(JSON.stringify(emptyRunPage), {
        status: 200,
        headers: { "Content-Type": "application/json", "Content-Length": "4194305" }
      }),
      new Response(rawSentinel, { status: 200, headers: { "Content-Type": "text/html" } }),
      new Response("{", { status: 200, headers: { "Content-Type": "application/json" } }),
      json({ ...emptyRunPage, raw: rawSentinel })
    ];

    for (const response of cases) {
      const client = createAgentLensApiClient({
        origin: "http://127.0.0.1:43123",
        bearerToken: "fixture-bearer",
        fetchImpl: vi.fn(async () => response)
      });
      const failure = await client.listRuns({ limit: 50 }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AgentLensClientError);
      expect((failure as Error).message).not.toContain(rawSentinel);
      expect(JSON.stringify(failure)).not.toContain(rawSentinel);
    }

    const redirectedResponse = json(emptyRunPage);
    Object.defineProperty(redirectedResponse, "redirected", { value: true });
    const redirectedClient = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl: vi.fn(async () => redirectedResponse)
    });
    await expect(redirectedClient.listRuns({ limit: 50 }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("keeps API and abort failures typed, bounded, and non-reflective", async () => {
    const apiClient = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl: vi.fn(async () => json({
        schemaVersion: 1,
        error: {
          code: "authentication_required",
          message: "/private/SERVER_MESSAGE_SENTINEL",
          retryable: false
        }
      }, { status: 401 }))
    });
    await expect(apiClient.listRuns({ limit: 50 })).rejects.toMatchObject({
      code: "authentication_required",
      status: 401,
      retryable: false,
      message: "AgentLens authentication is no longer available."
    });

    const aborted = new DOMException("RAW_ABORT_SENTINEL", "AbortError");
    const abortClient = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl: vi.fn(async () => { throw aborted; })
    });
    await expect(abortClient.listRuns({ limit: 50 })).rejects.toMatchObject({
      code: "request_aborted",
      retryable: false,
      message: "The AgentLens request was cancelled."
    });
  });
});
