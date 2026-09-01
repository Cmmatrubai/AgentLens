import type {
  AssessmentResponseV1,
  CurrentAssessmentV1,
  EventDetailV1,
  RunDetailV1,
  TrajectoryEventV1
} from "@agentlens/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AgentLensClientError,
  createAgentLensApiClient,
  type AgentLensApiClient
} from "../src/api/client.js";
import { ApiClientProvider } from "../src/api/queries.js";
import { EventInspector } from "../src/run-detail/EventInspector.js";
import { RunHeader } from "../src/run-detail/RunHeader.js";

type AssessmentMutation = Readonly<{
  runId: string;
  etag: string;
  draft: Readonly<{
    verdict: "unreviewed" | "success" | "partial" | "failure";
    taskCompleted: "yes" | "no" | "uncertain";
    note: string;
  }>;
}>;

type AssessmentClient = AgentLensApiClient & Readonly<{
  updateAssessment(input: AssessmentMutation): Promise<AssessmentResponseV1>;
}>;

const projected: CurrentAssessmentV1 = {
  schemaVersion: 1,
  state: "projected",
  verdict: "unreviewed",
  taskCompleted: "uncertain",
  note: { state: "absent" },
  provenance: null,
  currentEventId: null,
  reviewedAt: null,
  updatedAt: null
};

function explicit(
  verdict: "unreviewed" | "success" | "partial" | "failure" = "partial",
  taskCompleted: "yes" | "no" | "uncertain" = "uncertain",
  eventId = "assessment-current"
): Extract<CurrentAssessmentV1, { state: "explicit" }> {
  return {
    schemaVersion: 1,
    state: "explicit",
    verdict,
    taskCompleted,
    note: { state: "available" },
    provenance: "human",
    currentEventId: eventId,
    reviewedAt: Date.parse("2026-08-31T18:10:00.000Z"),
    updatedAt: Date.parse("2026-08-31T18:10:00.000Z")
  };
}

function run(assessment: CurrentAssessmentV1 = projected): RunDetailV1 {
  return {
    schemaVersion: 1,
    runId: "run-assessment",
    status: { state: "known", value: "completed" },
    provider: { state: "known", value: "codex-exec" },
    label: "Assessment run",
    capturePolicy: "standard",
    repository: { fingerprint: "repo-fingerprint", display: "agentlens" },
    startedAt: Date.parse("2026-08-31T18:00:00.000Z"),
    endedAt: Date.parse("2026-08-31T18:09:00.000Z"),
    ownership: { storedCondition: "released", diagnosis: "released" },
    finalGitEvidence: { state: "available", headChanged: false, branchChanged: false },
    summary: {
      terminalCommands: { state: "available", value: 2, provenance: "observed", supportingEventIds: [], supportingArtifactIds: [] },
      failedTerminalCommands: { state: "available", value: 0, provenance: "observed", supportingEventIds: [], supportingArtifactIds: [] },
      nativeFileChanges: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      trackedFinalDiff: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      untrackedFiles: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      elapsedRecorderTimeMs: { state: "available", value: 540_000, provenance: "recorder", supportingEventIds: [], supportingArtifactIds: [] },
      observedTokenUsage: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      likelyTests: {
        state: "detected",
        availability: "available",
        provenance: "derived",
        supportingEventIds: ["test-latest"],
        supportingArtifactIds: [],
        omittedTerminalCommands: 0,
        attempts: { total: 1, passed: 1, failed: 0, unknown: 0, latest: "passed", previousFailures: 0 },
        sourceEventIds: ["command-latest"],
        derivedEventIds: ["test-latest"],
        derivationId: "test-command/1",
        durability: "complete",
        missingExpected: 0,
        coverage: "complete"
      },
      assessment,
      providerCapabilityLimitations: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] }
    },
    gitState: { state: "unavailable", reason: "not_captured" },
    eventCount: 3,
    anchors: {
      firstFailure: null,
      recorderRecovery: null,
      latestLikelyTest: { eventId: "test-latest", sequence: 3 },
      finalGitEvidence: null,
      latestEvent: { eventId: "test-latest", sequence: 3 }
    },
    warningCodes: [],
    contradictionCodes: []
  };
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    ...init
  });
}

function client(updateAssessment: AssessmentClient["updateAssessment"]): AssessmentClient {
  return {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    getEvents: vi.fn(),
    getEvent: vi.fn(),
    getEventContent: vi.fn(),
    getEventNative: vi.fn(),
    getAssessmentNote: vi.fn(),
    getGitDiff: vi.fn(),
    getGitStatus: vi.fn(),
    getGitDiffCheck: vi.fn(),
    getGitUntracked: vi.fn(),
    updateAssessment
  } as AssessmentClient;
}

function Providers(props: Readonly<{
  api: AgentLensApiClient;
  queryClient?: QueryClient;
  children: ReactNode;
}>) {
  const queryClient = props.queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={props.api}>{props.children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

function renderWorkflow(input: Readonly<{
  assessment?: CurrentAssessmentV1;
  updateAssessment: AssessmentClient["updateAssessment"];
  queryClient?: QueryClient;
  onAssessmentSaved?: (eventId: string) => void;
}>) {
  const currentRun = run(input.assessment);
  const queryClient = input.queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  queryClient.setQueryData(["run", currentRun.runId], currentRun);
  const api = client(input.updateAssessment);
  const onAssessmentSaved = input.onAssessmentSaved ?? vi.fn();
  render(
    <Providers api={api} queryClient={queryClient}>
      <RunHeader run={currentRun} onAssessmentSaved={onAssessmentSaved} />
    </Providers>
  );
  return { api, currentRun, onAssessmentSaved, queryClient };
}

describe("human assessment provenance and form", () => {
  it("keeps the projected default visibly non-human and opens a semantic compact form", async () => {
    const updateAssessment = vi.fn();
    const onAssessmentSaved = vi.fn();
    renderWorkflow({ updateAssessment, onAssessmentSaved });

    expect(screen.getByText("Not reviewed · projected state · no human evidence")).toBeVisible();
    expect(screen.queryByText(/reviewed at/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Human assessment updated")).not.toBeInTheDocument();
    expect(updateAssessment).not.toHaveBeenCalled();
    expect(onAssessmentSaved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    const form = screen.getByRole("form", { name: "Human assessment" });
    expect(within(form).getByRole("group", { name: "Reviewer verdict" })).toBeVisible();
    expect(within(form).getAllByRole("radio", { name: /Not reviewed|Success|Partial|Failure/ })).toHaveLength(4);
    const completionGroup = within(form).getByRole("group", { name: "Task completed" });
    expect(completionGroup).toBeVisible();
    expect(within(completionGroup).getAllByRole("radio")).toHaveLength(3);
    expect(within(form).getByRole("textbox", { name: "Reviewer note (optional)" })).toHaveAttribute("maxlength", "16384");
    expect(within(form).getByRole("button", { name: "Save assessment" })).toBeVisible();
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Human assessment" })).not.toBeInTheDocument();
  });

  it.each([
    ["unreviewed", "uncertain"],
    ["success", "yes"],
    ["partial", "uncertain"],
    ["failure", "no"]
  ] as const)("renders explicit %s as timestamped human evidence without changing likely-test evidence", (verdict, completion) => {
    render(<RunHeader run={run(explicit(verdict, completion))} />);

    expect(screen.getByText(`Reviewer: ${verdict} · human evidence`)).toBeVisible();
    expect(screen.getByText("Latest likely test: passed · 0 previous failures")).toBeVisible();
    expect(screen.getByText("2026-08-31T18:10:00.000Z")).toHaveAttribute(
      "datetime",
      "2026-08-31T18:10:00.000Z"
    );
    expect(screen.queryByText("projected state", { exact: false })).not.toBeInTheDocument();
  });

  it("blocks invalid unreviewed completion and a note above 16 KiB UTF-8 before the server", async () => {
    const updateAssessment = vi.fn();
    renderWorkflow({ updateAssessment });
    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer note (optional)" }), {
      target: { value: "😀".repeat(4_097) }
    });
    await userEvent.click(screen.getByRole("button", { name: "Save assessment" }));

    expect(screen.getByText("Not reviewed requires task completion to be Uncertain.")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Note must be 16 KiB or less in UTF-8.")).toHaveAttribute("role", "alert");
    expect(updateAssessment).not.toHaveBeenCalled();
  });

  it("accepts exactly 16 KiB of UTF-8 note bytes", async () => {
    const updateAssessment = vi.fn(async () => ({
      schemaVersion: 1,
      assessment: explicit("success", "yes", "assessment-byte-boundary"),
      etag: '"assessment:YXNzZXNzbWVudC1ieXRlLWJvdW5kYXJ5"'
    } satisfies AssessmentResponseV1));
    renderWorkflow({ updateAssessment });
    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    await userEvent.click(screen.getByRole("radio", { name: "Success" }));
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    const boundary = "😀".repeat(4_096);
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer note (optional)" }), {
      target: { value: boundary }
    });
    await userEvent.click(screen.getByRole("button", { name: "Save assessment" }));

    await waitFor(() => expect(updateAssessment).toHaveBeenCalledWith({
      runId: "run-assessment",
      etag: '"assessment:projected"',
      draft: { verdict: "success", taskCompleted: "yes", note: boundary }
    }));
    expect(screen.queryByText("Note must be 16 KiB or less in UTF-8.")).not.toBeInTheDocument();
  });
});

describe("conditional assessment transport and mutation ownership", () => {
  it("sends one full replacement through the closure-only client with the current If-Match", async () => {
    const response = {
      schemaVersion: 1,
      assessment: explicit("partial", "uncertain", "assessment-new"),
      etag: '"assessment:YXNzZXNzbWVudC1uZXc"'
    } satisfies AssessmentResponseV1;
    const fetchImpl = vi.fn(async () => json(response));
    const api = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl
    }) as AssessmentClient;

    await expect(api.updateAssessment({
      runId: "run/id %",
      etag: '"assessment:projected"',
      draft: { verdict: "partial", taskCompleted: "uncertain", note: "redacted reviewer note" }
    })).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:43123/api/v1/runs/run%2Fid%20%25/assessment");
    expect(request).toEqual(expect.objectContaining({
      method: "PUT",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer fixture-bearer",
        "Content-Type": "application/json",
        "If-Match": '"assessment:projected"'
      },
      body: JSON.stringify({
        schemaVersion: 1,
        verdict: "partial",
        taskCompleted: "uncertain",
        note: { state: "text", text: "redacted reviewer note" }
      })
    }));
    expect(JSON.stringify(api)).toBe("{}");
  });

  it.each([
    [{ verdict: "future", taskCompleted: "uncertain", note: "" }, "invalid verdict"],
    [{ verdict: "partial", taskCompleted: "future", note: "" }, "invalid task completion"],
    [{ verdict: "unreviewed", taskCompleted: "yes", note: "" }, "invalid unreviewed completion"],
    [{ verdict: "success", taskCompleted: "yes", note: "😀".repeat(4_097) }, "oversized UTF-8 note"]
  ])("rejects an %s before fetch", async (draft) => {
    const fetchImpl = vi.fn();
    const api = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl
    }) as AssessmentClient;

    await expect(api.updateAssessment({
      runId: "run-assessment",
      etag: '"assessment:projected"',
      draft: draft as AssessmentMutation["draft"]
    })).rejects.toMatchObject({ code: "invalid_client_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("commits returned assessment cache state and selects exactly the returned human event after confirmed success", async () => {
    const confirmed = explicit("failure", "no", "assessment-confirmed");
    const updateAssessment = vi.fn(async () => ({
      schemaVersion: 1,
      assessment: confirmed,
      etag: '"assessment:YXNzZXNzbWVudC1jb25maXJtZWQ"'
    } satisfies AssessmentResponseV1));
    const onAssessmentSaved = vi.fn();
    const { queryClient } = renderWorkflow({ updateAssessment, onAssessmentSaved });

    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    await userEvent.click(screen.getByRole("radio", { name: "Failure" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Save assessment" }));

    await waitFor(() => expect(onAssessmentSaved).toHaveBeenCalledWith("assessment-confirmed"));
    expect(onAssessmentSaved).toHaveBeenCalledOnce();
    expect(updateAssessment).toHaveBeenCalledOnce();
    expect((queryClient.getQueryData(["run", "run-assessment"]) as RunDetailV1).summary.assessment)
      .toEqual(confirmed);
    expect(queryClient.getQueryState(["run", "run-assessment"])?.isInvalidated).toBe(true);
  });

  it("disables duplicate submission while the one mutation is pending", async () => {
    let resolve!: (value: AssessmentResponseV1) => void;
    const pending = new Promise<AssessmentResponseV1>((accept) => { resolve = accept; });
    const updateAssessment = vi.fn(() => pending);
    renderWorkflow({ updateAssessment });

    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    const save = screen.getByRole("button", { name: "Save assessment" });
    await userEvent.click(save);
    expect(screen.getByRole("button", { name: "Saving assessment…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Saving assessment…" }));
    fireEvent.submit(screen.getByRole("form", { name: "Human assessment" }));
    expect(updateAssessment).toHaveBeenCalledOnce();

    resolve({
      schemaVersion: 1,
      assessment: explicit("unreviewed", "uncertain", "assessment-once"),
      etag: '"assessment:YXNzZXNzbWVudC1vbmNl"'
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add human assessment" })).toHaveFocus());
    expect(updateAssessment).toHaveBeenCalledOnce();
  });

  it("keeps a stale draft and cached evidence unchanged until Review latest assessment is chosen", async () => {
    const latest = explicit("success", "yes", "assessment-competing");
    const fetchImpl = vi.fn(async () => json({
      schemaVersion: 1,
      error: {
        code: "assessment_conflict",
        message: "Assessment changed; review the current assessment before retrying.",
        retryable: false
      },
      assessment: latest,
      etag: '"assessment:YXNzZXNzbWVudC1jb21wZXRpbmc"'
    }, { status: 412 }));
    const api = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl
    }) as AssessmentClient;
    const currentRun = run(projected);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(["run", currentRun.runId], currentRun);
    render(
      <Providers api={api} queryClient={queryClient}>
        <RunHeader run={currentRun} onAssessmentSaved={vi.fn()} />
      </Providers>
    );

    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    await userEvent.click(screen.getByRole("radio", { name: "Failure" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Reviewer note (optional)" }), "Keep this stale draft");
    await userEvent.click(screen.getByRole("button", { name: "Save assessment" }));

    expect(await screen.findByText("This assessment changed before your save completed. Your draft has not been applied."))
      .toHaveAttribute("role", "alert");
    expect(screen.getByRole("radio", { name: "Failure" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "No" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Reviewer note (optional)" })).toHaveValue("Keep this stale draft");
    expect((queryClient.getQueryData(["run", "run-assessment"]) as RunDetailV1).summary.assessment)
      .toEqual(projected);
    expect(fetchImpl).toHaveBeenCalledOnce();
    fireEvent.submit(screen.getByRole("form", { name: "Human assessment" }));
    expect(fetchImpl).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Review latest assessment" }));
    expect((queryClient.getQueryData(["run", "run-assessment"]) as RunDetailV1).summary.assessment)
      .toEqual(latest);
    expect(screen.getByRole("radio", { name: "Failure" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Reviewer note (optional)" })).toHaveValue("Keep this stale draft");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports ambiguous network failure without changing evidence or claiming a save", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("socket closed after request bytes"); });
    const api = createAgentLensApiClient({
      origin: "http://127.0.0.1:43123",
      bearerToken: "fixture-bearer",
      fetchImpl
    }) as AssessmentClient;
    const currentRun = run(projected);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(["run", currentRun.runId], currentRun);
    const onAssessmentSaved = vi.fn();
    render(
      <Providers api={api} queryClient={queryClient}>
        <RunHeader run={currentRun} onAssessmentSaved={onAssessmentSaved} />
      </Providers>
    );

    await userEvent.click(screen.getByRole("button", { name: "Add human assessment" }));
    await userEvent.click(screen.getByRole("button", { name: "Save assessment" }));

    expect(await screen.findByText("Save status unknown. Review the latest assessment before trying again."))
      .toHaveAttribute("role", "alert");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onAssessmentSaved).not.toHaveBeenCalled();
    expect((queryClient.getQueryData(["run", "run-assessment"]) as RunDetailV1).summary.assessment)
      .toEqual(projected);
    expect(screen.queryByText("Assessment saved as one human evidence event.")).not.toBeInTheDocument();
  });
});

const assessmentEvent: TrajectoryEventV1 = {
  schemaVersion: 1,
  eventId: "assessment-event-note",
  runId: "run-assessment",
  sequence: 4,
  receivedAt: "2026-08-31T18:10:00.000Z",
  sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
  kind: "assessment.created",
  status: { state: "known", value: "completed" },
  provenance: "human",
  presentationClass: "assessment",
  safeSummary: "Human assessment updated",
  source: {
    opaqueRef: `src_${"a".repeat(64)}`,
    provider: { state: "known", value: "codex-exec" },
    hasSessionOrThread: false,
    hasTurn: false,
    hasItemOrTool: false,
    hasCorrelation: true
  },
  relationships: [],
  derivation: null,
  nativePayload: { state: "unavailable", reason: "not_captured" },
  lifecycleGroupKey: null,
  lifecycle: null,
  detail: { state: "available" }
};

function assessmentDetail(note: "available" | "absent"): EventDetailV1 {
  return {
    schemaVersion: 1,
    eventId: assessmentEvent.eventId,
    runId: assessmentEvent.runId,
    sequence: assessmentEvent.sequence,
    kind: assessmentEvent.kind,
    status: assessmentEvent.status,
    provenance: "human",
    relationships: [],
    presentationClass: "assessment",
    revision: assessmentEvent.eventId,
    verdict: "partial",
    taskCompleted: "uncertain",
    note: { state: note },
    content: { state: "available" }
  };
}

describe("assessment event evidence", () => {
  it.each(["available", "absent"] as const)(
    "shows separate reviewer facts for a note that is %s and fetches bytes only by exact event action",
    async (noteState) => {
      const getAssessmentNote = vi.fn(async () => ({
        schemaVersion: 1,
        eventId: assessmentEvent.eventId,
        content: "Redacted exact event note"
      }));
      const api = client(vi.fn());
      Object.assign(api, {
        getEvent: vi.fn(async () => assessmentDetail(noteState)),
        getAssessmentNote
      });
      render(
        <Providers api={api}>
          <EventInspector event={assessmentEvent} runId="run-assessment" onRelationshipJump={vi.fn()} />
        </Providers>
      );

      expect(await screen.findByText("Reviewer: partial")).toBeVisible();
      expect(screen.getByText("Task completed: uncertain")).toBeVisible();
      if (noteState === "absent") {
        expect(screen.getByText("Reviewer note: absent")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Load assessment note" })).not.toBeInTheDocument();
        expect(getAssessmentNote).not.toHaveBeenCalled();
      } else {
        expect(screen.getByText("Reviewer note: available")).toBeVisible();
        expect(getAssessmentNote).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole("button", { name: "Load assessment note" }));
        expect(await screen.findByText("Redacted exact event note")).toBeVisible();
        expect(getAssessmentNote).toHaveBeenCalledOnce();
        expect(getAssessmentNote).toHaveBeenCalledWith(
          "run-assessment",
          "assessment-event-note",
          expect.any(AbortSignal)
        );
      }
    }
  );

  it("keeps client failures typed rather than deriving conflict behavior from sanitized message text", () => {
    const error = new AgentLensClientError({
      code: "assessment_conflict",
      status: 412,
      retryable: false,
      message: "AgentLens could not complete the request."
    });
    expect(error).toMatchObject({ code: "assessment_conflict", status: 412, retryable: false });
  });
});
