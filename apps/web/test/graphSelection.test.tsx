import type {
  EventDetailV1,
  RunDetailV1,
  TrajectoryEventV1,
  TrajectoryPageV1
} from "@agentlens/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType
} from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { AgentLensApiClient, EventPageQueryV1 } from "../src/api/client.js";
import { ApiClientProvider } from "../src/api/queries.js";
import { queryKeys } from "../src/api/queryKeys.js";
import { RunDetailPage } from "../src/run-detail/RunDetailPage.js";
import { initialGraphEventId } from "../src/trajectory/initialGraphSelection.js";

function event(eventId: string, sequence: number, runId = "run-selection"): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId,
    runId,
    sequence,
    receivedAt: new Date(Date.UTC(2026, 8, 5, 12, 0, sequence)).toISOString(),
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "command",
    status: { state: "known", value: "completed" },
    provenance: "observed",
    presentationClass: "command",
    safeSummary: `Recorded ${eventId}`,
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

const noAnchors: RunDetailV1["anchors"] = {
  firstFailure: null,
  recorderRecovery: null,
  latestLikelyTest: null,
  finalGitEvidence: null,
  latestEvent: null
};

function runDetail(
  runId: string,
  overrides: Partial<Pick<RunDetailV1, "status" | "eventCount" | "anchors" | "contradictionCodes">> = {}
): RunDetailV1 {
  return {
    schemaVersion: 1,
    runId,
    status: { state: "known", value: "completed" },
    provider: { state: "known", value: "codex-exec" },
    label: `Selection ${runId}`,
    capturePolicy: "standard",
    repository: { fingerprint: `repo-${runId}`, display: "agentlens" },
    startedAt: Date.parse("2026-09-05T12:00:00.000Z"),
    endedAt: Date.parse("2026-09-05T12:00:05.000Z"),
    ownership: { storedCondition: "released", diagnosis: "released" },
    finalGitEvidence: { state: "available", headChanged: false, branchChanged: false },
    summary: {
      terminalCommands: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      failedTerminalCommands: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      nativeFileChanges: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      trackedFinalDiff: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      untrackedFiles: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      elapsedRecorderTimeMs: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      observedTokenUsage: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
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
      providerCapabilityLimitations: {
        state: "unavailable",
        reason: "not_captured",
        supportingEventIds: [],
        supportingArtifactIds: []
      }
    },
    gitState: { state: "unavailable", reason: "not_captured" },
    eventCount: 1,
    anchors: noAnchors,
    warningCodes: [],
    contradictionCodes: [],
    ...overrides
  };
}

function trajectoryPage(
  runId: string,
  items: readonly TrajectoryEventV1[],
  options: Readonly<{
    mode?: TrajectoryPageV1["mode"];
    latest?: number | null;
    hasEarlier?: boolean;
    hasLater?: boolean;
  }> = {}
): TrajectoryPageV1 {
  const mode = options.mode ?? "head";
  const latest = options.latest ?? items.at(-1)?.sequence ?? null;
  if (items.length === 0) {
    return {
      schemaVersion: 1,
      runId,
      mode,
      items: [],
      window: {
        state: "empty",
        latestCommittedSequence: latest,
        hasEarlier: false,
        hasLater: false,
        earlierCursor: null,
        laterCursor: null
      }
    };
  }
  const hasEarlier = options.hasEarlier ?? false;
  const hasLater = options.hasLater ?? false;
  return {
    schemaVersion: 1,
    runId,
    mode,
    items: [...items],
    window: {
      state: "nonempty",
      minSequence: items[0]!.sequence,
      maxSequence: items.at(-1)!.sequence,
      latestCommittedSequence: latest!,
      hasEarlier,
      hasLater,
      earlierCursor: hasEarlier ? `earlier-${runId}` : null,
      laterCursor: hasLater ? `later-${runId}` : null
    }
  };
}

function eventDetail(item: TrajectoryEventV1): EventDetailV1 {
  return {
    schemaVersion: 1,
    eventId: item.eventId,
    runId: item.runId,
    sequence: item.sequence,
    kind: item.kind,
    status: item.status,
    provenance: item.provenance,
    relationships: item.relationships,
    presentationClass: "command",
    command: "pnpm test",
    exitCode: 1,
    output: { state: "unavailable", reason: "not_captured" }
  };
}

function client(overrides: Partial<AgentLensApiClient>): AgentLensApiClient {
  const unavailable = vi.fn(async (): Promise<never> => {
    throw new Error("Fixture endpoint unused");
  });
  return {
    listRuns: vi.fn(),
    getRun: unavailable,
    getEvents: unavailable,
    getEvent: unavailable,
    getEventContent: unavailable,
    getEventNative: unavailable,
    getAssessmentNote: unavailable,
    getGitDiff: unavailable,
    getGitStatus: unavailable,
    getGitDiffCheck: unavailable,
    getGitUntracked: unavailable,
    updateAssessment: unavailable,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="navigation-type">{navigationType}</output>
      <button type="button" onClick={() => navigate(-1)}>History back</button>
      <button type="button" onClick={() => navigate(1)}>History forward</button>
      <button type="button" onClick={() => navigate("/runs/run-b?scope=beta")}>Open run B</button>
    </>
  );
}

function renderDetail(
  api: AgentLensApiClient,
  initialEntries: readonly string[],
  options: Readonly<{
    initialIndex?: number;
    cachedRuns?: readonly RunDetailV1[];
  }> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: options.cachedRuns === undefined ? 0 : Number.POSITIVE_INFINITY },
      mutations: { retry: false }
    }
  });
  for (const cachedRun of options.cachedRuns ?? []) {
    queryClient.setQueryData(queryKeys.run(cachedRun.runId), cachedRun);
  }
  return render(
    <MemoryRouter
      initialEntries={[...initialEntries]}
      initialIndex={options.initialIndex ?? initialEntries.length - 1}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={api}>
          <Routes>
            <Route path="/runs/:runId" element={<RunDetailPage />} />
            <Route path="/before" element={<p>Before run</p>} />
          </Routes>
          <NavigationProbe />
        </ApiClientProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("initialGraphEventId", () => {
  it("prioritizes the exact first-failure anchor over recovery, likely-test, and loaded events", () => {
    expect(initialGraphEventId({
      ...noAnchors,
      firstFailure: { eventId: "failure", sequence: 40 },
      recorderRecovery: { eventId: "recovery", sequence: 30 },
      latestLikelyTest: { eventId: "test", sequence: 20 }
    }, [event("loaded-first", 1)])).toBe("failure");
  });

  it("falls through recorder recovery, latest likely test, then the first loaded event", () => {
    expect(initialGraphEventId({
      ...noAnchors,
      recorderRecovery: { eventId: "recovery", sequence: 30 },
      latestLikelyTest: { eventId: "test", sequence: 20 }
    }, [event("loaded-first", 1)])).toBe("recovery");
    expect(initialGraphEventId({
      ...noAnchors,
      latestLikelyTest: { eventId: "test", sequence: 20 }
    }, [event("loaded-first", 1)])).toBe("test");
    expect(initialGraphEventId(noAnchors, [event("loaded-first", 1), event("loaded-second", 2)]))
      .toBe("loaded-first");
  });

  it("returns null for an empty run instead of fabricating an anchor from contradiction metadata", () => {
    expect(initialGraphEventId(noAnchors, [])).toBeNull();
  });

  it("does not substitute final-git or latest-event navigation anchors for an actionable focus", () => {
    expect(initialGraphEventId({
      ...noAnchors,
      finalGitEvidence: { eventId: "final-git", sequence: 40 },
      latestEvent: { eventId: "latest", sequence: 50 }
    }, [event("loaded-first", 1)])).toBe("loaded-first");
  });
});

describe("initial graph route selection", () => {
  it("preserves a valid explicit event and unrelated query parameters", async () => {
    const runId = "run-selection";
    const loaded = [event("event-explicit", 1), event("event-failure", 2)];
    const api = client({
      getRun: vi.fn(async () => runDetail(runId, {
        eventCount: loaded.length,
        anchors: { ...noAnchors, firstFailure: { eventId: "event-failure", sequence: 2 } }
      })),
      getEvents: vi.fn(async () => trajectoryPage(runId, loaded))
    });

    renderDetail(api, [
      `/runs/${runId}?scope=all`,
      `/runs/${runId}?scope=all&event=event-explicit`
    ]);

    expect(await screen.findByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-explicit");
    expect(screen.getByTestId("location")).toHaveTextContent(`/runs/${runId}?scope=all&event=event-explicit`);
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");

    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/runs/${runId}?scope=all`));
    expect(screen.queryByRole("option", { selected: true })).not.toBeInTheDocument();
  });

  it.each([
    ["invalid", "/runs/run-selection?scope=all&event="],
    ["duplicate", "/runs/run-selection?scope=all&event=event-a&event=event-b"]
  ])("preserves a present %s event query without automatic replacement", async (_case, entry) => {
    const runId = "run-selection";
    const api = client({
      getRun: vi.fn(async () => runDetail(runId)),
      getEvents: vi.fn(async () => trajectoryPage(runId, [event("event-first", 1)]))
    });

    renderDetail(api, [entry]);

    expect(await screen.findByRole("alert")).toHaveTextContent("The selected event link is invalid.");
    expect(screen.getByTestId("location")).toHaveTextContent(entry);
    expect(screen.queryByRole("option", { selected: true })).not.toBeInTheDocument();
    expect(api.getEvent).not.toHaveBeenCalled();
  });

  it("replaces the initial history entry with an anchored event resolved around an unloaded sequence", async () => {
    const runId = "run-selection";
    const first = event("event-first", 1);
    const failure = event("event-failure", 50);
    const getEvents = vi.fn((_requestedRunId: string, query: EventPageQueryV1) => Promise.resolve(
      query.aroundSequence === 50
        ? trajectoryPage(runId, [failure], { mode: "around", latest: 50, hasEarlier: true })
        : trajectoryPage(runId, [first], { latest: 50, hasLater: true })
    ));
    const api = client({
      getRun: vi.fn(async () => runDetail(runId, {
        eventCount: 50,
        anchors: { ...noAnchors, firstFailure: { eventId: failure.eventId, sequence: failure.sequence } }
      })),
      getEvents,
      getEvent: vi.fn(async () => eventDetail(failure))
    });

    renderDetail(api, ["/before", `/runs/${runId}?scope=all`]);

    expect(await screen.findByRole("option", { selected: true })).toHaveAttribute("data-event-id", failure.eventId);
    expect(screen.getByTestId("location")).toHaveTextContent(`/runs/${runId}?scope=all&event=${failure.eventId}`);
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
    expect(api.getEvent).toHaveBeenCalledWith(runId, failure.eventId, expect.any(AbortSignal));
    expect(getEvents).toHaveBeenCalledWith(runId, { limit: 100, aroundSequence: 50 }, expect.any(AbortSignal));

    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/before"));
  });

  it("keeps user and browser-history selection through paging and active polling", async () => {
    const runId = "run-selection";
    const first = event("event-first", 1);
    const chosen = event("event-chosen", 2);
    const paged = event("event-paged", 3);
    const appended = event("event-appended", 4);
    const getRun = vi.fn()
      .mockResolvedValueOnce(runDetail(runId, {
        status: { state: "known", value: "running" },
        eventCount: 3
      }))
      .mockResolvedValue(runDetail(runId, { eventCount: 4 }));
    const getEvents = vi.fn((_requestedRunId: string, query: EventPageQueryV1) => {
      if (query.cursor === `later-${runId}`) {
        return Promise.resolve(trajectoryPage(runId, [paged], { mode: "cursor", latest: 3, hasEarlier: true }));
      }
      if (query.afterSequence === 3) {
        return Promise.resolve(trajectoryPage(runId, [appended], { mode: "after", latest: 4, hasEarlier: true }));
      }
      return Promise.resolve(trajectoryPage(runId, [first, chosen], { latest: 3, hasLater: true }));
    });
    const api = client({ getRun, getEvents });

    renderDetail(api, [`/runs/${runId}?scope=all`]);
    expect(await screen.findByRole("option", { selected: true })).toHaveAttribute("data-event-id", first.eventId);

    fireEvent.click(screen.getByRole("option", { name: /Recorded event-chosen/ }));
    await waitFor(() => expect(screen.getByTestId("location"))
      .toHaveTextContent(`/runs/${runId}?scope=all&event=${chosen.eventId}`));
    fireEvent.click(screen.getByRole("button", { name: "Load later" }));
    expect(await screen.findByText("Recorded event-paged")).toBeVisible();
    expect(await screen.findByText("Recorded event-appended", {}, { timeout: 2_500 })).toBeVisible();
    expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", chosen.eventId);
    expect(screen.getByTestId("location")).toHaveTextContent(`/runs/${runId}?scope=all&event=${chosen.eventId}`);

    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() => expect(screen.getByRole("option", { selected: true }))
      .toHaveAttribute("data-event-id", first.eventId));
    fireEvent.click(screen.getByRole("button", { name: "History forward" }));
    await waitFor(() => expect(screen.getByRole("option", { selected: true }))
      .toHaveAttribute("data-event-id", chosen.eventId));
  });

  it("initializes the next run independently after a route identity change", async () => {
    const runAEvent = event("event-a", 1, "run-a");
    const runBEvent = event("event-b", 1, "run-b");
    const api = client({
      getRun: vi.fn(async (runId: string) => runDetail(runId)),
      getEvents: vi.fn(async (runId: string) => trajectoryPage(
        runId,
        [runId === "run-a" ? runAEvent : runBEvent]
      ))
    });

    renderDetail(api, ["/runs/run-a?scope=alpha"]);
    expect(await screen.findByRole("option", { selected: true })).toHaveAttribute("data-event-id", runAEvent.eventId);

    fireEvent.click(screen.getByRole("button", { name: "Open run B" }));
    await waitFor(() => expect(screen.getByTestId("location"))
      .toHaveTextContent("/runs/run-b?scope=beta&event=event-b"));
    expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", runBEvent.eventId);
  });

  it.each([
    ["nonempty", [event("event-a", 1, "run-a")] as readonly TrajectoryEventV1[]],
    ["empty", [] as readonly TrajectoryEventV1[]]
  ])("waits for a cached next run's own initial page when the prior run is %s", async (_case, runAEvents) => {
    const runA = runDetail("run-a", { eventCount: runAEvents.length });
    const runB = runDetail("run-b");
    const runBEvent = event("event-b", 1, "run-b");
    const runBPage = deferred<TrajectoryPageV1>();
    const getEvents = vi.fn((runId: string) => runId === "run-a"
      ? Promise.resolve(trajectoryPage(runId, runAEvents))
      : runBPage.promise);
    const api = client({
      getRun: vi.fn(async (runId: string) => runId === "run-a" ? runA : runB),
      getEvents
    });

    renderDetail(api, ["/runs/run-a?scope=alpha"], { cachedRuns: [runB] });
    if (runAEvents.length === 0) {
      expect(await screen.findByText("No trajectory events are available for this run.")).toBeVisible();
    } else {
      expect(await screen.findByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-a");
    }

    fireEvent.click(screen.getByRole("button", { name: "Open run B" }));
    await waitFor(() => expect(getEvents.mock.calls.some(([runId]) => runId === "run-b")).toBe(true));
    expect(screen.getByTestId("location").textContent).toBe("/runs/run-b?scope=beta");

    await act(async () => runBPage.resolve(trajectoryPage("run-b", [runBEvent])));
    await waitFor(() => expect(screen.getByTestId("location").textContent)
      .toBe("/runs/run-b?scope=beta&event=event-b"));
    expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", runBEvent.eventId);
  });

  it("leaves an empty run unselected even when contradiction codes are present", async () => {
    const runId = "run-selection";
    const api = client({
      getRun: vi.fn(async () => runDetail(runId, {
        eventCount: 0,
        contradictionCodes: ["summary.event-count-mismatch"]
      })),
      getEvents: vi.fn(async () => trajectoryPage(runId, []))
    });

    renderDetail(api, [`/runs/${runId}?scope=all`]);

    expect(await screen.findByText("No trajectory events are available for this run.")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(`/runs/${runId}?scope=all`);
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
    expect(api.getEvent).not.toHaveBeenCalled();
  });
});
