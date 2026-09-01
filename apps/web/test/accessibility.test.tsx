import type {
  EventDetailV1,
  GitDiffContentV1,
  RunDetailV1,
  RunPageV1,
  TrajectoryEventV1,
  TrajectoryPageV1
} from "@agentlens/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBootstrapHtml } from "../../server/src/bootstrap.js";
import { AgentLensAssessmentConflictError, type AgentLensApiClient } from "../src/api/client.js";
import { ApiClientProvider } from "../src/api/queries.js";
import { App } from "../src/app/App.js";
import { AssessmentEditor } from "../src/assessment/AssessmentEditor.js";
import { Trajectory } from "../src/trajectory/Trajectory.js";

const projected = {
  schemaVersion: 1 as const,
  state: "projected" as const,
  verdict: "unreviewed" as const,
  taskCompleted: "uncertain" as const,
  note: { state: "absent" as const },
  provenance: null,
  currentEventId: null,
  reviewedAt: null,
  updatedAt: null
};

function event(overrides: Partial<TrajectoryEventV1> = {}): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId: "event-command",
    runId: "run-accessible",
    sequence: 1,
    receivedAt: "2026-09-01T12:00:01.000Z",
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "command",
    status: { state: "known", value: "completed" },
    provenance: "observed",
    presentationClass: "command",
    safeSummary: "Run the focused verification",
    source: {
      opaqueRef: `src_${"b".repeat(64)}`,
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
    detail: { state: "available" },
    ...overrides
  };
}

const detailRun: RunDetailV1 = {
  schemaVersion: 1,
  runId: "run-accessible",
  status: { state: "known", value: "completed" },
  provider: { state: "known", value: "codex-exec" },
  label: "Accessible evidence run",
  capturePolicy: "standard",
  repository: { fingerprint: "repo-accessible", display: "agentlens" },
  startedAt: Date.parse("2026-09-01T12:00:00.000Z"),
  endedAt: Date.parse("2026-09-01T12:00:05.000Z"),
  ownership: { storedCondition: "released", diagnosis: "released" },
  finalGitEvidence: { state: "available", headChanged: false, branchChanged: false },
  summary: {
    terminalCommands: { state: "available", value: 1, provenance: "observed", supportingEventIds: ["event-command"], supportingArtifactIds: [] },
    failedTerminalCommands: { state: "available", value: 0, provenance: "observed", supportingEventIds: ["event-command"], supportingArtifactIds: [] },
    nativeFileChanges: { state: "available", value: 0, provenance: "observed", supportingEventIds: [], supportingArtifactIds: [] },
    trackedFinalDiff: { state: "available", value: "artifact", provenance: "git_recovered", supportingEventIds: [], supportingArtifactIds: ["artifact-diff"] },
    untrackedFiles: { state: "available", value: 0, provenance: "git_recovered", supportingEventIds: [], supportingArtifactIds: [] },
    elapsedRecorderTimeMs: { state: "available", value: 5_000, provenance: "recorder", supportingEventIds: [], supportingArtifactIds: [] },
    observedTokenUsage: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
    likelyTests: {
      state: "detected",
      availability: "available",
      provenance: "derived",
      supportingEventIds: ["event-command"],
      supportingArtifactIds: [],
      omittedTerminalCommands: 0,
      attempts: { total: 1, passed: 1, failed: 0, unknown: 0, latest: "passed", previousFailures: 0 },
      sourceEventIds: ["event-command"],
      derivedEventIds: ["event-command"],
      derivationId: "test-command/1",
      durability: "complete",
      missingExpected: 0,
      coverage: "complete"
    },
    assessment: projected,
    providerCapabilityLimitations: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] }
  },
  gitState: {
    state: "available",
    initialHead: "a".repeat(40),
    finalHead: "b".repeat(40),
    initialBranch: { state: "attached", value: "main" },
    finalBranch: { state: "attached", value: "codex/agentlens-task-7" }
  },
  eventCount: 1,
  anchors: {
    firstFailure: null,
    recorderRecovery: null,
    latestLikelyTest: { eventId: "event-command", sequence: 1 },
    finalGitEvidence: null,
    latestEvent: { eventId: "event-command", sequence: 1 }
  },
  warningCodes: [],
  contradictionCodes: []
};

const trajectoryPage: TrajectoryPageV1 = {
  schemaVersion: 1,
  runId: detailRun.runId,
  mode: "head",
  items: [event()],
  window: {
    state: "nonempty",
    minSequence: 1,
    maxSequence: 1,
    latestCommittedSequence: 1,
    hasEarlier: false,
    hasLater: false,
    earlierCursor: null,
    laterCursor: null
  }
};

const eventDetail: EventDetailV1 = {
  schemaVersion: 1,
  eventId: "event-command",
  runId: detailRun.runId,
  sequence: 1,
  kind: "command",
  status: { state: "known", value: "completed" },
  provenance: "observed",
  relationships: [],
  presentationClass: "command",
  lifecycle: "completed",
  content: { state: "available" },
  output: { state: "unavailable", reason: "not_captured" },
  exitCode: 0
};

const diff: GitDiffContentV1 = {
  schemaVersion: 1,
  kind: "diff",
  preamble: [],
  truncated: false,
  malformed: false,
  files: [{
    oldPath: "src/old.ts",
    newPath: "src/new.ts",
    headers: ["diff --git a/src/old.ts b/src/new.ts"],
    metadata: [],
    hunks: [{
      header: "@@ -1 +1 @@",
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      lines: [
        { type: "delete", oldLineNumber: 1, newLineNumber: null, text: "old value" },
        { type: "add", oldLineNumber: null, newLineNumber: 1, text: "new value" }
      ]
    }]
  }]
};

function client(overrides: Partial<AgentLensApiClient> = {}): AgentLensApiClient {
  const unavailable = vi.fn(async (): Promise<never> => { throw new Error("fixture endpoint unused"); });
  const page: RunPageV1 = { schemaVersion: 1, items: [detailRun], nextCursor: null };
  return {
    listRuns: vi.fn(async () => page),
    getRun: vi.fn(async () => detailRun),
    getEvents: vi.fn(async () => trajectoryPage),
    getEvent: vi.fn(async () => eventDetail),
    getEventContent: unavailable,
    getEventNative: unavailable,
    getAssessmentNote: unavailable,
    getGitDiff: vi.fn(async () => diff),
    getGitStatus: unavailable,
    getGitDiffCheck: unavailable,
    getGitUntracked: unavailable,
    updateAssessment: unavailable,
    ...overrides
  };
}

function renderApp(path: string, api = client()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <App client={api} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function expectNoAxeViolations(root: Element): Promise<void> {
  const result = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);
}

afterEach(() => vi.unstubAllGlobals());

describe("production accessibility", () => {
  it("catches semantic or automated accessibility regressions in the real run ledger", async () => {
    const view = renderApp("/runs");
    expect(await screen.findByRole("heading", { level: 1, name: "Run ledger" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    expect(await screen.findByRole("list", { name: "Recorded runs" })).toBeVisible();
    await expectNoAxeViolations(view.container);
  });

  it("catches missing trajectory, inspector, diff, assessment, provenance, or status semantics", async () => {
    const view = renderApp("/runs/run-accessible?event=event-command");
    expect(await screen.findByRole("heading", { level: 1, name: "Accessible evidence run" })).toBeVisible();
    const row = await screen.findByRole("option", { selected: true });
    expect(row).toHaveAccessibleName(/Observed evidence\. Completed\./);
    expect(screen.getByRole("complementary", { name: "Selected evidence inspector" })).toBeVisible();
    await screen.findByRole("tablist", { name: "Event inspector views" });

    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    expect(screen.getByRole("form", { name: "Human assessment" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Open tracked final diff" }));
    const expand = await screen.findByRole("button", { name: "Expand diff for src/new.ts" });
    await userEvent.click(expand);
    expect(screen.getByText("Added line 1")).toHaveClass("sr-only");
    expect(screen.getByText("Deleted line 1")).toHaveClass("sr-only");
    expect(view.container.querySelectorAll("[aria-live]")).toHaveLength(0);
    await expectNoAxeViolations(view.container);
  });

  it("catches missing aria-expanded and reduced-motion policy on real lifecycle rows", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));
    const lifecycleGroupKey = `grp_${"c".repeat(64)}`;
    render(
      <Trajectory
        events={[
          event({ eventId: "event-start", sequence: 1, presentationClass: "lifecycle", lifecycleGroupKey, lifecycle: { domain: "tool", phase: "started" }, status: { state: "known", value: "in_progress" } }),
          event({ eventId: "event-finish", sequence: 2, presentationClass: "lifecycle", lifecycleGroupKey, lifecycle: { domain: "tool", phase: "completed" } })
        ]}
        selectedEventId="event-finish"
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onExpandGroup={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );
    const row = screen.getByRole("option", { selected: true });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row.style.getPropertyValue("--selection-duration")).toBe("0ms");
  });

  it("keeps the real 800px inspector semantic and outside the execution listbox", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(max-width: 800px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));
    const view = renderApp("/runs/run-accessible?event=event-command");
    const selected = await screen.findByRole("option", { selected: true });
    const inspector = await screen.findByTestId("inline-event-inspector");
    const listbox = screen.getByRole("listbox", { name: "Execution trajectory" });

    expect(inspector).toContainElement(screen.getByRole("tablist", { name: "Event inspector views" }));
    expect(listbox).not.toContainElement(inspector);
    expect(selected).toHaveAttribute("data-event-id", "event-command");
    await expectNoAxeViolations(view.container);
  });

  it("keeps one top-level main landmark in the real server bootstrap document", async () => {
    const parsed = new DOMParser().parseFromString(
      createBootstrapHtml("fixture-bearer", "/assets/bootstrap.js", "fixture-nonce"),
      "text/html"
    );
    const previousLang = document.documentElement.lang;
    const previousTitle = document.title;
    document.documentElement.lang = parsed.documentElement.lang;
    document.title = parsed.title;
    document.body.innerHTML = parsed.body.innerHTML;
    const root = document.getElementById("root");
    if (!(root instanceof HTMLElement)) throw new Error("server root missing");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/runs"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <App client={client()} />
        </MemoryRouter>
      </QueryClientProvider>,
      { container: root }
    );
    try {
      expect(await screen.findByRole("heading", { level: 1, name: "Run ledger" })).toBeVisible();
      expect(document.querySelectorAll("main")).toHaveLength(1);
      await expectNoAxeViolations(document.documentElement);
    } finally {
      view.unmount();
      document.body.innerHTML = "";
      document.documentElement.lang = previousLang;
      document.title = previousTitle;
    }
  });

  it("catches focus falling to BODY after Review latest removes its own focused button", async () => {
    const conflict = new AgentLensAssessmentConflictError({
      schemaVersion: 1,
      error: {
        code: "assessment_conflict",
        message: "Assessment changed; review the current assessment before retrying.",
        retryable: false
      },
      assessment: projected,
      etag: '"assessment:projected"'
    });
    const api = client({ updateAssessment: vi.fn(async () => { throw conflict; }) });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={api}>
          <AssessmentEditor runId="run-accessible" assessment={projected} onConfirmed={vi.fn()} />
        </ApiClientProvider>
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    await userEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    const review = await screen.findByRole("button", { name: "Review latest assessment" });
    review.focus();
    await userEvent.click(review);

    const form = screen.getByRole("form", { name: "Human assessment" });
    await waitFor(() => expect(form).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });
});
