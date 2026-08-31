import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RunListItemV1, RunPageV1 } from "@agentlens/api-contract";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/app/App.js";
import {
  AgentLensClientError,
  type AgentLensApiClient
} from "../src/api/client.js";

const eventOrigin = (provenance: "observed" | "derived" | "git_recovered" | "recorder" | "human") => ({
  type: "event" as const,
  provenance
});

function available<T>(value: T, provenance: "observed" | "derived" | "git_recovered" | "recorder" | "human") {
  return {
    state: "available" as const,
    value,
    origin: eventOrigin(provenance),
    supportingEventIds: [],
    supportingArtifactIds: []
  };
}

function unavailable(reason: "provider_capability" | "capture_policy" | "not_captured" | "not_yet_available" | "artifact_omitted" | "artifact_unreadable") {
  return {
    state: "unavailable" as const,
    reason,
    origin: null,
    supportingEventIds: [],
    supportingArtifactIds: []
  };
}

function projectedAssessment() {
  return {
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
}

function run(
  id: string,
  status: RunListItemV1["status"],
  overrides: Partial<RunListItemV1> = {}
): RunListItemV1 {
  const value: RunListItemV1 = {
    schemaVersion: 1,
    runId: id,
    status,
    provider: { state: "known", value: "codex-exec" },
    label: `Run ${id}`,
    capturePolicy: "standard",
    repository: { fingerprint: `repo-${id}`, display: "agentlens" },
    startedAt: Date.UTC(2026, 7, 31, 16, 0, 0),
    endedAt: Date.UTC(2026, 7, 31, 16, 0, 1),
    ownership: { storedCondition: "released", diagnosis: "released" },
    finalGitEvidence: { state: "available", headChanged: false, branchChanged: false },
    summary: {
      terminalCommands: available(2, "observed"),
      failedTerminalCommands: available(1, "observed"),
      nativeFileChanges: available(1, "observed"),
      trackedFinalDiff: available("artifact", "git_recovered"),
      untrackedFiles: available(3, "git_recovered"),
      elapsedRecorderTimeMs: available(1_250, "recorder"),
      observedTokenUsage: unavailable("not_captured"),
      likelyTests: {
        state: "detected",
        availability: "available",
        provenance: "derived",
        supportingEventIds: ["source-command"],
        supportingArtifactIds: [],
        omittedTerminalCommands: 0,
        attempts: {
          total: 2,
          passed: 1,
          failed: 1,
          unknown: 0,
          latest: "passed",
          previousFailures: 1
        },
        sourceEventIds: ["source-command"],
        derivedEventIds: ["derived-test"],
        derivationId: "test-command/1",
        durability: "complete",
        missingExpected: 0,
        coverage: "complete"
      },
      assessment: projectedAssessment(),
      providerCapabilityLimitations: available([
        { capability: "source_timestamps", availability: "unavailable" },
        { capability: "tool_output", availability: "partial" }
      ], "recorder")
    },
    warningCodes: [],
    contradictionCodes: [],
    ...overrides
  };
  return value;
}

function page(items: readonly RunListItemV1[], nextCursor: string | null = null): RunPageV1 {
  return { schemaVersion: 1, items: [...items], nextCursor };
}

function clientWithList(listRuns: AgentLensApiClient["listRuns"]): AgentLensApiClient {
  return {
    listRuns,
    getRun: vi.fn(),
    getEvents: vi.fn(),
    getEvent: vi.fn()
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderApp(
  client: AgentLensApiClient | null,
  initialEntry = "/runs"
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  });
  return render(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={[initialEntry]}
    >
      <QueryClientProvider client={queryClient}>
        <App client={client} />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("production run ledger", () => {
  it("renders exhaustive lifecycle wrappers and keeps every evidence dimension honest", async () => {
    const explicit = {
      schemaVersion: 1 as const,
      state: "explicit" as const,
      verdict: "partial" as const,
      taskCompleted: "uncertain" as const,
      note: { state: "available" as const },
      provenance: "human" as const,
      currentEventId: "assessment-event",
      reviewedAt: 10,
      updatedAt: 11
    };
    const items = [
      run("starting", { state: "known", value: "starting" }),
      run("running", { state: "known", value: "running" }),
      run("completed", { state: "known", value: "completed" }, {
        label: null,
        finalGitEvidence: { state: "available", headChanged: true, branchChanged: true },
        warningCodes: ["git_head_changed", "git_branch_changed"],
        contradictionCodes: ["provider_process_contradiction"]
      }),
      run("failed", { state: "known", value: "failed" }, {
        summary: {
          ...run("nested", { state: "known", value: "failed" }).summary,
          assessment: explicit
        }
      }),
      run("interrupted", { state: "known", value: "interrupted" }),
      run("recorder", { state: "known", value: "recorder_error" }, {
        warningCodes: ["recorder_failure"]
      }),
      run("future", { state: "unsupported", safeToken: "future_status" }, {
        capturePolicy: "metadata-only",
        summary: {
          ...run("capture", { state: "known", value: "completed" }).summary,
          trackedFinalDiff: unavailable("capture_policy"),
          untrackedFiles: unavailable("capture_policy"),
          likelyTests: {
            state: "unavailable_due_to_capture_policy",
            availability: "unavailable",
            provenance: null,
            supportingEventIds: [],
            supportingArtifactIds: [],
            omittedTerminalCommands: 2
          }
        },
        finalGitEvidence: { state: "unavailable", reason: "not_captured" }
      })
    ];
    const listRuns = vi.fn(async () => page(items));
    renderApp(clientWithList(listRuns));

    expect(await screen.findByText("Unlabeled run")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Run ledger" })).toBeVisible();
    for (const label of [
      "Starting", "Running", "Completed", "Failed", "Interrupted", "Recorder error"
    ]) expect(screen.getByText(label, { selector: ".status-badge__label" })).toBeVisible();
    expect(screen.getByText("Unsupported status: future_status")).toBeVisible();
    expect(screen.getByText("Compatibility warning")).toBeVisible();
    expect(screen.getAllByText("Latest likely test: passed · 1 previous failure").length).toBeGreaterThan(0);
    expect(screen.getByText("Reviewer: partial")).toBeVisible();
    expect(screen.getAllByText("Not reviewed · projected state · no human evidence").length)
      .toBeGreaterThan(0);
    expect(screen.getAllByText("Final Git evidence: tracked diff available · 3 untracked entries").length)
      .toBeGreaterThan(0);
    expect(screen.getByText("Likely tests: unavailable due to capture policy")).toBeVisible();
    expect(screen.getByText("Final Git evidence: not captured")).toBeVisible();
    expect(screen.getByText("HEAD changed")).toBeVisible();
    expect(screen.getByText("Branch changed")).toBeVisible();
    expect(screen.getByText("Contradiction: provider process contradiction")).toBeVisible();
    expect(screen.getByText("Warning: recorder failure")).toBeVisible();
    expect(screen.getAllByText(/Provider limitations:/).length).toBeGreaterThan(0);

    const rendered = document.body.textContent?.toLowerCase() ?? "";
    expect(rendered).not.toContain("tests passed");
    expect(rendered).not.toContain("run successful");
    expect(rendered).not.toContain("agent changes");
    expect(rendered).not.toContain("0 file reads");
  });

  it("keeps status, repository, assessment, and cursor filters URL-addressable and server-side", async () => {
    const user = userEvent.setup();
    const listRuns = vi.fn(async () => page([], "next-cursor"));
    renderApp(
      clientWithList(listRuns),
      "/runs?limit=25&cursor=stale&status=failed&repository=repo-old&assessment=partial"
    );

    expect(await screen.findByLabelText("Run status")).toHaveValue("failed");
    expect(screen.getByLabelText("Repository fingerprint")).toHaveValue("repo-old");
    expect(screen.getByLabelText("Assessment")).toHaveValue("partial");
    expect(listRuns).toHaveBeenLastCalledWith({
      limit: 25,
      cursor: "stale",
      status: "failed",
      repository: "repo-old",
      assessment: "partial"
    }, expect.any(AbortSignal));

    await user.selectOptions(screen.getByLabelText("Run status"), "interrupted");
    await user.clear(screen.getByLabelText("Repository fingerprint"));
    await user.type(screen.getByLabelText("Repository fingerprint"), "repo/new");
    await user.selectOptions(screen.getByLabelText("Assessment"), "projected");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/runs?limit=25&status=interrupted&repository=repo%2Fnew&assessment=projected"
    );
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({
      limit: 25,
      status: "interrupted",
      repository: "repo/new",
      assessment: "projected"
    }, expect.any(AbortSignal)));
    expect(screen.queryByTestId("location")).not.toHaveTextContent("cursor=");
  });

  it("shows explicit loading, empty, API error, and authentication-expired states", async () => {
    const never = new Promise<RunPageV1>(() => undefined);
    const loading = clientWithList(vi.fn(async () => never));
    const first = renderApp(loading);
    expect(screen.getByText("Loading run evidence…")).toBeVisible();
    first.unmount();

    const empty = clientWithList(vi.fn(async () => page([])));
    const second = renderApp(empty);
    expect(await screen.findByText("No runs recorded")).toBeVisible();
    expect(screen.getByText("agentlens record -- codex exec --json ...")).toBeVisible();
    second.unmount();

    const failed = clientWithList(vi.fn(async () => {
      throw new AgentLensClientError({
        code: "internal_error",
        status: 500,
        retryable: false,
        message: "AgentLens could not load run evidence."
      });
    }));
    const third = renderApp(failed);
    expect(await screen.findByText("Run evidence unavailable")).toBeVisible();
    expect(screen.getByText("AgentLens could not load run evidence.")).toBeVisible();
    third.unmount();

    const listRuns = vi.fn();
    renderApp(clientWithList(listRuns), "/runs").unmount();
    listRuns.mockClear();
    renderApp(null);
    expect(screen.getByText("Authentication expired")).toBeVisible();
    expect(screen.getByText("Restart AgentLens UI to reconnect.")).toBeVisible();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it("renders every row as a semantic destination with independent evidence labels", async () => {
    const user = userEvent.setup();
    const item = run("semantic-run", { state: "known", value: "completed" });
    renderApp(clientWithList(vi.fn(async () => page([item]))));
    const link = await screen.findByRole("link", { name: /Run semantic-run/ });
    expect(link).toHaveAttribute("href", "/runs/semantic-run");
    expect(link.closest("li")).not.toBeNull();
    expect(screen.getByText("Lifecycle")).toBeVisible();
    expect(screen.getByText("Likely tests")).toBeVisible();
    expect(screen.getByText("Human review")).toBeVisible();
    expect(screen.getByText("Git")).toBeVisible();

    await user.click(link);
    expect(screen.getByRole("heading", { name: "Run detail" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Return to the run ledger" }));
    expect(await screen.findByRole("heading", { name: "Run ledger" })).toBeVisible();
  });
});
