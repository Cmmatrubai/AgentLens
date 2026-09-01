import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Trajectory } from "../src/trajectory/Trajectory.js";
import { RunWorkspace } from "../src/run-detail/RunWorkspace.js";

function events(count: number): TrajectoryEventV1[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return {
      schemaVersion: 1,
      eventId: `event-${sequence}`,
      runId: "run-virtual",
      sequence,
      receivedAt: new Date(Date.UTC(2026, 7, 31, 12, 0, index % 60)).toISOString(),
      sourceOccurredAt: sequence % 2 === 0
        ? { state: "available", value: new Date(Date.UTC(2026, 7, 31, 11, 59, index % 60)).toISOString() }
        : { state: "unavailable", reason: "not_captured" },
      kind: sequence === count ? "future.event" : "message",
      status: sequence % 7 === 0
        ? { state: "unsupported", safeToken: "future_status" }
        : { state: "known", value: sequence % 5 === 0 ? "failed" : "completed" },
      provenance: (["observed", "derived", "git_recovered", "recorder", "human"] as const)[index % 5]!,
      presentationClass: sequence === count ? "unknown" : "message",
      safeSummary: `Safe event ${sequence}`,
      source: {
        opaqueRef: `src_${sequence}`,
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
      detail: sequence === count
        ? { state: "unavailable", reason: "unsupported_kind" }
        : { state: "available" }
    } satisfies TrajectoryEventV1;
  });
}

describe("virtualized execution trajectory", () => {
  it.each([10, 50, 250, 1_000])("keeps the mounted row DOM bounded for %i events", (count) => {
    render(
      <Trajectory
        events={events(count)}
        selectedEventId={null}
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );

    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeLessThanOrEqual(Math.min(count, 18));
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1);
  });

  it("scopes arrows to trajectory focus and selects with Enter or Space", async () => {
    const onSelect = vi.fn();
    render(
      <Trajectory
        events={events(50)}
        selectedEventId={null}
        expandedGroupKeys={new Set()}
        onSelect={onSelect}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );
    const rows = screen.getAllByRole("option");
    const first = rows[0]!;
    const second = rows[1]!;

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(second);

    first.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(document.activeElement).toBe(second);
    expect(onSelect).toHaveBeenLastCalledWith(second.dataset.eventId);

    await userEvent.keyboard(" ");
    expect(onSelect).toHaveBeenLastCalledWith(second.dataset.eventId);
  });

  it("Escape closes only bounded deep evidence and retains canonical selection", async () => {
    const onSelect = vi.fn();
    const onEscapeDeepEvidence = vi.fn();
    render(
      <Trajectory
        events={events(10)}
        selectedEventId="event-1"
        expandedGroupKeys={new Set()}
        onSelect={onSelect}
        onEscapeDeepEvidence={onEscapeDeepEvidence}
        onRelationshipJump={vi.fn()}
      />
    );
    const selected = screen.getByRole("option", { selected: true });
    selected.focus();
    await userEvent.keyboard("{Escape}");

    expect(onEscapeDeepEvidence).toHaveBeenCalledOnce();
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders only selected visible connectors and uses a labeled jump for an unloaded target", async () => {
    const rect = (top: number, bottom: number, left = 0, right = 800): DOMRect => ({
      x: left, y: top, top, bottom, left, right, width: right - left, height: bottom - top,
      toJSON: () => ({})
    } as DOMRect);
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("trajectory-viewport") || this.classList.contains("trajectory-stage")) {
        return rect(0, 520);
      }
      if (this.dataset.eventId === "event-1") return rect(40, 140, 100, 700);
      if (this.dataset.eventId === "event-2") return rect(180, 280, 100, 700);
      return rect(0, 132);
    });
    const fixture = events(50);
    fixture[0] = {
      ...fixture[0]!,
      relationships: [
        { type: "correlates_with", eventId: "event-2" },
        { type: "correlates_with", eventId: "event-2" },
        { type: "derived_from", eventId: "event-900" },
        { type: "derived_from", eventId: "event-900" }
      ]
    };
    const onRelationshipJump = vi.fn();
    const { container } = render(
      <Trajectory
        events={fixture}
        selectedEventId="event-1"
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={onRelationshipJump}
      />
    );

    await waitFor(() => expect(container.querySelectorAll("[data-relationship-connector]")).toHaveLength(1));
    const connector = container.querySelector("[data-relationship-connector]")!;
    expect(connector).toHaveAttribute("x1", "400");
    expect(connector).toHaveAttribute("y1", "90");
    expect(connector).toHaveAttribute("x2", "400");
    expect(connector).toHaveAttribute("y2", "230");
    expect(getComputedStyle(container.querySelector("[data-relationship-overlay]")!).pointerEvents)
      .toBe("none");
    expect(container.querySelector("[data-global-relationship-graph]")).toBeNull();

    await userEvent.click(screen.getByRole("button", {
      name: "Jump to derived from event event-900"
    }));
    expect(onRelationshipJump).toHaveBeenCalledWith("event-900");
    expect(screen.getAllByRole("button", { name: "Jump to derived from event event-900" })).toHaveLength(1);
    rectSpy.mockRestore();
  });

  it("moves the sole roving tab stop to virtual End and Home destinations before focusing them", async () => {
    render(
      <Trajectory
        events={events(1_000)}
        selectedEventId={null}
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );
    screen.getAllByRole("option")[0]!.focus();
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-event-id", "event-1000"));
    expect(document.activeElement).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("option").filter((row) => row.tabIndex === 0)).toHaveLength(1);

    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-event-id", "event-1"));
    expect(document.activeElement).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("option").filter((row) => row.tabIndex === 0)).toHaveLength(1);
  });

  it("keeps relationship controls out of the tab order while retaining their row label", () => {
    const fixture = events(1_000);
    fixture[0] = {
      ...fixture[0]!,
      relationships: [{ type: "correlates_with", eventId: "event-900" }]
    };
    render(
      <Trajectory
        events={fixture}
        selectedEventId="event-1"
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );

    const selected = screen.getByRole("option", { selected: true });
    const jump = within(selected).getByRole("button", { name: /Jump to correlates with event event-900/ });
    expect(jump).toHaveAttribute("tabindex", "-1");
    expect(selected).toHaveAccessibleName(/Related: correlates with event event-900/);
    expect(document.querySelectorAll('[role="option"][tabindex="0"]')).toHaveLength(1);
  });

  it("resets expanded lifecycle instances when the run identity changes", async () => {
    const groupKey = `grp_${"a".repeat(64)}`;
    const first = events(2).map((item, index) => ({
      ...item,
      eventId: `run-a-${index}`,
      runId: "run-a",
      kind: index === 0 ? "turn.started" : "turn.completed",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: "lifecycle" as const,
      lifecycleGroupKey: groupKey
    }));
    const second = first.map((item) => ({ ...item, runId: "run-b" }));
    const view = render(
      <RunWorkspace
        runId="run-a"
        events={first}
        selectedEventId={null}
        selectionState="idle"
        onSelect={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Expand lifecycle events" }));
    expect(screen.getAllByRole("option")).toHaveLength(2);

    view.rerender(
      <RunWorkspace
        runId="run-b"
        events={second}
        selectedEventId={null}
        selectionState="idle"
        onSelect={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
  });
});
