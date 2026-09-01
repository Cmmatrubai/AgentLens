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
      relationships: index === 1
        ? [{ type: "correlates_with" as const, eventId: "measured-3" }]
        : []
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

      await waitFor(() => expect(container.querySelector("[data-relationship-connector]"))
        .toHaveAttribute("y1", "110"));
      expect(container.querySelector("[data-relationship-connector]")).toHaveAttribute("y2", "290");
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

  it("renders only selected visible connectors and uses a labeled jump for an unloaded target", async () => {
    let targetTop = 180;
    const rect = (top: number, bottom: number, left = 0, right = 800): DOMRect => ({
      x: left, y: top, top, bottom, left, right, width: right - left, height: bottom - top,
      toJSON: () => ({})
    } as DOMRect);
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("trajectory-viewport") || this.classList.contains("trajectory-stage")) {
        return rect(0, 520);
      }
      if (this.dataset.eventId === "event-1") return rect(40, 140, 100, 700);
      if (this.dataset.eventId === "event-2") return rect(targetTop, targetTop + 100, 100, 700);
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

    const jump = [...container.querySelectorAll<HTMLElement>('[data-row-action="relationship"]')]
      .find((action) => action.textContent === "Jump to derived from event event-900");
    expect(jump).toBeDefined();
    await userEvent.click(jump!);
    expect(onRelationshipJump).toHaveBeenCalledWith("event-900");
    expect([...container.querySelectorAll('[data-row-action="relationship"]')].filter(
      (action) => action.textContent === "Jump to derived from event event-900"
    )).toHaveLength(1);
    targetTop = 300;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(connector).toHaveAttribute("y2", "350"));
    rectSpy.mockRestore();
  });

  it("offers grouped-event, expansion, and relationship actions through the one row tab stop", async () => {
    const groupKey = `grp_${"b".repeat(64)}`;
    const fixture = events(2).map((item, index) => ({
      ...item,
      eventId: index === 0 ? "group-start" : "group-terminal",
      kind: index === 0 ? "turn.started" : "turn.completed",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: "lifecycle" as const,
      lifecycleGroupKey: groupKey,
      lifecycle: {
        domain: "turn" as const,
        phase: index === 0 ? "started" as const : "completed" as const
      },
      relationships: index === 1 ? [
        { type: "derived_from" as const, eventId: "event-900" },
        { type: "recovers" as const, eventId: "event-901" }
      ] : []
    }));
    const onSelect = vi.fn();
    const onExpandGroup = vi.fn();
    const onRelationshipJump = vi.fn();
    render(
      <Trajectory
        events={fixture}
        selectedEventId="group-terminal"
        expandedGroupKeys={new Set()}
        onSelect={onSelect}
        onExpandGroup={onExpandGroup}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={onRelationshipJump}
      />
    );
    const row = screen.getByRole("option");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(row).toHaveAccessibleName(/Use Left and Right Arrow to choose a row action/);
    expect(row).toHaveAccessibleName(/Jump to derived from event event-900/);
    expect(row).toHaveAccessibleName(/Jump to recovers event event-901/);
    row.focus();

    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("group-terminal");
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("group-start");
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(onExpandGroup).toHaveBeenCalledOnce();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(onRelationshipJump).toHaveBeenCalledWith("event-900");
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(onRelationshipJump).toHaveBeenCalledWith("event-901");
    expect(document.querySelectorAll('[role="option"][tabindex="0"]')).toHaveLength(1);
  });

  it("labels a same-group relationship as a row action without drawing a zero-length line", () => {
    const groupKey = `grp_${"c".repeat(64)}`;
    const fixture = events(2).map((item, index) => ({
      ...item,
      eventId: index === 0 ? "same-start" : "same-terminal",
      kind: index === 0 ? "turn.started" : "turn.completed",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: "lifecycle" as const,
      lifecycleGroupKey: groupKey,
      lifecycle: {
        domain: "turn" as const,
        phase: index === 0 ? "started" as const : "completed" as const
      },
      relationships: index === 0 ? [{ type: "correlates_with" as const, eventId: "same-terminal" }] : []
    }));
    const { container } = render(
      <Trajectory
        events={fixture}
        selectedEventId="same-start"
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onExpandGroup={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );

    expect(screen.getByRole("option")).toHaveAccessibleName(/Jump to correlates with event same-terminal/);
    expect(container.querySelectorAll('[data-row-action="relationship"]')).toHaveLength(1);
    expect(container.querySelector("[data-relationship-connector]")).toBeNull();
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
    const viewport = screen.getByRole("listbox");
    Object.defineProperty(viewport, "scrollTop", { configurable: true, value: 144 * 40, writable: true });
    fireEvent.scroll(viewport);

    await waitFor(() => expect(screen.getAllByRole("option").some((row) =>
      Number(row.dataset.sequence) >= 40
    )).toBe(true));
    const tabStops = screen.getAllByRole("option").filter((row) => row.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(Number(tabStops[0]!.dataset.sequence)).toBeGreaterThanOrEqual(40);

    await userEvent.tab();
    expect(document.activeElement).toBe(tabStops[0]);
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-event-id", "event-1"));
    expect(document.activeElement).toHaveAttribute("aria-selected", "true");
  });

  it("keeps relationship actions in the row composite and its accessible label", async () => {
    const fixture = events(1_000);
    fixture[0] = {
      ...fixture[0]!,
      relationships: [{ type: "correlates_with", eventId: "event-900" }]
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

    const selected = screen.getByRole("option", { selected: true });
    expect(within(selected).queryByRole("button")).toBeNull();
    expect(container.querySelector('[data-row-action="relationship"]')).toHaveTextContent(
      "Jump to correlates with event event-900"
    );
    expect(selected).toHaveAccessibleName(/Jump to correlates with event event-900/);
    expect(document.querySelectorAll('[role="option"][tabindex="0"]')).toHaveLength(1);
    selected.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(onRelationshipJump).toHaveBeenCalledWith("event-900");
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
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{Enter}");
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
