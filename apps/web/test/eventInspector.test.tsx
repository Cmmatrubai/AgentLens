import type {
  EventDetailV1,
  NormalizedContentResponseV1,
  TrajectoryEventV1
} from "@agentlens/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentLensApiClient } from "../src/api/client.js";
import { ApiClientProvider } from "../src/api/queries.js";
import { AvailabilityNotice } from "../src/evidence/AvailabilityNotice.js";
import { CommandEvidence } from "../src/evidence/CommandEvidence.js";
import { GitEvidenceSummary } from "../src/evidence/GitEvidenceSummary.js";
import { EventInspector } from "../src/run-detail/EventInspector.js";
import { RunWorkspace } from "../src/run-detail/RunWorkspace.js";

const source = {
  opaqueRef: `src_${"a".repeat(64)}`,
  provider: { state: "known" as const, value: "codex-exec" as const },
  hasSessionOrThread: true,
  hasTurn: true,
  hasItemOrTool: true,
  hasCorrelation: false
};

function event(overrides: Partial<TrajectoryEventV1> = {}): TrajectoryEventV1 {
  return {
    schemaVersion: 1,
    eventId: "event-command",
    runId: "run-inspector",
    sequence: 7,
    receivedAt: "2026-08-31T16:00:00.000Z",
    sourceOccurredAt: { state: "unavailable", reason: "not_captured" },
    kind: "command.completed",
    status: { state: "known", value: "failed" },
    provenance: "observed",
    presentationClass: "command",
    safeSummary: "Command failed with redacted output",
    source,
    relationships: [
      { type: "derived_from", eventId: "event-source" },
      { type: "recovers", eventId: "event-recovery" },
      { type: "correlates_with", eventId: "event-test" }
    ],
    derivation: null,
    nativePayload: { state: "available", storage: "artifact" },
    lifecycleGroupKey: null,
    lifecycle: null,
    detail: { state: "available" },
    ...overrides
  };
}

function commandDetail(overrides: Partial<EventDetailV1> = {}): EventDetailV1 {
  return {
    schemaVersion: 1,
    eventId: "event-command",
    runId: "run-inspector",
    sequence: 7,
    kind: "command.completed",
    status: { state: "known", value: "failed" },
    provenance: "observed",
    relationships: [
      { type: "derived_from", eventId: "event-source" },
      { type: "recovers", eventId: "event-recovery" },
      { type: "correlates_with", eventId: "event-test" }
    ],
    presentationClass: "command",
    lifecycle: "failed",
    exitCode: 2,
    output: { state: "available" },
    content: { state: "available" },
    ...overrides
  } as EventDetailV1;
}

function client(overrides: Partial<AgentLensApiClient> = {}): AgentLensApiClient {
  return {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    getEvents: vi.fn(),
    getEvent: vi.fn(async () => commandDetail()),
    getEventContent: vi.fn(async () => ({
      schemaVersion: 1,
      eventId: "event-command",
      content: {
        kind: "command_evidence",
        command: { state: "available", text: "pnpm test", truncated: false },
        output: { state: "available", text: "redacted output\nsecond line", truncated: false }
      }
    } satisfies NormalizedContentResponseV1)),
    getEventNative: vi.fn(async () => ({
      schemaVersion: 1,
      eventId: "event-command",
      content: { format: "json", text: "{\"source\":\"[[AGENTLENS_RESPONSE_REDACTED:ITEM_ID]]\"}", truncated: false }
    })),
    getAssessmentNote: vi.fn(),
    getGitDiff: vi.fn(),
    getGitStatus: vi.fn(),
    getGitDiffCheck: vi.fn(),
    getGitUntracked: vi.fn(),
    ...overrides
  } as AgentLensApiClient;
}

function Providers(props: Readonly<{ client: AgentLensApiClient; children: ReactNode }>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={props.client}>{props.children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded event inspector", () => {
  it("fetches only event detail on selection and waits for an explicit content request", async () => {
    const api = client();
    render(
      <Providers client={api}>
        <EventInspector event={event()} runId="run-inspector" onRelationshipJump={vi.fn()} />
      </Providers>
    );

    await screen.findByText("Command lifecycle");
    expect(api.getEvent).toHaveBeenCalledOnce();
    expect(api.getEventContent).not.toHaveBeenCalled();
    expect(api.getEventNative).not.toHaveBeenCalled();
    expect(api.getAssessmentNote).not.toHaveBeenCalled();
    expect(api.getGitDiff).not.toHaveBeenCalled();
    expect(api.getGitStatus).not.toHaveBeenCalled();
    expect(api.getGitDiffCheck).not.toHaveBeenCalled();
    expect(api.getGitUntracked).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Load command evidence" }));
    await waitFor(() => expect(screen.getByText(/redacted output\s+second line/)).toBeVisible());
    expect(api.getEventContent).toHaveBeenCalledWith(
      "run-inspector",
      "event-command",
      expect.any(AbortSignal)
    );
  });

  it("gates redacted provider payload to eligible observed events and loads it from its exact tab action", async () => {
    const api = client();
    const { rerender } = render(
      <Providers client={api}>
        <EventInspector event={event()} runId="run-inspector" onRelationshipJump={vi.fn()} />
      </Providers>
    );

    const providerTab = await screen.findByRole("tab", { name: "Redacted provider payload" });
    expect(api.getEventNative).not.toHaveBeenCalled();
    await userEvent.click(providerTab);
    expect(await screen.findByText(/AGENTLENS_RESPONSE_REDACTED/)).toBeInTheDocument();
    expect(api.getEventNative).toHaveBeenCalledOnce();

    const ineligible = [
      event({ provenance: "derived" }),
      event({ provenance: "git_recovered" }),
      event({ provenance: "recorder" }),
      event({ provenance: "human" })
    ];
    for (const value of ineligible) {
      rerender(
        <Providers client={client()}>
          <EventInspector event={value} runId="run-inspector" onRelationshipJump={vi.fn()} />
        </Providers>
      );
      expect(screen.queryByRole("tab", { name: "Redacted provider payload" })).not.toBeInTheDocument();
    }
  });

  it("renders exact relationship types and IDs as labeled jump controls without native identities", async () => {
    const onJump = vi.fn();
    render(
      <Providers client={client()}>
        <EventInspector event={event()} runId="run-inspector" onRelationshipJump={onJump} />
      </Providers>
    );
    await screen.findByText("Command lifecycle");
    await userEvent.click(screen.getByRole("tab", { name: "Relationships" }));

    const panel = screen.getByRole("tabpanel", { name: "Relationships" });
    expect(within(panel).getByText(source.opaqueRef)).toBeInTheDocument();
    for (const [type, id] of [
      ["derived from", "event-source"],
      ["recovers", "event-recovery"],
      ["correlates with", "event-test"]
    ]) {
      const jump = within(panel).getByRole("button", { name: `Jump to ${type} event ${id}` });
      await userEvent.click(jump);
      expect(onJump).toHaveBeenLastCalledWith(id);
    }
    expect(panel.textContent).not.toContain("sessionId");
    expect(panel.textContent).not.toContain("toolId");
  });

  it.each([
    ["available", "Evidence available"],
    ["capture_policy", "Omitted by capture policy"],
    ["provider_capability", "Provider capability unavailable"],
    ["not_captured", "Not captured"],
    ["not_yet_available", "Not yet available"],
    ["artifact_omitted", "Artifact omitted"],
    ["truncated", "Evidence truncated at the response bound"],
    ["corrupt", "Evidence corrupt or binding-invalid"],
    ["artifact_unreadable", "Artifact unreadable"],
    ["unsupported_kind", "Unsupported event kind"],
    ["unknown", "Unsupported future evidence state"]
  ] as const)("renders a nonblank %s state", (reason, expected) => {
    render(<AvailabilityNotice state={reason} />);
    expect(screen.getByText(expected)).toBeVisible();
    expect(document.body.textContent?.trim()).not.toBe("");
    expect(document.body.textContent).not.toBe("0");
  });

  it("presents command facts and already-redacted output as bounded selectable text, never a terminal", () => {
    render(
      <CommandEvidence
        detail={commandDetail() as Extract<EventDetailV1, { presentationClass: "command" }>}
        content={{
          schemaVersion: 1,
          eventId: "event-command",
          content: {
            kind: "command_evidence",
            command: { state: "available", text: "pnpm test", truncated: false },
            output: { state: "available", text: "redacted output", truncated: true }
          }
        }}
        requestState="loaded"
        onRequestContent={vi.fn()}
      />
    );
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("pnpm test")).toBeVisible();
    const output = screen.getByText("redacted output");
    expect(output).toHaveClass("evidence-text__content");
    expect(output.closest("[data-terminal-emulator]")).toBeNull();
    expect(screen.getByText("Evidence truncated at the response bound")).toBeVisible();
  });

  it("renders retained command-only evidence and maps unreadable failures without blanket corruption", () => {
    const { rerender } = render(
      <CommandEvidence
        detail={commandDetail({ output: { state: "unavailable", reason: "not_captured" } }) as Extract<EventDetailV1, { presentationClass: "command" }>}
        content={{
          schemaVersion: 1,
          eventId: "event-command",
          content: {
            kind: "command_evidence",
            command: { state: "available", text: "pnpm test", truncated: false },
            output: { state: "unavailable", reason: "not_captured" }
          }
        }}
        requestState="loaded"
        onRequestContent={vi.fn()}
      />
    );
    expect(screen.getByText("pnpm test")).toBeVisible();
    expect(screen.getByText("Not captured")).toBeVisible();

    rerender(
      <CommandEvidence
        detail={commandDetail() as Extract<EventDetailV1, { presentationClass: "command" }>}
        content={null}
        requestState="error"
        requestError="artifact_unreadable"
        onRequestContent={vi.fn()}
      />
    );
    expect(screen.getByText("Artifact unreadable")).toBeVisible();
    expect(screen.queryByText("Evidence corrupt or binding-invalid")).not.toBeInTheDocument();
  });

  it("places the narrow inspector inside the selected virtual row", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(max-width: 800px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));
    render(
      <Providers client={client()}>
        <RunWorkspace
          runId="run-inspector"
          run={{
            finalGitEvidence: { state: "unavailable", reason: "not_captured" },
            summary: {
              trackedFinalDiff: {
                state: "unavailable", reason: "not_captured", origin: null,
                supportingEventIds: [], supportingArtifactIds: []
              },
              untrackedFiles: {
                state: "unavailable", reason: "not_captured", origin: null,
                supportingEventIds: [], supportingArtifactIds: []
              }
            }
          } as never}
          events={[event()]}
          selectedEventId="event-command"
          selectionState="idle"
          onSelect={vi.fn()}
        />
      </Providers>
    );

    await screen.findByText("Command lifecycle");
    const selectedRow = screen.getByRole("option", { selected: true });
    await waitFor(() => expect(selectedRow.parentElement)
      .toContainElement(screen.getByTestId("inline-event-inspector")));
  });

  it("restores the focused inspector control when responsive placement changes", async () => {
    let narrow = false;
    let onChange: (() => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return narrow; },
      media: "(max-width: 800px)",
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: () => void) => { onChange = listener; }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));
    render(
      <Providers client={client()}>
        <RunWorkspace
          runId="run-inspector"
          run={{
            finalGitEvidence: { state: "unavailable", reason: "not_captured" },
            summary: {
              trackedFinalDiff: {
                state: "unavailable", reason: "not_captured", origin: null,
                supportingEventIds: [], supportingArtifactIds: []
              },
              untrackedFiles: {
                state: "unavailable", reason: "not_captured", origin: null,
                supportingEventIds: [], supportingArtifactIds: []
              }
            }
          } as never}
          events={[event()]}
          selectedEventId="event-command"
          selectionState="idle"
          onSelect={vi.fn()}
        />
      </Providers>
    );

    const relationships = await screen.findByRole("tab", { name: "Relationships" });
    await userEvent.click(relationships);
    expect(relationships).toHaveFocus();
    narrow = true;
    act(() => onChange?.());

    await screen.findByTestId("inline-event-inspector");
    expect(screen.getByRole("tab", { name: "Relationships" })).toHaveFocus();
  });

  it("never carries explicit event evidence actions across a rapid identity switch", async () => {
    const pending = new Promise<NormalizedContentResponseV1>(() => undefined);
    const api = client({ getEventContent: vi.fn(() => pending) });
    const { rerender } = render(
      <Providers client={api}>
        <EventInspector event={event({ eventId: "event-1" })} runId="run-1" onRelationshipJump={vi.fn()} />
      </Providers>
    );
    await screen.findByText("Command lifecycle");
    await userEvent.click(screen.getByRole("button", { name: "Load command evidence" }));
    expect(api.getEventContent).toHaveBeenCalledWith("run-1", "event-1", expect.any(AbortSignal));

    rerender(
      <Providers client={api}>
        <EventInspector event={event({ eventId: "event-2", runId: "run-2" })} runId="run-2" onRelationshipJump={vi.fn()} />
      </Providers>
    );
    rerender(
      <Providers client={api}>
        <EventInspector event={event({ eventId: "event-3", runId: "run-3" })} runId="run-3" onRelationshipJump={vi.fn()} />
      </Providers>
    );
    await screen.findByRole("button", { name: "Load command evidence" });
    expect(api.getEventContent).toHaveBeenCalledTimes(1);
  });

  it("does not carry provider or assessment-note requests to a new event identity", async () => {
    const assessment = event({
      eventId: "note-a",
      runId: "run-a",
      presentationClass: "assessment",
      kind: "assessment.created",
      nativePayload: { state: "available", storage: "inline" }
    });
    const detail = {
      ...commandDetail(),
      eventId: "note-a",
      runId: "run-a",
      kind: "assessment.created",
      presentationClass: "assessment",
      revision: "note-a",
      verdict: "partial",
      taskCompleted: "uncertain",
      note: { state: "available" },
      content: { state: "available" }
    } as EventDetailV1;
    const api = client({
      getEvent: vi.fn(async () => detail),
      getAssessmentNote: vi.fn(async (_runId, eventId) => ({ schemaVersion: 1, eventId, content: "redacted note" }))
    });
    const { rerender } = render(
      <Providers client={api}>
        <EventInspector event={assessment} runId="run-a" onRelationshipJump={vi.fn()} />
      </Providers>
    );
    await userEvent.click(await screen.findByRole("button", { name: "Load assessment note" }));
    await userEvent.click(screen.getByRole("tab", { name: "Redacted provider payload" }));

    rerender(
      <Providers client={api}>
        <EventInspector
          event={{ ...assessment, eventId: "note-b", runId: "run-b" }}
          runId="run-b"
          onRelationshipJump={vi.fn()}
        />
      </Providers>
    );
    await screen.findByRole("button", { name: "Load assessment note" });
    expect(api.getAssessmentNote).toHaveBeenCalledTimes(1);
    expect(api.getEventNative).toHaveBeenCalledTimes(1);
  });

  it("never carries any explicit Final Git evidence action to a new run", async () => {
    const api = client({
      getGitStatus: vi.fn(async (_runId, phase) => ({ schemaVersion: 1, kind: "status", phase, entries: [] })),
      getGitUntracked: vi.fn(async () => ({ schemaVersion: 1, kind: "untracked", entries: [] })),
      getGitDiffCheck: vi.fn(async () => ({ schemaVersion: 1, kind: "diff_check", passed: true, output: "" })),
      getGitDiff: vi.fn(async () => ({ schemaVersion: 1, kind: "diff", files: [], preamble: [], truncated: false, malformed: false }))
    });
    const workspace = (runId: string) => (
      <Providers client={api}>
        <RunWorkspace
          runId={runId}
          run={{
            gitState: { state: "unavailable", reason: "not_captured" },
            finalGitEvidence: { state: "unavailable", reason: "not_captured" },
            summary: {
              trackedFinalDiff: { state: "unavailable", reason: "not_captured", origin: null, supportingEventIds: [], supportingArtifactIds: [] },
              untrackedFiles: { state: "unavailable", reason: "not_captured", origin: null, supportingEventIds: [], supportingArtifactIds: [] }
            }
          } as never}
          events={[event({ runId })]}
          selectedEventId="event-command"
          selectionState="idle"
          onSelect={vi.fn()}
        />
      </Providers>
    );
    const { rerender } = render(workspace("run-a"));
    for (const name of [
      "Load initial Git status", "Load final Git status", "Load untracked-file metadata",
      "Load git diff --check", "Open tracked final diff"
    ]) await userEvent.click(await screen.findByRole("button", { name }));
    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(1));

    rerender(workspace("run-b"));
    await screen.findByRole("button", { name: "Open tracked final diff" });
    expect(api.getGitStatus).toHaveBeenCalledTimes(2);
    expect(api.getGitUntracked).toHaveBeenCalledTimes(1);
    expect(api.getGitDiffCheck).toHaveBeenCalledTimes(1);
    expect(api.getGitDiff).toHaveBeenCalledTimes(1);
  });

  it("renders actual bounded Git refs, detached branches, and change warnings", () => {
    render(
      <Providers client={client()}>
        <GitEvidenceSummary
          runId="run-git"
          run={{
            gitState: {
              state: "available",
              initialHead: "a".repeat(40), finalHead: "b".repeat(40),
              initialBranch: { state: "attached", value: "main" },
              finalBranch: { state: "detached" }
            },
            finalGitEvidence: { state: "available", headChanged: true, branchChanged: true },
            summary: {
              trackedFinalDiff: { state: "available", value: "artifact" },
              untrackedFiles: { state: "available", value: 3 }
            }
          } as never}
          onOpenDiff={vi.fn()}
        />
      </Providers>
    );
    expect(screen.getByText("a".repeat(40))).toBeVisible();
    expect(screen.getByText("b".repeat(40))).toBeVisible();
    expect(screen.getByText("main")).toBeVisible();
    expect(screen.getByText("Detached HEAD")).toBeVisible();
    expect(screen.getAllByText("Changed")).toHaveLength(2);
  });

  it("preserves expanded diff state, focus, and one request across the 800px placement boundary", async () => {
    let narrow = false;
    let onChange: (() => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return narrow; },
      media: "(max-width: 800px)", onchange: null,
      addEventListener: vi.fn((_type: string, listener: () => void) => { onChange = listener; }),
      removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn()
    })));
    const api = client({
      getGitDiff: vi.fn(async () => ({
        schemaVersion: 1, kind: "diff", preamble: [], truncated: false, malformed: false,
        files: [{
          oldPath: "src/a.ts", newPath: "src/a.ts", headers: [], metadata: [],
          hunks: [{
            header: "@@ -1 +1 @@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
            lines: [{ type: "context", oldLineNumber: 1, newLineNumber: 1, text: "safe" }]
          }]
        }]
      }))
    });
    render(
      <Providers client={api}>
        <RunWorkspace
          runId="run-responsive"
          run={{
            gitState: { state: "unavailable", reason: "not_captured" },
            finalGitEvidence: { state: "unavailable", reason: "not_captured" },
            summary: {
              trackedFinalDiff: { state: "available", value: "artifact" },
              untrackedFiles: { state: "available", value: 0 }
            }
          } as never}
          events={[event({ runId: "run-responsive" })]}
          selectedEventId="event-command"
          selectionState="idle"
          onSelect={vi.fn()}
        />
      </Providers>
    );
    await userEvent.click(await screen.findByRole("button", { name: "Open tracked final diff" }));
    const expand = await screen.findByRole("button", { name: "Expand diff for src/a.ts" });
    await userEvent.click(expand);
    const collapse = screen.getByRole("button", { name: "Collapse diff for src/a.ts" });
    expect(collapse).toHaveFocus();

    narrow = true;
    act(() => onChange?.());
    await screen.findByTestId("inline-event-inspector");
    expect(screen.getByRole("button", { name: "Collapse diff for src/a.ts" })).toHaveFocus();
    expect(api.getGitDiff).toHaveBeenCalledTimes(1);
  });
});
