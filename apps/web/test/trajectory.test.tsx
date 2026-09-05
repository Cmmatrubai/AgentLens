import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
      lifecycle: null,
      detail: sequence === count
        ? { state: "unavailable", reason: "unsupported_kind" }
        : { state: "available" }
    } satisfies TrajectoryEventV1;
  });
}

function rect(top: number, bottom: number, left = 0, right = 800): DOMRect {
  return {
    x: left,
    y: top,
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({})
  } as DOMRect;
}

function translatedTop(element: HTMLElement): number {
  const match = /translateY\(([-\d.]+)px\)/.exec(element.style.transform);
  if (match?.[1] === undefined) throw new Error(`Missing translateY offset: ${element.style.transform}`);
  return Number(match[1]);
}

describe("virtualized execution trajectory", () => {
  it("Home and End address the first and last immutable member of a routine cluster", async () => {
    const fixture = events(4).map((event) => ({ ...event, kind: "message", presentationClass: "message" as const,
      provenance: "observed" as const, status: { state: "known" as const, value: "completed" as const } }));
    const select = vi.fn();
    render(<Trajectory events={fixture} selectedEventId={null} expandedGroupKeys={new Set()}
      onSelect={select} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={vi.fn()} />);
    screen.getByRole("option").focus();
    await userEvent.keyboard("{Home}{Enter}");
    expect(select).toHaveBeenLastCalledWith("event-1");
    await userEvent.keyboard("{End}{Enter}");
    expect(select).toHaveBeenLastCalledWith("event-4");
  });
  it("exposes routine members and clarification outside the listbox without requesting content", async () => {
    const fixture = events(4).map((event) => ({ ...event, kind: "message", presentationClass: "message" as const,
      provenance: "observed" as const, status: { state: "known" as const, value: "completed" as const } }));
    const onSelect = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<Trajectory events={fixture} selectedEventId="event-2" expandedGroupKeys={new Set()}
      onSelect={onSelect} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Group routine events" })).toBeChecked();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    const clarification = screen.getByRole("region", { name: "Node clarification" });
    expect(screen.getByRole("listbox")).not.toContainElement(clarification);
    expect(clarification).toHaveTextContent("Safe event 2");
    expect(clarification).toHaveTextContent("Observed evidence");
    await userEvent.click(within(clarification).getByRole("button", { name: /Select immutable event event-3/ }));
    expect(onSelect).toHaveBeenLastCalledWith("event-3");
    await userEvent.click(screen.getByRole("checkbox", { name: "Group routine events" }));
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-2");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps exact edges after unrelated selection and traverses branch direction", async () => {
    const fixture = events(3);
    fixture[1] = { ...fixture[1]!, relationships: [{ type: "derived_from", eventId: "event-1" }] };
    const jump = vi.fn();
    const view = render(<Trajectory events={fixture} selectedEventId="event-3" expandedGroupKeys={new Set()}
      onSelect={vi.fn()} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={jump} />);
    expect(view.container.querySelector('[data-graph-edge][data-source="event-2"][data-target="event-1"]')).not.toBeNull();
    const source = screen.getAllByRole("option").find((node) => node.dataset.eventId === "event-2")!;
    source.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(jump).toHaveBeenLastCalledWith("event-1");
  });
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

  it("measures a wrapped lifecycle row by virtual index while focus and connectors use its event row", async () => {
    const groupKey = `grp_${"d".repeat(64)}`;
    const fixture = events(3).map((event, index) => ({
      ...event,
      eventId: `measured-${index + 1}`,
      sequence: 41 + index,
      kind: index === 0 ? "turn.started" : index === 1 ? "turn.completed" : "message",
      presentationClass: index < 2 ? "lifecycle" as const : "message" as const,
      lifecycleGroupKey: index < 2 ? groupKey : null,
      lifecycle: index < 2 ? {
        domain: "turn" as const,
        phase: index === 0 ? "started" as const : "completed" as const
      } : null,
      relationships: []
    }));
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("trajectory-viewport") || this.classList.contains("trajectory-stage")) {
        return rect(0, 520);
      }
      if (this.classList.contains("trajectory-virtual-row")) {
        return this.querySelector('[data-event-id="measured-2"]') === null
          ? rect(220, 352)
          : rect(0, 220);
      }
      if (this.dataset.eventId === "measured-2") return rect(20, 200, 100, 700);
      if (this.dataset.eventId === "measured-3") return rect(240, 340, 100, 700);
      return rect(0, 132);
    });
    try {
      const { container } = render(
        <Trajectory
          events={fixture}
          selectedEventId="measured-2"
          expandedGroupKeys={new Set()}
          onSelect={vi.fn()}
          onEscapeDeepEvidence={vi.fn()}
          onRelationshipJump={vi.fn()}
        />
      );

      const wrappers = [...container.querySelectorAll<HTMLElement>(".trajectory-virtual-row")];
      await waitFor(() => expect(translatedTop(wrappers[1]!)).toBe(220));
      expect(wrappers[0]).toHaveAttribute("data-index", "0");
      expect(wrappers[1]).toHaveAttribute("data-index", "1");
      expect(translatedTop(wrappers[1]!)).toBeGreaterThanOrEqual(
        translatedTop(wrappers[0]!) + wrappers[0]!.getBoundingClientRect().height
      );

      const groupedRow = screen.getByRole("option", { selected: true });
      expect(groupedRow).toHaveAttribute("data-event-id", "measured-2");
      expect(groupedRow).toHaveAttribute("data-sequence", "42");
      expect(groupedRow).not.toHaveAttribute("data-index");
      groupedRow.focus();
      expect(document.activeElement).toBe(groupedRow);

      expect(container.querySelector("[data-graph-node]")).not.toBeNull();
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("measures a nonzero-sequence around window without overlapping adjacent wrappers", async () => {
    const fixture = events(2).map((event, index) => ({
      ...event,
      eventId: `around-${500 + index}`,
      sequence: 500 + index,
      kind: "message",
      presentationClass: "message" as const
    }));
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("trajectory-viewport") || this.classList.contains("trajectory-stage")) {
        return rect(0, 520);
      }
      if (this.classList.contains("trajectory-virtual-row")) {
        return this.querySelector('[data-event-id="around-500"]') === null
          ? rect(196, 328)
          : rect(0, 196);
      }
      return rect(0, 132);
    });
    try {
      const { container } = render(
        <Trajectory
          events={fixture}
          selectedEventId={null}
          expandedGroupKeys={new Set()}
          onSelect={vi.fn()}
          onEscapeDeepEvidence={vi.fn()}
          onRelationshipJump={vi.fn()}
        />
      );

      const wrappers = [...container.querySelectorAll<HTMLElement>(".trajectory-virtual-row")];
      await waitFor(() => expect(translatedTop(wrappers[1]!)).toBe(196));
      expect(wrappers.map(({ dataset }) => dataset.index)).toEqual(["0", "1"]);
      expect(screen.getAllByRole("option").map(({ dataset }) => dataset.sequence)).toEqual(["500", "501"]);
      expect(screen.getAllByRole("option").every((row) => row.dataset.index === undefined)).toBe(true);
      expect(translatedTop(wrappers[1]!)).toBeGreaterThanOrEqual(
        translatedTop(wrappers[0]!) + wrappers[0]!.getBoundingClientRect().height
      );
    } finally {
      rectSpy.mockRestore();
    }
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

  it("retains deduplicated exact paths and exposes unloaded jumps outside the listbox", async () => {
    const fixture = events(50);
    fixture[0] = { ...fixture[0]!, relationships: [
      { type: "correlates_with", eventId: "event-2" }, { type: "correlates_with", eventId: "event-2" },
      { type: "derived_from", eventId: "event-900" }] };
    const jump = vi.fn();
    const { container } = render(<Trajectory events={fixture} selectedEventId="event-1" expandedGroupKeys={new Set()}
      onSelect={vi.fn()} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={jump} />);
    expect(container.querySelectorAll("[data-graph-edge]")).toHaveLength(2);
    expect(container.querySelector("[data-relationship-overlay]")).toHaveAttribute("aria-hidden", "true");
    expect(getComputedStyle(container.querySelector("[data-relationship-overlay]")!).pointerEvents).toBe("none");
    const action = screen.getByRole("button", { name: /Jump to derived from event event-900/ });
    expect(screen.getByRole("listbox")).not.toContainElement(action);
    await userEvent.click(action);
    expect(jump).toHaveBeenLastCalledWith("event-900");
    expect(container.querySelector("[data-relationship-overlay]")).toHaveTextContent("not loaded");
  });

  it("offers immutable members and expansion through Alt-arrow actions and real clarification buttons", async () => {
    const groupKey = `grp_${"b".repeat(64)}`;
    const fixture = events(2).map((item, index) => ({ ...item,
      eventId: index === 0 ? "group-start" : "group-terminal",
      kind: index === 0 ? "turn.started" : "turn.completed",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: "lifecycle" as const, lifecycleGroupKey: groupKey,
      lifecycle: { domain: "turn" as const, phase: index === 0 ? "started" as const : "completed" as const } }));
    const select = vi.fn(), expand = vi.fn();
    render(<Trajectory events={fixture} selectedEventId="group-terminal" expandedGroupKeys={new Set()}
      onSelect={select} onExpandGroup={expand} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={vi.fn()} />);
    const node = screen.getByRole("option");
    expect(within(node).queryByRole("button")).toBeNull();
    node.focus();
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Enter}");
    expect(select).toHaveBeenLastCalledWith("group-start");
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Enter}");
    expect(expand).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: /Select immutable event group-start/ }));
    expect(select).toHaveBeenLastCalledWith("group-start");
    expect(screen.getAllByRole("option").filter((node) => node.tabIndex === 0)).toHaveLength(1);
  });

  it("presents the controlled selected lifecycle member as the current row action", async () => {
    const groupKey = `grp_${"f".repeat(64)}`;
    const fixture = events(2).map((item, index) => ({
      ...item,
      eventId: index === 0 ? "controlled-start" : "controlled-terminal",
      kind: index === 0 ? "turn.started" : "turn.completed",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: "lifecycle" as const,
      lifecycleGroupKey: groupKey,
      lifecycle: {
        domain: "turn" as const,
        phase: index === 0 ? "started" as const : "completed" as const
      },
      relationships: []
    }));
    function ControlledWorkspace() {
      const [selectedEventId, setSelectedEventId] = useState("controlled-terminal");
      return (
        <>
          <output aria-label="Controlled selection">{selectedEventId}</output>
          <RunWorkspace
            runId="run-controlled-selection"
            events={fixture}
            selectedEventId={selectedEventId}
            selectionState="idle"
            onSelect={setSelectedEventId}
          />
        </>
      );
    }

    const { container } = render(<ControlledWorkspace />);
    const row = screen.getByRole("option");
    row.focus();
    expect(row).toHaveAttribute("data-event-id", "controlled-terminal");
    expect(row).toHaveAccessibleName(/Safe event 2.*Completed.*Current action: Select event controlled-terminal/);

    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Enter}");
    await waitFor(() => expect(screen.getByRole("status", { name: "Controlled selection" }))
      .toHaveTextContent("controlled-start"));
    expect(screen.getByRole("option")).toBe(row);
    expect(row).toHaveAttribute("data-event-id", "controlled-start");
    expect(row).toHaveAttribute("data-sequence", "1");
    expect(row).toHaveAccessibleName(/Safe event 1.*In progress.*Current action: Select event controlled-start/);
    expect(document.activeElement).toBe(row);

    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status", { name: "Controlled selection" })).toHaveTextContent("controlled-start");
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Enter}");
    await waitFor(() => expect(row).toHaveAttribute("data-event-id", "controlled-terminal"));
    expect(row).toHaveAccessibleName(/Current action: Select event controlled-terminal/);
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Enter}");
    await waitFor(() => expect(row).toHaveAttribute("data-event-id", "controlled-start"));

    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Alt>}{ArrowRight}{/Alt}{Enter}");
    await waitFor(() => expect(container.querySelectorAll("[data-lifecycle-member]")).toHaveLength(2));
    await userEvent.click(container.querySelector<HTMLElement>('[data-lifecycle-member="controlled-terminal"]')!);
    await waitFor(() => expect(row).toHaveAttribute("data-event-id", "controlled-terminal"));
    expect(row).toHaveAccessibleName(/Safe event 2.*Current action: Select event controlled-terminal/);
    await userEvent.click(container.querySelector<HTMLElement>('[data-lifecycle-member="controlled-start"]')!);
    await waitFor(() => expect(row).toHaveAttribute("data-event-id", "controlled-start"));
    expect(row).toHaveAccessibleName(/Safe event 1.*Current action: Select event controlled-start/);
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status", { name: "Controlled selection" })).toHaveTextContent("controlled-start");
    expect(document.querySelectorAll('[role="option"][tabindex="0"]')).toHaveLength(1);
    expect(document.activeElement).toBe(row);
  });

  it("expands, collapses, and re-expands one stable measured lifecycle composite", async () => {
    const groupKey = `grp_${"e".repeat(64)}`;
    const fixture = events(3).map((item, index) => ({
      ...item,
      eventId: index === 0 ? "toggle-start" : index === 1 ? "toggle-terminal" : "toggle-target",
      sequence: 41 + index,
      kind: index === 0 ? "turn.started" : index === 1 ? "turn.completed" : "message",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: index < 2 ? "lifecycle" as const : "message" as const,
      lifecycleGroupKey: index < 2 ? groupKey : null,
      lifecycle: index < 2 ? {
        domain: "turn" as const,
        phase: index === 0 ? "started" as const : "completed" as const
      } : null,
      relationships: []
    }));
    const isExpanded = () => document.querySelector("[data-lifecycle-member]") !== null;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("trajectory-viewport") || this.classList.contains("trajectory-stage")) {
        return rect(0, 520);
      }
      if (this.classList.contains("trajectory-virtual-row")) {
        if (this.querySelector('[data-event-id="toggle-terminal"]') !== null) {
          return isExpanded() ? rect(0, 360) : rect(0, 220);
        }
        return rect(0, 132);
      }
      if (this.dataset.eventId === "toggle-terminal") {
        return isExpanded() ? rect(20, 340, 100, 700) : rect(20, 200, 100, 700);
      }
      if (this.dataset.eventId === "toggle-target") {
        return isExpanded() ? rect(380, 480, 100, 700) : rect(240, 340, 100, 700);
      }
      return rect(0, 132);
    });
    try {
      const onSelect = vi.fn();
      const { container } = render(
        <RunWorkspace
          runId="run-toggle"
          events={fixture}
          selectedEventId="toggle-terminal"
          selectionState="idle"
          onSelect={onSelect}
        />
      );
      const groupRow = screen.getByRole("option", { selected: true });
      const groupWrapper = groupRow.closest<HTMLElement>(".trajectory-virtual-row")!;
      const targetWrapper = screen.getByRole("option", { selected: false })
        .closest<HTMLElement>(".trajectory-virtual-row")!;
      groupRow.focus();
      expect(groupRow).toHaveAccessibleName(/Current action: Select event toggle-terminal/);
      expect(translatedTop(targetWrapper)).toBe(220);

      await userEvent.keyboard("{Enter}");
      expect(onSelect).toHaveBeenLastCalledWith("toggle-terminal");
      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Enter}");
      expect(onSelect).toHaveBeenLastCalledWith("toggle-start");
      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Enter}");

      await waitFor(() => expect(container.querySelectorAll("[data-lifecycle-member]")).toHaveLength(2));
      expect([...container.querySelectorAll<HTMLElement>("[data-lifecycle-member]")]
        .map(({ dataset }) => dataset.lifecycleMember)).toEqual(["toggle-start", "toggle-terminal"]);
      await userEvent.click(container.querySelector<HTMLElement>('[data-lifecycle-member="toggle-start"]')!);
      expect(onSelect).toHaveBeenLastCalledWith("toggle-start");
      await userEvent.click(container.querySelector<HTMLElement>('[data-lifecycle-member="toggle-terminal"]')!);
      expect(onSelect).toHaveBeenLastCalledWith("toggle-terminal");
      expect(screen.getAllByRole("option")).toHaveLength(2);
      expect(screen.getByRole("option", { selected: true })).toBe(groupRow);
      expect(groupRow.closest(".trajectory-virtual-row")).toBe(groupWrapper);
      expect(document.activeElement).toBe(groupRow);
      expect(groupRow).toHaveAccessibleName(/Current action: Collapse lifecycle events/);
      expect(document.querySelectorAll('[role="option"][tabindex="0"]')).toHaveLength(1);
      await waitFor(() => expect(translatedTop(targetWrapper)).toBe(360));
      expect(translatedTop(targetWrapper)).toBeGreaterThanOrEqual(
        translatedTop(groupWrapper) + groupWrapper.getBoundingClientRect().height
      );
      expect(container.querySelectorAll("[data-graph-node]")).toHaveLength(2);

      await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}{Enter}");
      expect(onSelect).toHaveBeenLastCalledWith("toggle-start");
      await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}{Enter}");
      expect(onSelect).toHaveBeenLastCalledWith("toggle-terminal");
      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Alt>}{ArrowRight}{/Alt}{Enter}");
      await waitFor(() => expect(container.querySelector("[data-lifecycle-member]")).toBeNull());
      expect(groupRow).toHaveAccessibleName(/Current action: Expand lifecycle events/);
      expect(document.activeElement).toBe(groupRow);
      await waitFor(() => expect(translatedTop(targetWrapper)).toBe(220));

      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(container.querySelectorAll("[data-lifecycle-member]")).toHaveLength(2));
      expect(groupRow).toHaveAccessibleName(/Current action: Collapse lifecycle events/);
      await userEvent.click(screen.getByText("Collapse lifecycle events", { selector: '[data-row-action="expand"]' }));
      await waitFor(() => expect(container.querySelector("[data-lifecycle-member]")).toBeNull());
      await userEvent.click(screen.getByText("Expand lifecycle events", { selector: '[data-row-action="expand"]' }));
      await waitFor(() => expect(container.querySelectorAll("[data-lifecycle-member]")).toHaveLength(2));
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Collapse lifecycle events" }));
      expect(document.querySelectorAll('[role="option"][tabindex="0"]')).toHaveLength(1);
      await waitFor(() => expect(translatedTop(targetWrapper)).toBe(360));
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("keeps lifecycle relationship endpoints separate with exact direction", async () => {
    const groupKey = `grp_${"c".repeat(64)}`;
    const fixture = events(2).map((item, index) => ({ ...item,
      eventId: index === 0 ? "same-start" : "same-terminal",
      kind: index === 0 ? "turn.started" : "turn.completed",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: "lifecycle" as const, lifecycleGroupKey: groupKey,
      lifecycle: { domain: "turn" as const, phase: index === 0 ? "started" as const : "completed" as const },
      relationships: index === 0 ? [{ type: "correlates_with" as const, eventId: "same-terminal" }] : [] }));
    const view = render(<Trajectory events={fixture} selectedEventId="same-start" expandedGroupKeys={new Set()}
      onSelect={vi.fn()} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={vi.fn()} />);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(view.container.querySelector('[data-graph-edge="correlates_with"]')).toHaveAttribute("data-source", "same-start");
    expect(view.container.querySelector('[data-graph-edge="correlates_with"]')).toHaveAttribute("data-target", "same-terminal");
    await waitFor(() => expect(screen.getByRole("button", { name: /Jump to correlates with event same-terminal/ })).toBeVisible());
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

  it("moves the roving entry to the visible window after outside focus and manual scroll", async () => {
    render(
      <>
        <button type="button">Before trajectory</button>
        <Trajectory
          events={events(1_000)}
          selectedEventId="event-1"
          expandedGroupKeys={new Set()}
          onSelect={vi.fn()}
          onEscapeDeepEvidence={vi.fn()}
          onRelationshipJump={vi.fn()}
        />
      </>
    );
    screen.getByRole("button", { name: "Before trajectory" }).focus();
    const listbox = screen.getByRole("listbox");
    const viewport = listbox.closest<HTMLElement>(".trajectory-viewport") ?? listbox;
    Object.defineProperty(viewport, "scrollTop", { configurable: true, value: 144 * 40, writable: true });
    fireEvent.scroll(viewport);

    await waitFor(() => expect(screen.getAllByRole("option").some((row) =>
      Number(row.dataset.sequence) >= 40
    )).toBe(true));
    const tabStops = screen.getAllByRole("option").filter((row) => row.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(Number(tabStops[0]!.dataset.sequence)).toBeGreaterThanOrEqual(40);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Group routine events" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(tabStops[0]);
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-event-id", "event-1"));
    expect(document.activeElement).toHaveAttribute("aria-selected", "true");
  });

  it("pins selected and bounded distant relationship regions while keeping semantic branch access", async () => {
    const fixture = events(1_000);
    fixture[0] = { ...fixture[0]!, relationships: [{ type: "correlates_with", eventId: "event-900" }] };
    const jump = vi.fn();
    const { container } = render(<Trajectory events={fixture} selectedEventId="event-1" expandedGroupKeys={new Set()}
      onSelect={vi.fn()} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={jump} />);
    expect(container.querySelector('[data-event-id="event-900"]')).not.toBeNull();
    expect(screen.getAllByRole("option").length).toBeLessThan(30);
    const selected = screen.getByRole("option", { selected: true });
    expect(within(selected).queryByRole("button")).toBeNull();
    const action = screen.getByRole("button", { name: /Jump to correlates with event event-900/ });
    expect(screen.getByRole("listbox")).not.toContainElement(action);
    selected.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(jump).toHaveBeenLastCalledWith("event-900");
    expect(document.activeElement).toHaveAttribute("data-event-id", "event-900");
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
      lifecycleGroupKey: groupKey,
      lifecycle: {
        domain: "turn" as const,
        phase: index === 0 ? "started" as const : "completed" as const
      }
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
    const groupedRow = screen.getByRole("option");
    groupedRow.focus();
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}{Alt>}{ArrowRight}{/Alt}{Enter}");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveAccessibleName(/Collapse lifecycle events/);
    expect(document.querySelectorAll("[data-lifecycle-member]")).toHaveLength(2);

    view.rerender(
      <RunWorkspace
        runId="run-b"
        events={second}
        selectedEventId={null}
        selectionState="idle"
        onSelect={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole("option")).toHaveAccessibleName(/Expand lifecycle events/));
    expect(document.querySelector("[data-lifecycle-member]")).toBeNull();
  });
});
