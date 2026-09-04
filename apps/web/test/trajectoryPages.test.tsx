import type { EventDetailV1, TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentLensClientError, type AgentLensApiClient } from "../src/api/client.js";
import { ApiClientProvider } from "../src/api/queries.js";
import { useTrajectoryPages } from "../src/trajectory/useTrajectoryPages.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function event(runId: string, eventId: string, sequence: number): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId,
    runId,
    sequence,
    receivedAt: new Date(Date.UTC(2026, 7, 31, 12, 0, sequence)).toISOString(),
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "message",
    status: { state: "known", value: "completed" },
    provenance: "observed",
    presentationClass: "message",
    safeSummary: eventId,
    source: {
      opaqueRef: `src_${"a".repeat(64)}`,
      provider: { state: "known", value: "codex-exec" },
      hasSessionOrThread: true,
      hasTurn: true,
      hasItemOrTool: true,
      hasCorrelation: false
    },
    relationships: [],
    derivation: null,
    nativePayload: { state: "unavailable", reason: "not_captured" },
    lifecycleGroupKey: null,
    lifecycle: null,
    detail: { state: "available" }
  };
}

function page(
  runId: string,
  items: readonly TrajectoryEventV1[],
  options: Readonly<{ hasEarlier?: boolean; hasLater?: boolean; latest?: number }> = {}
): TrajectoryPageV1 {
  const hasEarlier = options.hasEarlier ?? false;
  const hasLater = options.hasLater ?? false;
  return {
    schemaVersion: 1,
    runId,
    mode: "head",
    items: [...items],
    window: items.length === 0 ? {
      state: "empty",
      latestCommittedSequence: null,
      hasEarlier: false,
      hasLater: false,
      earlierCursor: null,
      laterCursor: null
    } : {
      state: "nonempty",
      minSequence: items[0]!.sequence,
      maxSequence: items.at(-1)!.sequence,
      latestCommittedSequence: options.latest ?? items.at(-1)!.sequence,
      hasEarlier,
      hasLater,
      earlierCursor: hasEarlier ? `earlier-${runId}` : null,
      laterCursor: hasLater ? `later-${runId}` : null
    }
  };
}

function detail(item: TrajectoryEventV1): EventDetailV1 {
  return {
    schemaVersion: 1,
    eventId: item.eventId,
    runId: item.runId,
    sequence: item.sequence,
    kind: item.kind,
    status: item.status,
    provenance: item.provenance,
    relationships: [],
    presentationClass: "message",
    role: "agent",
    content: { state: "unavailable", reason: "not_captured" }
  };
}

function wrapper(client: AgentLensApiClient) {
  return ({ children }: Readonly<{ children: ReactNode }>) => (
    <ApiClientProvider client={client}>{children}</ApiClientProvider>
  );
}

function completedRun(totalEventCount: number) {
  return { terminal: true, totalEventCount } as const;
}

function activeRun(totalEventCount: number) {
  return { terminal: false, totalEventCount } as const;
}

function eventRange(
  runId: string,
  firstSequence: number,
  lastSequence: number,
  finalEventId?: string
): readonly TrajectoryEventV1[] {
  return Array.from({ length: lastSequence - firstSequence + 1 }, (_, index) => {
    const sequence = firstSequence + index;
    return event(runId, finalEventId !== undefined && sequence === lastSequence
      ? finalEventId
      : "event-" + sequence, sequence);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("trajectory request ownership", () => {
  it("retries an initial typed active-snapshot refusal without discarding loading state", async () => {
    vi.useFakeTimers();
    const retryable = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "safe fixture message"
    });
    const getEvents = vi.fn()
      .mockRejectedValueOnce(retryable)
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce(page("run-a", [event("run-a", "event-a", 1)]));
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.state).toBe("loading");
    expect(view.result.current.retrying).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.state).toBe("loading");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["event-a"]);
    expect(view.result.current.retrying).toBe(false);
  });

  it("aborts an initial active-snapshot retry when navigation changes the run", async () => {
    vi.useFakeTimers();
    const retryable = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "safe fixture message"
    });
    const getEvents = vi.fn((runId: string) => runId === "run-a"
      ? Promise.reject(retryable)
      : Promise.resolve(page("run-b", [event("run-b", "event-b", 1)])));
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(({ runId }) => useTrajectoryPages(runId, null, null), {
      initialProps: { runId: "run-a" }, wrapper: wrapper(client)
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const abandonedSignal = getEvents.mock.calls[0]?.[2];
    view.rerender({ runId: "run-b" });
    expect(abandonedSignal?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["event-b"]);
    expect(getEvents.mock.calls.filter(([runId]) => runId === "run-a")).toHaveLength(1);
  });

  it("does not retry a non-retryable initial trajectory error", async () => {
    vi.useFakeTimers();
    const failure = new AgentLensClientError({
      code: "invalid_cursor",
      status: 400,
      retryable: false,
      message: "safe fixture message"
    });
    const getEvents = vi.fn().mockRejectedValue(failure);
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.state).toBe("error");
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(getEvents).toHaveBeenCalledTimes(1);
  });

  it("keeps the loaded trajectory while a cursor page retries a typed active-snapshot refusal", async () => {
    vi.useFakeTimers();
    const retryable = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "safe fixture message"
    });
    let cursorAttempts = 0;
    const getEvents = vi.fn((_runId: string, query: { cursor?: string }) => {
      if (query.cursor === "later-run-a") {
        cursorAttempts += 1;
        return cursorAttempts === 1
          ? Promise.reject(retryable)
          : Promise.resolve({
              ...page("run-a", [event("run-a", "event-later", 10)], { hasEarlier: true, latest: 10 }),
              mode: "cursor" as const
            });
      }
      return Promise.resolve(page("run-a", [event("run-a", "event-head", 1)], { hasLater: true, latest: 10 }));
    });
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.hasLater).toBe(true);

    await act(async () => { void view.result.current.loadLater?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["event-head"]);
    expect(view.result.current.pagingState).toBe("loading");
    expect(view.result.current.retrying).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["event-head", "event-later"]);
    expect(view.result.current.pagingState).toBe("idle");
    expect(view.result.current.retrying).toBe(false);
    expect(cursorAttempts).toBe(2);
  });

  it("retries a selected-event lookup only for the typed active-snapshot refusal", async () => {
    vi.useFakeTimers();
    const retryable = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "safe fixture message"
    });
    const selected = event("run-a", "event-selected", 40);
    let detailAttempts = 0;
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(),
      getEvent: vi.fn(() => {
        detailAttempts += 1;
        return detailAttempts === 1 ? Promise.reject(retryable) : Promise.resolve(detail(selected));
      }),
      getEvents: vi.fn((_runId: string, query: { aroundSequence?: number }) => Promise.resolve(
        query.aroundSequence === selected.sequence
          ? { ...page("run-a", [selected], { hasEarlier: true, latest: 100 }), mode: "around" as const }
          : page("run-a", [event("run-a", "event-head", 1)], { hasLater: true, latest: 100 })
      ))
    } as AgentLensApiClient;
    const view = renderHook(({ selectedEventId }) => useTrajectoryPages("run-a", selectedEventId, null), {
      initialProps: { selectedEventId: null as string | null }, wrapper: wrapper(client)
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.state).toBe("ready");

    await act(async () => {
      view.rerender({ selectedEventId: selected.eventId });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.selectionState).toBe("resolving");
    expect(view.result.current.retrying).toBe(true);
    expect(client.getEvent).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect({
      eventIds: view.result.current.events.map(({ eventId }) => eventId),
      selectionState: view.result.current.selectionState,
      retrying: view.result.current.retrying,
      detailAttempts
    }).toEqual({
      eventIds: ["event-head", "event-selected"],
      selectionState: "idle",
      retrying: false,
      detailAttempts: 2
    });
  });

  it("keeps retry state owned by a selected-event backoff while a cursor request succeeds", async () => {
    vi.useFakeTimers();
    const retryable = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "safe fixture message"
    });
    const selected = event("run-a", "event-selected", 20);
    let detailAttempts = 0;
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(),
      getEvent: vi.fn(() => {
        detailAttempts += 1;
        return detailAttempts === 1 ? Promise.reject(retryable) : Promise.resolve(detail(selected));
      }),
      getEvents: vi.fn((_runId: string, query: { cursor?: string; aroundSequence?: number }) => {
        if (query.cursor === "later-run-a") {
          return Promise.resolve({
            ...page("run-a", [event("run-a", "event-later", 100)], { hasEarlier: true, latest: 100 }),
            mode: "cursor" as const
          });
        }
        if (query.aroundSequence === selected.sequence) {
          return Promise.resolve({
            ...page("run-a", [selected], { hasEarlier: true, hasLater: true, latest: 100 }),
            mode: "around" as const
          });
        }
        return Promise.resolve(page("run-a", [event("run-a", "event-head", 50)], {
          hasEarlier: true, hasLater: true, latest: 100
        }));
      })
    } as AgentLensApiClient;
    const view = renderHook(({ selectedEventId }) => useTrajectoryPages("run-a", selectedEventId, null), {
      initialProps: { selectedEventId: null as string | null }, wrapper: wrapper(client)
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.hasLater).toBe(true);

    await act(async () => {
      view.rerender({ selectedEventId: selected.eventId });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.retrying).toBe(true);

    await act(async () => { await view.result.current.loadLater?.(); });
    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["event-head", "event-later"]);
    expect(view.result.current.retrying).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual([
      "event-selected", "event-head", "event-later"
    ]);
    expect(view.result.current.retrying).toBe(false);
  });

  it("ignores an initial page that resolves after navigation aborted its run", async () => {
    const runA = deferred<TrajectoryPageV1>();
    const runB = deferred<TrajectoryPageV1>();
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(),
      getEvents: vi.fn((runId: string, _query: unknown, _signal?: AbortSignal) =>
        runId === "run-a" ? runA.promise : runB.promise)
    } as AgentLensApiClient;
    const view = renderHook(({ runId }) => useTrajectoryPages(runId, null, null), {
      initialProps: { runId: "run-a" },
      wrapper: wrapper(client)
    });

    view.rerender({ runId: "run-b" });
    expect(client.getEvents.mock.calls[0]?.[2]?.aborted).toBe(true);
    await act(async () => runB.resolve(page("run-b", [event("run-b", "event-b", 1)])));
    await waitFor(() => expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["event-b"]));
    await act(async () => runA.resolve(page("run-a", [event("run-a", "event-a", 1)])));

    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["event-b"]);
    expect(view.result.current.state).toBe("ready");
  });

  it("does not abort a settled initial page when later navigation changes the run", async () => {
    const getEvents = vi.fn((runId: string, _query: unknown, _signal?: AbortSignal) =>
      Promise.resolve(page(runId, [event(runId, `${runId}-event`, 1)])));
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents
    } as AgentLensApiClient;
    const view = renderHook(({ runId }) => useTrajectoryPages(runId, null, null), {
      initialProps: { runId: "run-a" },
      wrapper: wrapper(client)
    });
    await waitFor(() => expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["run-a-event"]));
    const settledSignal = getEvents.mock.calls[0]?.[2];
    expect(settledSignal?.aborted).toBe(false);

    view.rerender({ runId: "run-b" });
    await waitFor(() => expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["run-b-event"]));

    expect(settledSignal?.aborted).toBe(false);
  });

  it("ignores stale selection resolution after a rapid selected-event change", async () => {
    const selectedX = event("run-a", "event-x", 40);
    const selectedY = event("run-a", "event-y", 60);
    const detailX = deferred<EventDetailV1>();
    const detailY = deferred<EventDetailV1>();
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(),
      getEvent: vi.fn((_runId: string, eventId: string, _signal?: AbortSignal) =>
        eventId === "event-x" ? detailX.promise : detailY.promise),
      getEvents: vi.fn((_runId: string, query: { aroundSequence?: number }) => Promise.resolve(
        query.aroundSequence === 40
          ? { ...page("run-a", [selectedX], { hasEarlier: true, latest: 100 }), mode: "around" as const }
          : query.aroundSequence === 60
            ? { ...page("run-a", [selectedY], { hasEarlier: true, latest: 100 }), mode: "around" as const }
            : page("run-a", [event("run-a", "event-head", 1)], { hasLater: true, latest: 100 })
      ))
    } as AgentLensApiClient;
    const view = renderHook(({ selected }) => useTrajectoryPages("run-a", selected, null), {
      initialProps: { selected: null as string | null },
      wrapper: wrapper(client)
    });
    await waitFor(() => expect(view.result.current.state).toBe("ready"));

    view.rerender({ selected: "event-x" });
    await waitFor(() => expect(view.result.current.selectionState).toBe("resolving"));
    view.rerender({ selected: "event-y" });
    await act(async () => detailY.resolve(detail(selectedY)));
    await waitFor(() => expect({
      eventIds: view.result.current.events.map(({ eventId }) => eventId),
      state: view.result.current.state,
      error: String(view.result.current.error)
    }).toEqual({ eventIds: ["event-head", "event-y"], state: "ready", error: "null" }));
    await act(async () => detailX.resolve(detail(selectedX)));

    expect(view.result.current.events.some(({ eventId }) => eventId === "event-x")).toBe(false);
    expect(view.result.current.selectionState).toBe("idle");
    const selectedYSignal = client.getEvent.mock.calls.find(([, eventId]) => eventId === "event-y")?.[2];
    expect(selectedYSignal?.aborted).toBe(false);
  });

  it("does not abort selection resolution when the selected event arrives in a live append", async () => {
    const selected = event("run-a", "event-selected", 2);
    const selectedDetail = deferred<EventDetailV1>();
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(),
      getEvent: vi.fn(() => selectedDetail.promise),
      getEvents: vi.fn((_runId: string, query: { aroundSequence?: number }) => Promise.resolve(
        query.aroundSequence === selected.sequence
          ? { ...page("run-a", [selected]), mode: "around" as const }
          : page("run-a", [event("run-a", "event-head", 1)])
      ))
    } as AgentLensApiClient;
    const view = renderHook(({ selectedEventId }) => useTrajectoryPages("run-a", selectedEventId, null), {
      initialProps: { selectedEventId: null as string | null },
      wrapper: wrapper(client)
    });
    await waitFor(() => expect(view.result.current.state).toBe("ready"));

    view.rerender({ selectedEventId: selected.eventId });
    await waitFor(() => expect(client.getEvent).toHaveBeenCalledOnce());
    const selectionSignal = client.getEvent.mock.calls[0]?.[2];
    await act(async () => {
      view.result.current.appendPage({ ...page("run-a", [selected]), mode: "after" });
    });

    expect(selectionSignal?.aborted).toBe(false);
    await act(async () => selectedDetail.resolve(detail(selected)));
    await waitFor(() => expect(view.result.current.selectionState).toBe("idle"));
    expect(selectionSignal?.aborted).toBe(false);
  });

  it("aborts and ignores a cursor page after navigation resets every run-scoped state", async () => {
    const cursorA = deferred<TrajectoryPageV1>();
    const getEvents = vi.fn((runId: string, query: { cursor?: string }) => {
      if (query.cursor !== undefined) return cursorA.promise;
      return Promise.resolve(page(runId, [event(runId, `${runId}-head`, 1)], { hasLater: runId === "run-a", latest: 10 }));
    });
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(({ runId }) => useTrajectoryPages(runId, null, null), {
      initialProps: { runId: "run-a" }, wrapper: wrapper(client)
    });
    await waitFor(() => expect(view.result.current.hasLater).toBe(true));
    await act(async () => { void view.result.current.loadLater?.(); });
    expect(view.result.current.pagingState).toBe("loading");

    view.rerender({ runId: "run-b" });
    await waitFor(() => expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["run-b-head"]));
    await act(async () => cursorA.resolve({
      ...page("run-a", [event("run-a", "run-a-tail", 10)], { hasEarlier: true, latest: 10 }),
      mode: "cursor"
    }));

    expect(view.result.current.events.map(({ eventId }) => eventId)).toEqual(["run-b-head"]);
    expect(view.result.current.pagingState).toBe("idle");
  });

  it("lets only the newest rapid cursor request commit", async () => {
    const earlier = deferred<TrajectoryPageV1>();
    const later = deferred<TrajectoryPageV1>();
    const getEvents = vi.fn((_runId: string, query: { cursor?: string }) => {
      if (query.cursor === "earlier-run-a") return earlier.promise;
      if (query.cursor === "later-run-a") return later.promise;
      return Promise.resolve(page("run-a", [event("run-a", "event-50", 50)], {
        hasEarlier: true, hasLater: true, latest: 100
      }));
    });
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.hasLater).toBe(true));
    const loadLater = view.result.current.loadLater!;
    const loadEarlier = view.result.current.loadEarlier!;

    await act(async () => {
      void loadLater();
      void loadEarlier();
    });
    await act(async () => earlier.resolve({
      ...page("run-a", [event("run-a", "event-1", 1)], { hasLater: true, latest: 100 }),
      mode: "cursor"
    }));
    await waitFor(() => expect(view.result.current.events.map(({ sequence }) => sequence)).toEqual([1, 50]));
    await act(async () => later.resolve({
      ...page("run-a", [event("run-a", "event-100", 100)], { hasEarlier: true, latest: 100 }),
      mode: "cursor"
    }));

    expect(view.result.current.events.map(({ sequence }) => sequence)).toEqual([1, 50]);
    expect(view.result.current.pagingState).toBe("idle");
  });

  it("records cursor direction so an empty response consumes only that outer boundary", async () => {
    const emptyLater = {
      schemaVersion: 1,
      runId: "run-a",
      mode: "cursor",
      items: [],
      window: {
        state: "empty",
        latestCommittedSequence: 100,
        hasEarlier: false,
        hasLater: false,
        earlierCursor: null,
        laterCursor: null
      }
    } satisfies TrajectoryPageV1;
    const getEvents = vi.fn((_runId: string, query: { cursor?: string }) =>
      Promise.resolve(query.cursor === undefined
        ? page("run-a", [event("run-a", "event-50", 50)], {
            hasEarlier: true, hasLater: true, latest: 100
          })
        : emptyLater));
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.hasLater).toBe(true));

    await act(async () => { await view.result.current.loadLater?.(); });

    expect(view.result.current.hasLater).toBe(false);
    expect(view.result.current.hasEarlier).toBe(true);
    expect(getEvents).toHaveBeenLastCalledWith(
      "run-a",
      { limit: 100, cursor: "later-run-a" },
      expect.any(AbortSignal)
    );
  });

  it("does not abort a settled cursor response when the next page starts", async () => {
    let cursorSequence = 1;
    const getEvents = vi.fn((_runId: string, query: { cursor?: string }) => {
      if (query.cursor === undefined) {
        return Promise.resolve(page("run-a", [event("run-a", "event-0", 0)], {
          hasLater: true,
          latest: 2
        }));
      }
      const sequence = cursorSequence++;
      return Promise.resolve({
        ...page("run-a", [event("run-a", `event-${sequence}`, sequence)], {
          hasEarlier: true,
          hasLater: sequence < 2,
          latest: 2
        }),
        mode: "cursor" as const
      });
    });
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.hasLater).toBe(true));

    await act(async () => { await view.result.current.loadLater?.(); });
    const firstCursorSignal = getEvents.mock.calls.at(-1)?.[2];
    expect(firstCursorSignal?.aborted).toBe(false);
    await act(async () => { await view.result.current.loadLater?.(); });

    expect(firstCursorSignal?.aborted).toBe(false);
    expect(view.result.current.events.map(({ sequence }) => sequence).sort((left, right) => left - right))
      .toEqual([0, 1, 2]);
  });
});

describe("completed trajectory bounded auto-fill", () => {
  it("keeps a completed 100-event trajectory on its initial page", async () => {
    const initial = page("run-100", eventRange("run-100", 1, 100), { latest: 100 });
    const getEvents = vi.fn(async () => initial);
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      () => useTrajectoryPages("run-100", null, completedRun(100)),
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(view.result.current.state).toBe("ready"));

    expect(getEvents).toHaveBeenCalledTimes(1);
    expect({
      loaded: view.result.current.loadedEventCount,
      total: view.result.current.totalEventCount,
      complete: view.result.current.isComplete
    }).toEqual({ loaded: 100, total: 100, complete: true });
  });

  it("loads exactly one final completed-run page at 101 events and resolves its reconciliation selection", async () => {
    const initial = page("run-101", eventRange("run-101", 1, 100), {
      hasLater: true,
      latest: 101
    });
    const reconciled = "run-101-reconciled";
    const later = {
      ...page("run-101", eventRange("run-101", 101, 101, reconciled), {
        hasEarlier: true,
        latest: 101
      }),
      mode: "cursor" as const
    };
    const getEvents = vi.fn(async (_runId: string, query: { cursor?: string }) =>
      query.cursor === undefined ? initial : later);
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      ({ selectedEventId }) => useTrajectoryPages("run-101", selectedEventId, completedRun(101)),
      { initialProps: { selectedEventId: null as string | null }, wrapper: wrapper(client) }
    );

    await waitFor(() => expect(view.result.current.loadedEventCount).toBe(101));
    view.rerender({ selectedEventId: reconciled });
    await waitFor(() => expect(view.result.current.selectionState).toBe("idle"));

    expect(getEvents).toHaveBeenCalledTimes(2);
    expect(getEvents.mock.calls[1]?.[1]).toEqual({ limit: 100, cursor: "later-run-101" });
    expect(view.result.current.events.at(-1)?.eventId).toBe(reconciled);
    expect(view.result.current.isComplete).toBe(true);
    expect(client.getEvent).not.toHaveBeenCalled();
  });

  it("loads exactly one final completed-run page at 200 events", async () => {
    const initial = page("run-200", eventRange("run-200", 1, 100), {
      hasLater: true,
      latest: 200
    });
    const later = {
      ...page("run-200", eventRange("run-200", 101, 200), {
        hasEarlier: true,
        latest: 200
      }),
      mode: "cursor" as const
    };
    const getEvents = vi.fn(async (_runId: string, query: { cursor?: string }) =>
      query.cursor === undefined ? initial : later);
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      () => useTrajectoryPages("run-200", null, completedRun(200)),
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(view.result.current.loadedEventCount).toBe(200));

    expect(getEvents).toHaveBeenCalledTimes(2);
    expect(view.result.current.isComplete).toBe(true);
    expect(view.result.current.hasLater).toBe(false);
  });

  it("does not auto-fill a completed 201-event trajectory or an active 101-event trajectory", async () => {
    const completedInitial = page("run-201", eventRange("run-201", 1, 100), {
      hasLater: true,
      latest: 201
    });
    const activeInitial = page("run-active-101", eventRange("run-active-101", 1, 100), {
      hasLater: true,
      latest: 101
    });
    const completedLater = {
      ...page("run-201", eventRange("run-201", 101, 200), {
        hasEarlier: true,
        hasLater: true,
        latest: 201
      }),
      mode: "cursor" as const
    };
    const getEvents = vi.fn(async (runId: string, query: { cursor?: string }) => {
      if (runId === "run-active-101") return activeInitial;
      return query.cursor === undefined ? completedInitial : completedLater;
    });
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const completed = renderHook(
      () => useTrajectoryPages("run-201", null, completedRun(201)),
      { wrapper: wrapper(client) }
    );
    const active = renderHook(
      () => useTrajectoryPages("run-active-101", null, activeRun(101)),
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(completed.result.current.state).toBe("ready"));
    await waitFor(() => expect(active.result.current.state).toBe("ready"));
    await act(async () => { await Promise.resolve(); });

    expect(getEvents.mock.calls.filter(([runId]) => runId === "run-201")).toHaveLength(1);
    expect(getEvents.mock.calls.filter(([runId]) => runId === "run-active-101")).toHaveLength(1);
    expect(completed.result.current.isComplete).toBe(false);
    expect(active.result.current.isComplete).toBe(false);

    await act(async () => { await completed.result.current.loadLater?.(); });
    await act(async () => { await Promise.resolve(); });

    expect(completed.result.current.loadedEventCount).toBe(200);
    expect(getEvents.mock.calls.filter(([runId]) => runId === "run-201")).toHaveLength(2);
    expect(completed.result.current.hasLater).toBe(true);
  });

  it("deduplicates an overlapping final page but withholds completion when the total remains missing", async () => {
    const initial = page("run-overlap", eventRange("run-overlap", 1, 100), {
      hasLater: true,
      latest: 101
    });
    const duplicate = {
      ...page("run-overlap", [event("run-overlap", "event-100", 100)], {
        hasEarlier: true,
        latest: 101
      }),
      mode: "cursor" as const
    };
    const getEvents = vi.fn(async (_runId: string, query: { cursor?: string }) =>
      query.cursor === undefined ? initial : duplicate);
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      () => useTrajectoryPages("run-overlap", null, completedRun(101)),
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(getEvents).toHaveBeenCalledTimes(2));

    expect(view.result.current.loadedEventCount).toBe(100);
    expect(view.result.current.events.filter(({ eventId }) => eventId === "event-100")).toHaveLength(1);
    expect(view.result.current.isComplete).toBe(false);
    expect(view.result.current.hasLater).toBe(true);
  });

  it("retains its initial page while an automatic final-page read retries a safe active-snapshot refusal", async () => {
    vi.useFakeTimers();
    const initial = page("run-auto-retry", eventRange("run-auto-retry", 1, 100), {
      hasLater: true,
      latest: 101
    });
    const final = {
      ...page("run-auto-retry", eventRange("run-auto-retry", 101, 101), {
        hasEarlier: true,
        latest: 101
      }),
      mode: "cursor" as const
    };
    const retryable = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "safe retryable fixture failure"
    });
    let cursorAttempts = 0;
    const getEvents = vi.fn(async (_runId: string, query: { cursor?: string }) => {
      if (query.cursor === undefined) return initial;
      cursorAttempts += 1;
      if (cursorAttempts === 1) throw retryable;
      return final;
    });
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      () => useTrajectoryPages("run-auto-retry", null, completedRun(101)),
      { wrapper: wrapper(client) }
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(view.result.current.events).toHaveLength(100);
    expect(view.result.current.pagingState).toBe("loading");
    expect(view.result.current.retrying).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    expect(view.result.current.loadedEventCount).toBe(101);
    expect(view.result.current.isComplete).toBe(true);
    expect(cursorAttempts).toBe(2);
  });

  it("retains its first page and manual later control when the final cursor page fails", async () => {
    const initial = page("run-second-page-failure", eventRange("run-second-page-failure", 1, 100), {
      hasLater: true,
      latest: 101
    });
    const failure = new AgentLensClientError({
      code: "invalid_cursor",
      status: 400,
      retryable: false,
      message: "sanitized cursor failure"
    });
    const getEvents = vi.fn(async (_runId: string, query: { cursor?: string }) => {
      if (query.cursor === undefined) return initial;
      throw failure;
    });
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      () => useTrajectoryPages("run-second-page-failure", null, completedRun(101)),
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(view.result.current.pagingState).toBe("error"));

    expect(view.result.current.events).toHaveLength(100);
    expect(view.result.current.hasLater).toBe(true);
    expect(view.result.current.loadLater).not.toBeNull();
    expect(view.result.current.isComplete).toBe(false);
  });

  it("does not infer completeness from equal counts when canonical sequences have a gap", async () => {
    const gapped = [
      ...eventRange("run-gapped", 1, 99),
      event("run-gapped", "event-101", 101)
    ];
    const getEvents = vi.fn(async () => page("run-gapped", gapped, { latest: 101 }));
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      () => useTrajectoryPages("run-gapped", null, completedRun(100)),
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(view.result.current.state).toBe("ready"));

    expect(view.result.current.loadedEventCount).toBe(100);
    expect(view.result.current.isComplete).toBe(false);
  });

  it("does not infer completeness from equal counts while a canonical cursor remains", async () => {
    const initial = page("run-cursor-inconsistent", eventRange("run-cursor-inconsistent", 1, 100), {
      hasLater: true,
      latest: 100
    });
    const getEvents = vi.fn(async () => initial);
    const client = { listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(), getEvents } as AgentLensApiClient;
    const view = renderHook(
      () => useTrajectoryPages("run-cursor-inconsistent", null, completedRun(100)),
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(view.result.current.state).toBe("ready"));

    expect(view.result.current.loadedEventCount).toBe(100);
    expect(view.result.current.hasLater).toBe(true);
    expect(view.result.current.isComplete).toBe(false);
  });
});

describe("trajectory merge containment", () => {
  it("publishes only the latest validated live identity delta instead of a cumulative run ledger", async () => {
    const first = event("run-a", "event-1", 1);
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(),
      getEvents: vi.fn(async () => page("run-a", [first]))
    } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.state).toBe("ready"));

    const second = event("run-a", "event-2", 2);
    await act(async () => {
      view.result.current.appendPage({ ...page("run-a", [second]), mode: "after" });
    });
    expect(view.result.current.liveAppend).toEqual({
      runId: "run-a", revision: 1, identities: ["event-2:2"]
    });

    const third = event("run-a", "event-3", 3);
    await act(async () => {
      view.result.current.appendPage({ ...page("run-a", [third]), mode: "after" });
    });
    expect(view.result.current.liveAppend).toEqual({
      runId: "run-a", revision: 2, identities: ["event-3:3"]
    });

    await act(async () => {
      view.result.current.appendPage({ ...page("run-a", [third]), mode: "after" });
    });
    expect(view.result.current.liveAppend).toEqual({
      runId: "run-a", revision: 3, identities: []
    });
  });

  it("rejects a contradictory cursor page before it can unmount the trajectory", async () => {
    const headEvent = event("run-a", "event-1", 1);
    const head = page("run-a", [headEvent], { hasLater: true, latest: 2 });
    const contradictory = {
      ...page("run-a", [{ ...headEvent, safeSummary: "contradictory replacement" }], {
        hasEarlier: true,
        latest: 2
      }),
      mode: "cursor" as const
    };
    const client = {
      listRuns: vi.fn(), getRun: vi.fn(), getEvent: vi.fn(),
      getEvents: vi.fn((_runId: string, query: { cursor?: string }) =>
        Promise.resolve(query.cursor === undefined ? head : contradictory))
    } as AgentLensApiClient;
    const view = renderHook(() => useTrajectoryPages("run-a", null, null), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.hasLater).toBe(true));

    await act(async () => { await view.result.current.loadLater?.(); });

    expect(view.result.current.pagingState).toBe("error");
    expect(view.result.current.state).toBe("ready");
    expect(view.result.current.events).toEqual([headEvent]);
  });
});
