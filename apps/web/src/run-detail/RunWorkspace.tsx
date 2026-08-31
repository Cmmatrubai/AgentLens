import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { useState } from "react";

import { Trajectory } from "../trajectory/Trajectory.js";

export function RunWorkspace(props: Readonly<{
  events: readonly TrajectoryEventV1[];
  selectedEventId: string | null;
  selectionState: "idle" | "resolving" | "unavailable";
  onSelect: (eventId: string) => void;
}>) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<ReadonlySet<string>>(new Set());
  const selected = props.events.find(({ eventId }) => eventId === props.selectedEventId) ?? null;
  return (
    <div className="run-workspace">
      <Trajectory
        events={props.events}
        selectedEventId={props.selectedEventId}
        expandedGroupKeys={expandedGroupKeys}
        onSelect={props.onSelect}
        onRelationshipJump={props.onSelect}
        onEscapeDeepEvidence={() => undefined}
        onExpandGroup={(key) => setExpandedGroupKeys((current) => {
          const next = new Set(current);
          next.has(key) ? next.delete(key) : next.add(key);
          return next;
        })}
      />
      <aside className="trajectory-inspector" aria-labelledby="trajectory-inspector-title">
        <p className="page-eyebrow">Selected evidence</p>
        <h2 id="trajectory-inspector-title">Event inspector</h2>
        {props.selectionState === "resolving" && <p role="status">Resolving selected event…</p>}
        {props.selectionState === "unavailable" && (
          <p role="alert">The selected event is unavailable in this run.</p>
        )}
        {props.selectionState === "idle" && selected === null && (
          <p>Select a trajectory row to inspect its bounded evidence.</p>
        )}
        {selected !== null && (
          <div>
            <strong>{selected.safeSummary || "No safe summary available."}</strong>
            <dl>
              <div><dt>Event</dt><dd>{selected.eventId}</dd></div>
              <div><dt>Sequence</dt><dd>{selected.sequence}</dd></div>
              <div><dt>Provenance</dt><dd>{selected.provenance.replaceAll("_", " ")}</dd></div>
              <div><dt>Detail</dt><dd>{selected.detail.state === "available" ? "Available on explicit inspection" : "Unsupported event kind"}</dd></div>
            </dl>
            <p className="trajectory-inspector__boundary">Deep evidence loading is available in the next inspection stage.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
