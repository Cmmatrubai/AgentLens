import type { RunDetailV1, TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentLensClientError, type AgentLensApiClient, type EventPageQueryV1 } from "../src/api/client.js";
import { ApiClientProvider } from "../src/api/queries.js";
import { RunDetailPage } from "../src/run-detail/RunDetailPage.js";
import { Trajectory } from "../src/trajectory/Trajectory.js";

const source = {
  opaqueRef: `src_${"a".repeat(64)}`,
  provider: { state: "known" as const, value: "codex-exec" as const },
  hasSessionOrThread: true,
  hasTurn: true,
  hasItemOrTool: true,
  hasCorrelation: false
};

function event(sequence: number): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    runId: "run-active",
    sequence,
    receivedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, sequence)).toISOString(),
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "message",
    status: { state: "known", value: "completed" },
    provenance: "observed",
    presentationClass: "message",
    safeSummary: `Committed event ${sequence}`,
    source,
    relationships: [],
    derivation: null,
    nativePayload: { state: "unavailable", reason: "not_captured" },
    lifecycleGroupKey: null,
    lifecycle: null,
    detail: { state: "available" }
  };
}

function run(
  status: "starting" | "running" | "completed",
  eventCount: number
): RunDetailV1 {
  return {
    schemaVersion: 1,
    runId: "run-active",
    status: { state: "known", value: status },
    provider: { state: "known", value: "codex-exec" },
    label: "Active recorder",
    capturePolicy: "standard",
    repository: { fingerprint: "repo-active", display: "agentlens" },
    startedAt: Date.parse("2026-09-01T12:00:00.000Z"),
    endedAt: status === "completed" ? Date.parse("2026-09-01T12:00:07.000Z") : null,
    ownership: { storedCondition: "held", diagnosis: "active_owner" },
    finalGitEvidence: { state: "unavailable", reason: "not_yet_available" },
    summary: {
      terminalCommands: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
      failedTerminalCommands: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
      nativeFileChanges: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
      trackedFinalDiff: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
      untrackedFiles: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
      elapsedRecorderTimeMs: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
      observedTokenUsage: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
      likelyTests: {
        state: "none_detected",
        availability: "available",
        provenance: "derived",
        supportingEventIds: [],
        supportingArtifactIds: [],
        omittedTerminalCommands: 0
      },
      assessment: {
        schemaVersion: 1,
        state: "projected",
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        provenance: null,
        currentEventId: null,
        reviewedAt: null,
        updatedAt: null
      },
      providerCapabilityLimitations: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] }
    },
    gitState: { state: "unavailable", reason: "not_yet_available" },
    eventCount,
    anchors: {
      firstFailure: null,
      recorderRecovery: null,
      latestLikelyTest: null,
      finalGitEvidence: null,
      latestEvent: eventCount === 0 ? null : { eventId: `event-${eventCount}`, sequence: eventCount }
    },
    warningCodes: [],
    contradictionCodes: []
  };
}

function page(mode: "tail" | "after", items: readonly TrajectoryEventV1[], latest: number | null): TrajectoryPageV1 {
  return {
    schemaVersion: 1,
    runId: "run-active",
    mode,
    items: [...items],
    window: items.length === 0 ? {
      state: "empty",
      latestCommittedSequence: latest,
      hasEarlier: latest !== null,
      hasLater: false,
      earlierCursor: latest === null ? null : "earlier-active",
      laterCursor: null
    } : {
      state: "nonempty",
      minSequence: items[0]!.sequence,
      maxSequence: items.at(-1)!.sequence,
      latestCommittedSequence: latest ?? items.at(-1)!.sequence,
      hasEarlier: items[0]!.sequence > 1,
      hasLater: false,
      earlierCursor: items[0]!.sequence > 1 ? "earlier-active" : null,
      laterCursor: null
    }
  };
}

function api(input: Readonly<{
  getRun: AgentLensApiClient["getRun"];
  getEvents: AgentLensApiClient["getEvents"];
}>): AgentLensApiClient {
  const unavailable = vi.fn(async (): Promise<never> => { throw new Error("fixture endpoint unused"); });
  return {
    listRuns: vi.fn(),
    getRun: input.getRun,
    getEvents: input.getEvents,
    getEvent: unavailable,
    getEventContent: unavailable,
    getEventNative: unavailable,
    getAssessmentNote: unavailable,
    getGitDiff: unavailable,
    getGitStatus: unavailable,
    getGitDiffCheck: unavailable,
    getGitUntracked: unavailable,
    updateAssessment: unavailable
  };
}

function renderDetail(client: AgentLensApiClient, path = "/runs/run-active") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <MemoryRouter initialEntries={[path]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <Routes><Route path="/runs/:runId" element={<RunDetailPage />} /></Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

async function flushQueries(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function politeLiveRegions(root: ParentNode): Element[] {
  return [...new Set([
    ...[...root.querySelectorAll('[role="status"]')]
      .filter((element) => element.getAttribute("aria-live") !== "off"),
    ...root.querySelectorAll('[aria-live="polite"]')
  ])];
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("active run polling", () => {
  it("catches an eager duplicate tail request before the initial trajectory snapshot settles", async () => {
    vi.useFakeTimers();
    let resolveInitial!: (value: TrajectoryPageV1) => void;
    const getRun = vi.fn(async () => run("running", 0));
    const getEvents = vi.fn()
      .mockImplementationOnce(() => new Promise<TrajectoryPageV1>((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValue(page("tail", [], null));
    renderDetail(api({ getRun, getEvents }));

    await flushQueries();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("running")).toBeVisible();
    expect(getEvents).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(getEvents).toHaveBeenCalledTimes(1);

    await act(async () => { resolveInitial(page("tail", [], null)); });
    await flushQueries();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(getEvents).toHaveBeenCalledTimes(2);
  });

  it("catches a missing one-second poll, wrong zero-event tail selector, stale sequence, or terminal timer leak", async () => {
    vi.useFakeTimers();
    const runSnapshots = [run("starting", 0), run("running", 4), run("running", 7), run("completed", 7)];
    const pages = [
      page("tail", [], null),
      page("tail", [event(1), event(2), event(3), event(4)], 4),
      page("after", [event(5), event(6), event(7)], 7),
      page("after", [], 7)
    ];
    const getRun = vi.fn(async () => runSnapshots.shift()!);
    const getEvents = vi.fn(async () => pages.shift()!);
    renderDetail(api({ getRun, getEvents }));

    await flushQueries();
    expect(getEvents).toHaveBeenCalledTimes(1);
    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(screen.getByText("Committed event 7")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    const requests = getEvents.mock.calls.map(([, query]) => {
      const value = query as EventPageQueryV1;
      return value.afterSequence === undefined
        ? { mode: "tail" as const }
        : { afterSequence: value.afterSequence };
    });
    expect(requests).toEqual([
      { mode: "tail" },
      { mode: "tail" },
      { afterSequence: 4 },
      { afterSequence: 7 }
    ]);
    expect(getRun).toHaveBeenCalledTimes(4);
    expect(getEvents).toHaveBeenCalledTimes(4);
    expect(screen.getByText("completed")).toBeVisible();
  });

  it("catches blanking valid evidence, hiding degradation, or silently stopping after a retryable 503", async () => {
    vi.useFakeTimers();
    const degraded = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "Active run evidence is temporarily unavailable."
    });
    const getRun = vi.fn()
      .mockResolvedValueOnce(run("running", 4))
      .mockRejectedValueOnce(degraded)
      .mockResolvedValueOnce(run("running", 5));
    const getEvents = vi.fn()
      .mockResolvedValueOnce(page("tail", [event(1), event(2), event(3), event(4)], 4))
      .mockRejectedValueOnce(degraded)
      .mockResolvedValueOnce(page("after", [event(5)], 5));
    renderDetail(api({ getRun, getEvents }));

    await flushQueries();
    expect(screen.getByText("Committed event 4")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText("Committed event 4")).toBeVisible();
    expect(screen.getByLabelText("Live evidence status")).toHaveTextContent(
      "Live evidence temporarily unavailable"
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText("Committed event 5")).toBeVisible();
    expect(getEvents).toHaveBeenLastCalledWith(
      "run-active",
      { limit: 100, afterSequence: 4 },
      expect.any(AbortSignal)
    );
  });

  it("catches an unhandled merge failure, mutated valid evidence, or continued polling after a contract contradiction", async () => {
    vi.useFakeTimers();
    const contradictoryEvent = { ...event(5), eventId: "event-4" };
    const getRun = vi.fn(async () => run("running", 5));
    const getEvents = vi.fn()
      .mockResolvedValueOnce(page("tail", [event(1), event(2), event(3), event(4)], 4))
      .mockResolvedValueOnce(page("after", [contradictoryEvent], 5));
    renderDetail(api({ getRun, getEvents }));

    await flushQueries();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(screen.getByText("Committed event 4")).toBeVisible();
    expect(screen.queryByText("Committed event 5")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Live evidence polling stopped");
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(getEvents).toHaveBeenCalledTimes(2);
  });
});

describe("follow tail", () => {
  it("catches selection loss or forced history scrolling by exposing one deliberate new-event jump", async () => {
    const onSelect = vi.fn();
    const view = render(
      <Trajectory
        runId="run-active"
        events={[event(1), event(2)]}
        liveAppend={{ runId: "run-active", revision: 0, identities: [] }}
        selectedEventId="event-1"
        expandedGroupKeys={new Set()}
        onSelect={onSelect}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );
    const viewport = screen.getByRole("listbox", { name: "Execution trajectory" });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(viewport);
    view.rerender(
      <Trajectory
        runId="run-active"
        events={[event(1), event(2), event(3)]}
        liveAppend={{ runId: "run-active", revision: 1, identities: ["event-3:3"] }}
        selectedEventId="event-1"
        expandedGroupKeys={new Set()}
        onSelect={onSelect}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-1");
    expect(viewport.scrollTop).toBe(100);
    const jump = await screen.findByRole("button", { name: "1 new event" });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await userEvent.click(jump);
    expect(onSelect).toHaveBeenCalledWith("event-3");
    expect(screen.queryByRole("button", { name: /new event/ })).not.toBeInTheDocument();
  });

  it("catches historical earlier and later cursor pages being counted as live appends", async () => {
    const initial = {
      ...page("tail", [event(50)], 100),
      window: {
        state: "nonempty" as const,
        minSequence: 50,
        maxSequence: 50,
        latestCommittedSequence: 100,
        hasEarlier: true,
        hasLater: true,
        earlierCursor: "earlier-active",
        laterCursor: "later-active"
      }
    };
    const earlier = {
      ...page("tail", [event(1)], 100),
      mode: "cursor" as const,
      window: {
        state: "nonempty" as const,
        minSequence: 1,
        maxSequence: 1,
        latestCommittedSequence: 100,
        hasEarlier: false,
        hasLater: true,
        earlierCursor: null,
        laterCursor: "later-active"
      }
    };
    const later = {
      ...page("tail", [event(100)], 100),
      mode: "cursor" as const,
      window: {
        state: "nonempty" as const,
        minSequence: 100,
        maxSequence: 100,
        latestCommittedSequence: 100,
        hasEarlier: true,
        hasLater: false,
        earlierCursor: "earlier-active",
        laterCursor: null
      }
    };
    const getEvents = vi.fn(async (_runId: string, query: EventPageQueryV1) => {
      if (query.cursor === "earlier-active") return earlier;
      if (query.cursor === "later-active") return later;
      return initial;
    });
    renderDetail(api({ getRun: vi.fn(async () => run("completed", 100)), getEvents }));
    const viewport = await screen.findByRole("listbox", { name: "Execution trajectory" });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(viewport);

    await userEvent.click(screen.getByRole("button", { name: "Load earlier" }));
    expect(await screen.findByText("Committed event 1")).toBeVisible();
    expect(screen.queryByRole("button", { name: /new events?/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load later" }));
    expect(await screen.findByText("Committed event 100")).toBeVisible();
    expect(screen.queryByRole("button", { name: /new events?/ })).not.toBeInTheDocument();
  });

  it("catches an around-selection backfill being counted as a live append", async () => {
    const selected = event(75);
    const around = deferred<TrajectoryPageV1>();
    const aroundPage = {
          ...page("tail", [selected], 100),
          mode: "around" as const,
          window: {
            state: "nonempty" as const,
            minSequence: 75,
            maxSequence: 75,
            latestCommittedSequence: 100,
            hasEarlier: true,
            hasLater: true,
            earlierCursor: "around-earlier",
            laterCursor: "around-later"
          }
        };
    const getEvents = vi.fn((_runId: string, query: EventPageQueryV1) => query.aroundSequence === 75
      ? around.promise
      : Promise.resolve({
          ...page("tail", [event(50)], 100),
          window: {
            state: "nonempty" as const,
            minSequence: 50,
            maxSequence: 50,
            latestCommittedSequence: 100,
            hasEarlier: true,
            hasLater: true,
            earlierCursor: "head-earlier",
            laterCursor: "head-later"
          }
        }));
    const getEvent = vi.fn(async () => ({
      schemaVersion: 1 as const,
      eventId: selected.eventId,
      runId: selected.runId,
      sequence: selected.sequence,
      kind: selected.kind,
      status: selected.status,
      provenance: selected.provenance,
      relationships: [],
      presentationClass: selected.presentationClass,
      role: "agent" as const,
      content: { state: "unavailable" as const, reason: "not_captured" as const }
    }));
    const client = api({ getRun: vi.fn(async () => run("completed", 100)), getEvents });
    client.getEvent = getEvent;
    renderDetail(client, "/runs/run-active?event=event-75");
    const viewport = await screen.findByRole("listbox", { name: "Execution trajectory" });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(viewport);
    await act(async () => around.resolve(aroundPage));

    expect(await screen.findByRole("option", { name: /Committed event 75/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /new events?/ })).not.toBeInTheDocument();
  });

  it("catches a duplicate live page increasing the genuine active-append count", async () => {
    vi.useFakeTimers();
    const getRun = vi.fn(async () => run("running", 3));
    const getEvents = vi.fn()
      .mockResolvedValueOnce(page("tail", [event(1), event(2)], 2))
      .mockResolvedValueOnce(page("after", [event(3)], 3))
      .mockResolvedValueOnce(page("after", [event(3)], 3));
    renderDetail(api({ getRun, getEvents }));
    await flushQueries();
    const viewport = screen.getByRole("listbox", { name: "Execution trajectory" });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(viewport);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole("button", { name: "1 new event" })).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole("button", { name: "1 new event" })).toBeVisible();
  });

  it("catches degraded and paging facts creating extra polite regions beside a pending new-event count", async () => {
    vi.useFakeTimers();
    const degraded = new AgentLensClientError({
      code: "active_snapshot_unavailable",
      status: 503,
      retryable: true,
      message: "Active run evidence is temporarily unavailable."
    });
    const earlier = deferred<TrajectoryPageV1>();
    let liveRead = 0;
    const getRun = vi.fn()
      .mockResolvedValueOnce(run("running", 3))
      .mockResolvedValueOnce(run("running", 4))
      .mockRejectedValueOnce(degraded);
    const getEvents = vi.fn((_runId: string, query: EventPageQueryV1) => {
      if (query.cursor !== undefined) return earlier.promise;
      liveRead += 1;
      if (liveRead === 1) return Promise.resolve(page("tail", [event(2), event(3)], 3));
      if (liveRead === 2) return Promise.resolve(page("after", [event(4)], 4));
      return Promise.reject(degraded);
    });
    const client = api({ getRun, getEvents });
    client.getEvent = vi.fn(async () => ({
      schemaVersion: 1,
      eventId: "event-3",
      runId: "run-active",
      sequence: 3,
      kind: "message",
      status: { state: "known", value: "completed" },
      provenance: "observed",
      relationships: [],
      presentationClass: "message",
      role: "agent",
      content: { state: "unavailable", reason: "not_captured" }
    }));
    const view = renderDetail(client, "/runs/run-active?event=event-3");
    await flushQueries();
    const viewport = screen.getByRole("listbox", { name: "Execution trajectory" });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(viewport);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole("button", { name: "1 new event" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier" }));
    expect(screen.getByText("Loading trajectory page…")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(screen.getByText("Committed event 4")).toBeVisible();
    expect(screen.getByText(/Live evidence temporarily unavailable/)).toBeVisible();
    const liveRegions = politeLiveRegions(view.container);
    expect(liveRegions).toHaveLength(1);
    expect(liveRegions[0]).toHaveTextContent("1 new event available");

    await act(async () => earlier.resolve({
      ...page("tail", [event(1)], 4),
      mode: "cursor"
    }));
  });

  it("catches a pending live count carrying across a same-component run identity change", async () => {
    const view = render(
      <Trajectory
        runId="run-active"
        events={[event(1), event(2)]}
        liveAppend={{ runId: "run-active", revision: 0, identities: [] }}
        selectedEventId="event-1"
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );
    const viewport = screen.getByRole("listbox", { name: "Execution trajectory" });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(viewport);
    view.rerender(
      <Trajectory
        runId="run-active"
        events={[event(1), event(2), event(3)]}
        liveAppend={{ runId: "run-active", revision: 1, identities: ["event-3:3"] }}
        selectedEventId="event-1"
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );
    expect(await screen.findByRole("button", { name: "1 new event" })).toBeVisible();

    const runBEvent = { ...event(1), runId: "run-b", eventId: "run-b-event-1" };
    view.rerender(
      <Trajectory
        runId="run-b"
        events={[runBEvent]}
        liveAppend={{ runId: "run-b", revision: 0, identities: [] }}
        selectedEventId={runBEvent.eventId}
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /new events?/ })).not.toBeInTheDocument();
  });

  it.each(["{Enter}", " "])("catches %s jump activation dropping focus after the button unmounts", async (key) => {
    function ControlledTrajectory({ items, liveAppend }: Readonly<{
      items: readonly TrajectoryEventV1[];
      liveAppend: Readonly<{ runId: string; revision: number; identities: readonly string[] }>;
    }>) {
      const [selectedEventId, setSelectedEventId] = useState("event-1");
      return (
        <Trajectory
          runId="run-active"
          events={items}
          liveAppend={liveAppend}
          selectedEventId={selectedEventId}
          expandedGroupKeys={new Set()}
          onSelect={setSelectedEventId}
          onEscapeDeepEvidence={vi.fn()}
          onRelationshipJump={vi.fn()}
        />
      );
    }
    const view = render(
      <ControlledTrajectory
        items={[event(1), event(2)]}
        liveAppend={{ runId: "run-active", revision: 0, identities: [] }}
      />
    );
    const viewport = screen.getByRole("listbox", { name: "Execution trajectory" });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(viewport);
    view.rerender(
      <ControlledTrajectory
        items={[event(1), event(2), event(3)]}
        liveAppend={{ runId: "run-active", revision: 1, identities: ["event-3:3"] }}
      />
    );

    const jump = await screen.findByRole("button", { name: "1 new event" });
    jump.focus();
    await userEvent.keyboard(key);
    const latest = screen.getByRole("option", { selected: true });
    await waitFor(() => expect(latest).toHaveFocus());
    expect(latest).toHaveAttribute("data-event-id", "event-3");
    expect(document.activeElement).not.toBe(document.body);
  });
});
