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
      content: { kind: "command_output", output: "redacted output\nsecond line" }
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

    await userEvent.click(screen.getByRole("button", { name: "Load command output" }));
    await waitFor(() => expect(document.querySelector(".evidence-text__content"))
      .toHaveTextContent("redacted output second line"));
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
          content: { kind: "command_output", output: "redacted output" }
        }}
        requestState="loaded"
        onRequestContent={vi.fn()}
      />
    );
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    const output = screen.getByText("redacted output");
    expect(output).toHaveClass("evidence-text__content");
    expect(output.closest("[data-terminal-emulator]")).toBeNull();
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
});
