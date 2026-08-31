import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Trajectory } from "../src/trajectory/Trajectory.js";

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
    const fixture = events(50);
    fixture[0] = {
      ...fixture[0]!,
      relationships: [
        { type: "correlates_with", eventId: "event-2" },
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

    expect(container.querySelectorAll("[data-relationship-connector]")).toHaveLength(1);
    expect(getComputedStyle(container.querySelector("[data-relationship-overlay]")!).pointerEvents)
      .toBe("none");
    expect(container.querySelector("[data-global-relationship-graph]")).toBeNull();

    await userEvent.click(screen.getByRole("button", {
      name: "Jump to derived from event event-900"
    }));
    expect(onRelationshipJump).toHaveBeenCalledWith("event-900");
  });
});
