import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { useState, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import { useMotionPolicy } from "../motion/motionPolicy.js";
import type { ExecutionGraphNode } from "./graphTypes.js";

export const provenanceLabels = { observed: "Observed evidence", derived: "Derived evidence",
  git_recovered: "Git-recovered evidence", recorder: "Recorder evidence", human: "Human evidence" } as const;
export function eventStatus(event: TrajectoryEventV1): string {
  if (event.status.state !== "known") return `Unsupported status: ${event.status.safeToken}`;
  const label = event.status.value.replaceAll("_", " ");
  return label[0]!.toUpperCase() + label.slice(1);
}
export function ExecutionNode(props: Readonly<{
  node: ExecutionGraphNode; selectedEventId: string | null; activeEventId?: string | null; tabIndex: number; nodeRef: Ref<HTMLDivElement>;
  onSelect: (id: string) => void; onExpand: (key: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}>) {
  const { node } = props;
  const selectedMember = node.events.find((event) => event.eventId === props.selectedEventId);
  const active = node.events.find((event) => event.eventId === props.activeEventId) ?? selectedMember ?? node.events.at(-1)!;
  // Card content is projection-owned, so selecting a different immutable member never resizes it.
  const primary = node.events.at(-1)!;
  const actions = [{ label: `Select event ${active.eventId}`, invoke: () => props.onSelect(active.eventId) },
    ...node.events.filter((event) => event !== active).map((event) => ({
      label: `Select immutable event ${event.eventId}`, invoke: () => props.onSelect(event.eventId)
    })), ...(node.type === "event" ? [] : [{
      label: `${node.expanded ? "Collapse" : "Expand"} ${node.type === "lifecycle_group" ? "lifecycle" : "routine"} events`,
      invoke: () => props.onExpand(node.key)
    }])];
  const context = `${node.key}:${active.eventId}`;
  const [cursor, setCursor] = useState({ context, index: 0 });
  if (cursor.context !== context) setCursor({ context, index: 0 });
  const index = cursor.context === context ? Math.min(cursor.index, actions.length - 1) : 0;
  const policy = useMotionPolicy();
  return <div ref={props.nodeRef} role="option" tabIndex={props.tabIndex}
    aria-selected={selectedMember !== undefined} aria-expanded={node.type === "event" ? undefined : node.expanded}
    aria-label={`${active.safeSummary}. ${provenanceLabels[active.provenance]}. ${eventStatus(active)}. Use Left and Right Arrow for recorded branches. ${actions.length > 1 ? `Use Alt+Left and Alt+Right to choose a group action. Actions: ${actions.map((action) => action.label).join("; ")}. ` : ""}Current action: ${actions[index]!.label}.`}
    aria-keyshortcuts="ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight Enter Space"
    className={`execution-node execution-node--${primary.provenance}${selectedMember === undefined ? "" : " execution-node--selected"}`}
    data-graph-node={node.key} data-weight={node.weight} data-lane={node.lane}
    data-event-id={active.eventId} data-sequence={active.sequence} data-expanded={node.expanded}
    data-motion={policy.reduced ? "reduced" : "standard"}
    style={{ "--selection-duration": `${policy.selectionDurationMs}ms` } as CSSProperties}
    onClick={() => props.onSelect(active.eventId)} onKeyDown={(event) => {
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        setCursor({ context, index: (index + (event.key === "ArrowRight" ? 1 : actions.length - 1)) % actions.length });
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); actions[index]!.invoke();
      } else props.onKeyDown(event);
    }}>
    <span className="execution-node__marker" aria-hidden="true">{primary.sequence}</span>
    <article className="execution-node__card">
      <header><span>{primary.presentationClass === "recorder_recovery" ? "Recorder recovery" : primary.kind}</span><span>{eventStatus(primary)}</span></header>
      <p>{node.type === "routine_cluster" ? `${node.events.length} routine ${primary.presentationClass} events` : primary.safeSummary || "No safe summary available."}</p>
      <footer>{provenanceLabels[primary.provenance]}{node.type === "lifecycle_group" ? ` · ${node.events.length} lifecycle events` : ""}</footer>
      {node.expanded && <div className="execution-node__members">{node.events.map((event) => <section
        key={event.eventId} data-lifecycle-member={node.type === "lifecycle_group" ? event.eventId : undefined}
        data-cluster-member={node.type === "routine_cluster" ? event.eventId : undefined}
        onClick={(click) => { click.stopPropagation(); props.onSelect(event.eventId); }}>
        <small>#{event.sequence} · {eventStatus(event)}</small><p>{event.safeSummary}</p>
      </section>)}</div>}
      {primary.presentationClass === "unknown" && <small>Unsupported event kind · detail unavailable</small>}
    </article>
  </div>;
}
