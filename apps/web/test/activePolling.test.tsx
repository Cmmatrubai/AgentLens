import type { RunDetailV1, TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function renderDetail(client: AgentLensApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <MemoryRouter initialEntries={["/runs/run-active"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
    expect(screen.getByRole("status", { name: "Live evidence status" })).toHaveTextContent(
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
        events={[event(1), event(2)]}
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
        events={[event(1), event(2), event(3)]}
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
});
