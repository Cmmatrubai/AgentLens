import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Trajectory } from "../src/trajectory/Trajectory.js";
import { TrajectoryToolbar } from "../src/trajectory/TrajectoryToolbar.js";
import { RunWorkspace } from "../src/run-detail/RunWorkspace.js";
import { ExecutionGraphEdges } from "../src/trajectory/ExecutionGraphEdges.js";
import { projectExecutionGraph } from "../src/trajectory/projectExecutionGraph.js";

// Vitest globals are disabled, so RTL cannot register automatic root cleanup.
afterEach(cleanup);

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

// JSDOM has no layout or native scrolling. Keep the real virtualizer and model
// only the measured DOM geometry and the browser's clamped scroll operation.
// Unmount before restoring these prototypes so scheduled virtualizer work cannot
// keep a detached React root alive under the next test's geometry.
function mockScrollGeometry(tallClarificationEventId?: string, tallRegionEventId?: string) {
  const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.classList.contains("trajectory-viewport")) return rect(0, 520);
    if (this.classList.contains("execution-graph-region")) {
      return rect(0, this.querySelector(`[data-event-id="${tallRegionEventId}"]`) ? 1_200 : Number.parseFloat(this.style.minHeight));
    }
    if (this.classList.contains("execution-graph-clarification")) {
      const selected = this.closest(".execution-graph-canvas")?.querySelector('[aria-selected="true"]');
      return rect(0, selected?.getAttribute("data-event-id") === tallClarificationEventId ? 1_200 : 300);
    }
    return rect(0, 100);
  });
  const heightSpy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () {
    return this.classList.contains("trajectory-viewport") ? 520 : 0;
  });
  const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function () {
    return this.classList.contains("trajectory-viewport")
      ? Number.parseFloat(this.querySelector<HTMLElement>(".execution-graph-canvas")?.style.height ?? "0") : 0;
  });
  const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = Math.max(0, Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight));
  });
  const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  return {
    scrollTo,
    restore() {
      rectSpy.mockRestore(); heightSpy.mockRestore(); scrollHeightSpy.mockRestore();
      if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    }
  };
}

describe("virtualized execution trajectory", () => {
  it("distinguishes a partial loaded count from a completed immutable event set", () => {
    const view = render(
      <TrajectoryToolbar
        eventCount={100}
        totalEventCount={101}
        isComplete={false}
        hasEarlier={false}
        hasLater={true}
        onEarlier={null}
        onLater={vi.fn()}
      />
    );

    expect(screen.getByText("100 of 101 immutable events loaded")).toBeVisible();
    expect(screen.queryByText(/complete/i)).toBeNull();

    view.rerender(
      <TrajectoryToolbar
        eventCount={101}
        totalEventCount={101}
        isComplete={true}
        hasEarlier={false}
        hasLater={false}
        onEarlier={null}
        onLater={null}
      />
    );

    expect(screen.getByText("101 of 101 immutable events loaded")).toBeVisible();

    view.rerender(
      <TrajectoryToolbar
        eventCount={7}
        totalEventCount={null}
        isComplete={false}
        hasEarlier={false}
        hasLater={false}
        onEarlier={null}
        onLater={null}
      />
    );

    expect(screen.getByText("7 immutable events loaded")).toBeVisible();
  });

  it("aligns a deferred selection after a substantial head window resolves and does not realign it on polling", async () => {
    const geometry = mockScrollGeometry();
    const fixture = events(102);
    const props = { selectedEventId: "event-101", expandedGroupKeys: new Set<string>(),
      onSelect: vi.fn(), onEscapeDeepEvidence: vi.fn(), onRelationshipJump: vi.fn() };
    let unmount: (() => void) | undefined;
    try {
      const view = render(<Trajectory {...props} events={fixture.slice(0, 80)} />);
      unmount = view.unmount;
      const viewport = view.container.querySelector<HTMLElement>(".trajectory-viewport")!;
      expect(viewport.scrollTop).toBe(0);
      expect(screen.queryByRole("option", { selected: true })).toBeNull();
      view.rerender(<Trajectory {...props} events={fixture.slice(0, 101)} />);
      const selected = screen.getByRole("option", { selected: true });
      const region = selected.closest<HTMLElement>(".execution-graph-region")!;
      await waitFor(() => expect(viewport.scrollTop).toBeCloseTo(translatedTop(region) - 520 / 3));
      fireEvent.scroll(viewport);

      // Reading history after resolution must win over the unchanged selection.
      viewport.scrollTop -= 800;
      fireEvent.scroll(viewport);
      const historyOffset = viewport.scrollTop;
      view.rerender(<Trajectory {...props} events={fixture}
        liveAppend={{ runId: "run-virtual", revision: 1, identities: ["event-102:102"] }} />);
      expect(viewport.scrollTop).toBe(historyOffset);
      expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-101");
      expect(screen.getByRole("button", { name: "1 new event" })).toBeVisible();
      expect(props.onSelect).not.toHaveBeenCalled();

      // Clearing selection makes returning to the same ID a deliberate jump.
      const liveAppend = { runId: "run-virtual", revision: 1, identities: ["event-102:102"] };
      view.rerender(<Trajectory {...props} events={fixture} liveAppend={liveAppend} selectedEventId={null} />);
      expect(viewport.scrollTop).toBe(historyOffset);
      view.rerender(<Trajectory {...props} events={fixture} liveAppend={liveAppend} />);
      expect(viewport.scrollTop).toBeCloseTo(translatedTop(region) - 520 / 3);
    } finally { unmount?.(); geometry.restore(); }
  });

  it("realigns a loaded selection returned to while another selection is still unresolved", () => {
    const geometry = mockScrollGeometry();
    const fixture = events(102);
    const loaded = fixture.slice(0, 101);
    const props = { selectedEventId: "event-80", expandedGroupKeys: new Set<string>(),
      onSelect: vi.fn(), onEscapeDeepEvidence: vi.fn(), onRelationshipJump: vi.fn() };
    let unmount: (() => void) | undefined;
    try {
      const view = render(<Trajectory {...props} events={loaded} />);
      unmount = view.unmount;
      const viewport = view.container.querySelector<HTMLElement>(".trajectory-viewport")!;
      const region = screen.getByRole("option", { selected: true }).closest<HTMLElement>(".execution-graph-region")!;
      const alignedOffset = translatedTop(region) - 520 / 3;
      expect(viewport.scrollTop).toBeCloseTo(alignedOffset);
      fireEvent.scroll(viewport);
      viewport.scrollTop -= 800;
      fireEvent.scroll(viewport);
      const historyOffset = viewport.scrollTop;

      view.rerender(<Trajectory {...props} events={loaded} selectedEventId="event-102" />);
      expect(screen.queryByRole("option", { selected: true })).toBeNull();
      expect(viewport.scrollTop).toBe(historyOffset);
      view.rerender(<Trajectory {...props} events={loaded} />);
      expect(viewport.scrollTop).toBeCloseTo(alignedOffset);
      expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-80");

      fireEvent.scroll(viewport);
      viewport.scrollTop = historyOffset;
      fireEvent.scroll(viewport);
      view.rerender(<Trajectory {...props} events={fixture}
        liveAppend={{ runId: "run-virtual", revision: 1, identities: ["event-102:102"] }} />);
      expect(viewport.scrollTop).toBe(historyOffset);
      expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-80");
      expect(screen.getByRole("button", { name: "1 new event" })).toBeVisible();
      expect(props.onSelect).not.toHaveBeenCalled();
    } finally { unmount?.(); geometry.restore(); }
  });

  it.each([false, true])("keeps the latest node visible and follows successive appends after a tall historical clarification (tall latest region: %s)", async (tallLatestRegion) => {
    const geometry = mockScrollGeometry("event-1", tallLatestRegion ? "event-42" : undefined);
    const fixture = events(44);
    fixture[0] = { ...fixture[0]!, relationships: fixture.slice(1, 41).map((event) => ({ type: "derived_from", eventId: event.eventId })) };
    function FollowingGraph({ count }: { count: number }) {
      const [selectedEventId, onSelect] = useState("event-1");
      return <Trajectory events={fixture.slice(0, count)} selectedEventId={selectedEventId} onSelect={onSelect}
        expandedGroupKeys={new Set()} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={vi.fn()}
        liveAppend={{ runId: "run-virtual", revision: count - 41, identities: count > 41 ? [`event-${count}:${count}`] : [] }} />;
    }
    let unmount: (() => void) | undefined;
    try {
      const view = render(<FollowingGraph count={41} />);
      unmount = view.unmount;
      const viewport = view.container.querySelector<HTMLElement>(".trajectory-viewport")!;
      const stage = screen.getByRole("listbox");
      expect(viewport.scrollHeight - Number.parseFloat(stage.style.height)).toBe(1_200);
      expect(screen.getAllByRole("button", { name: /Jump to derived from event/ })).toHaveLength(40);
      viewport.scrollTop = 300;
      fireEvent.scroll(viewport);
      view.rerender(<FollowingGraph count={42} />);
      expect(viewport.scrollTop).toBe(300);
      await userEvent.click(screen.getByRole("button", { name: "1 new event" }));
      const expectLatestVisible = (id: string) => {
        const latest = view.container.querySelector<HTMLElement>(`[data-event-id="${id}"]`)!;
        expect(latest).not.toBeNull();
        const top = translatedTop(latest.closest<HTMLElement>(".execution-graph-region")!);
        expect(top).toBeGreaterThanOrEqual(viewport.scrollTop);
        expect(top + latest.getBoundingClientRect().height).toBeLessThanOrEqual(viewport.scrollTop + viewport.clientHeight);
      };
      expectLatestVisible("event-42");
      expect(document.activeElement).toHaveAttribute("data-event-id", "event-42");
      expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-42");
      expect(viewport.scrollHeight - Number.parseFloat(stage.style.height)).toBe(1_200);
      for (const count of [43, 44]) {
        fireEvent.scroll(viewport); // Native scroll feedback must keep following enabled.
        const previousOffset = viewport.scrollTop;
        view.rerender(<FollowingGraph count={count} />);
        expect(viewport.scrollTop).toBeGreaterThan(previousOffset);
        expectLatestVisible(`event-${count}`);
        expect(screen.queryByRole("button", { name: /new event/ })).toBeNull();
        expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-42");
        expect(document.activeElement).toHaveAttribute("data-event-id", "event-42");
      }
    } finally { unmount?.(); geometry.restore(); }
  });

  it("pauses following when the user scrolls below all nodes into a tall clarification reserve", () => {
    const geometry = mockScrollGeometry("event-1");
    const fixture = events(42);
    fixture[0] = { ...fixture[0]!, relationships: fixture.slice(1, 41).map((event) => ({ type: "derived_from", eventId: event.eventId })) };
    const props = { selectedEventId: "event-1", expandedGroupKeys: new Set<string>(),
      onSelect: vi.fn(), onEscapeDeepEvidence: vi.fn(), onRelationshipJump: vi.fn() };
    let unmount: (() => void) | undefined;
    try {
      const view = render(<Trajectory {...props} events={fixture.slice(0, 41)} />);
      unmount = view.unmount;
      const viewport = view.container.querySelector<HTMLElement>(".trajectory-viewport")!;
      viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
      expect(viewport.scrollTop).toBeGreaterThan(Number.parseFloat(screen.getByRole("listbox").style.height));
      fireEvent.scroll(viewport);
      const historyOffset = viewport.scrollTop;
      view.rerender(<Trajectory {...props} events={fixture}
        liveAppend={{ runId: "run-virtual", revision: 1, identities: ["event-42:42"] }} />);
      expect(viewport.scrollTop).toBe(historyOffset);
      expect(screen.getByRole("button", { name: "1 new event" })).toBeVisible();
      expect(screen.getByRole("option", { selected: true })).toHaveAttribute("data-event-id", "event-1");
      expect(props.onSelect).not.toHaveBeenCalled();
    } finally { unmount?.(); geometry.restore(); }
  });

  it("shares dense relationship labels without hiding exact paths or boundary distinctions", () => {
    const fixture = events(41);
    fixture[0] = { ...fixture[0]!, relationships: fixture.slice(1).map((event) => ({ type: "derived_from", eventId: event.eventId })) };
    const graph = projectExecutionGraph({ events: fixture, expandedGroupKeys: new Set() });
    const positions = new Map(graph.nodes.map((_node, index) => [index, { start: index * 160, size: 160 }]));
    const { container } = render(<ExecutionGraphEdges graph={graph} positions={positions} viewportStart={0}
      viewportHeight={520} height={6560} selectedEventId={null} />);
    expect(container.querySelectorAll("[data-graph-edge]")).toHaveLength(40);
    expect(container.querySelector('[data-source="event-1"][data-target="event-41"]')).not.toBeNull();
    expect(container.querySelector("svg")).toHaveTextContent("derived from · offscreen · 38 relationships");
    expect(container.querySelector("svg")).toHaveTextContent("derived from · 2 relationships");
    const labels = [...container.querySelectorAll(".execution-graph-relationship text")];
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => Number(label.getAttribute("y")) >= 12 && Number(label.getAttribute("y")) <= 508)).toBe(true);
  });
  it("keeps crossing relationships visible with both endpoints outside the mounted window", async () => {
    const fixture = events(1_000);
    fixture[0] = { ...fixture[0]!, relationships: [{ type: "derived_from", eventId: "event-900" }] };
    const { container } = render(<Trajectory events={fixture} selectedEventId="event-500" expandedGroupKeys={new Set()}
      onSelect={vi.fn()} onEscapeDeepEvidence={vi.fn()} onRelationshipJump={vi.fn()} />);
    const viewport = container.querySelector<HTMLElement>(".trajectory-viewport")!;
    Object.defineProperty(viewport, "scrollTop", { configurable: true, value: 60_000, writable: true });
    fireEvent.scroll(viewport);
    await waitFor(() => expect(container.querySelector('[data-event-id="event-1"]')).toBeNull());
    expect(container.querySelector('[data-event-id="event-900"]')).toBeNull();
    expect(screen.getAllByRole("option").length).toBeLessThan(30);
    const edge = container.querySelector('[data-graph-edge][data-source="event-1"][data-target="event-900"]');
    expect(edge).not.toBeNull();
    expect(edge?.getAttribute("d")).toContain("60012");
    expect(edge?.getAttribute("d")).toContain("60508");
    expect(container.querySelector("[data-relationship-overlay]")).toHaveTextContent("offscreen");
  });

  it.each([0, 300])("separates outgoing and clipped boundary relationship labels at viewport %i", (viewportStart) => {
    const fixture = events(6);
    fixture[0] = { ...fixture[0]!, relationships: [
      { type: "derived_from", eventId: "event-5" },
      { type: "correlates_with", eventId: "event-6" },
      { type: "recovers", eventId: "unloaded-event" }
    ] };
    fixture[1] = { ...fixture[1]!, relationships: [{ type: "derived_from", eventId: "event-6" }] };
    fixture[5] = { ...fixture[5]!, relationships: [
      { type: "derived_from", eventId: "event-1" },
      { type: "correlates_with", eventId: "event-2" },
      { type: "recovers", eventId: "event-3" }
    ] };
    const graph = projectExecutionGraph({ events: fixture, expandedGroupKeys: new Set() });
    const positions = new Map(graph.nodes.map((_node, index) => [index, { start: index * 160, size: 160 }]));
    const { container } = render(<ExecutionGraphEdges graph={graph} positions={positions} viewportStart={viewportStart}
      viewportHeight={520} height={960} selectedEventId={null} />);
    const labels = [...container.querySelectorAll(".execution-graph-relationship text")];
    expect(labels.length).toBeGreaterThanOrEqual(3);
    const ys = labels.map((label) => Number(label.getAttribute("y"))).sort((a, b) => a - b);
    for (let index = 1; index < ys.length; index++) expect(ys[index]! - ys[index - 1]!).toBeGreaterThanOrEqual(14);
    expect(ys[0]).toBeGreaterThanOrEqual(viewportStart + 12);
    expect(ys.at(-1)).toBeLessThanOrEqual(viewportStart + 508);
    expect(container.querySelector('[data-source="event-1"][data-target="event-5"]')).not.toBeNull();
    expect(container.querySelector('[data-source="event-1"][data-target="event-6"]')).not.toBeNull();
  });
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

  it("labels derived recorder elapsed time separately from unavailable provider time", async () => {
    const groupKey = `grp_${"t".repeat(64)}`;
    const fixture = events(2).map((item, index) => ({
      ...item,
      eventId: index === 0 ? "timed-start" : "timed-terminal",
      kind: index === 0 ? "turn.started" : "turn.completed",
      status: { state: "known" as const, value: index === 0 ? "in_progress" as const : "completed" as const },
      presentationClass: "lifecycle" as const,
      lifecycleGroupKey: groupKey,
      lifecycle: { domain: "turn" as const, phase: index === 0 ? "started" as const : "completed" as const },
      sourceOccurredAt: { state: "unavailable" as const, reason: "not_captured" as const }
    }));

    render(
      <Trajectory
        events={fixture}
        selectedEventId="timed-terminal"
        expandedGroupKeys={new Set()}
        onSelect={vi.fn()}
        onExpandGroup={vi.fn()}
        onEscapeDeepEvidence={vi.fn()}
        onRelationshipJump={vi.fn()}
      />
    );

    const row = screen.getByRole("option", { selected: true });
    expect(screen.getByText("Recorder-observed elapsed · derived from receipt timestamps")).toBeVisible();
    expect(row).toHaveTextContent(/1,?000 ms/);
    await waitFor(() => expect(screen.getByText("Provider time unavailable · not captured")).toBeVisible());
    expect(row).toHaveAccessibleName(/Recorder-observed elapsed · derived from receipt timestamps/);
    expect(row).not.toHaveAccessibleName(/Provider duration/);
    expect(screen.queryByText(/^Provider duration$/)).not.toBeInTheDocument();
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
