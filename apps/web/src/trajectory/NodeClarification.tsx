import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { motion } from "motion/react";
import { useMotionPolicy } from "../motion/motionPolicy.js";
import { eventStatus, provenanceLabels } from "./ExecutionNode.js";
import type { ExecutionGraphEdge, ExecutionGraphNode } from "./graphTypes.js";

export function NodeClarification(props: Readonly<{
  event: TrajectoryEventV1; node: ExecutionGraphNode; edges: readonly ExecutionGraphEdge[];
  onSelect: (id: string) => void; onExpand: (key: string) => void; onRelationshipJump: (id: string) => void;
  onFocusInspector?: (() => void) | undefined;
}>) {
  const policy = useMotionPolicy();
  const { event, node } = props;
  return <motion.section className="node-clarification" aria-label="Node clarification"
    key={event.eventId} initial={{ opacity: policy.reduced ? 1 : 0 }} animate={{ opacity: 1 }}
    transition={policy.inspector} data-motion={policy.reduced ? "reduced" : "standard"}>
    <span className="node-clarification__eyebrow">Selected evidence · #{event.sequence}</span>
    <h3>{event.safeSummary || "No safe summary available."}</h3>
    <dl><div><dt>Kind</dt><dd>{event.kind}</dd></div><div><dt>Status</dt><dd>{eventStatus(event)}</dd></div>
      <div><dt>Provenance</dt><dd>{provenanceLabels[event.provenance]}</dd></div><div><dt>Sequence</dt><dd>{event.sequence}</dd></div></dl>
    <div className="node-clarification__times"><span>Recorder time <time dateTime={event.receivedAt}>{event.receivedAt}</time></span>
      <span>{event.sourceOccurredAt.state === "available" ? <>Provider time <time dateTime={event.sourceOccurredAt.value}>{event.sourceOccurredAt.value}</time></> : "Provider time unavailable · not captured"}</span></div>
    {node.type !== "event" && <div className="node-clarification__actions" aria-label="Immutable group members">
      {node.events.map((member) => <button type="button" key={member.eventId} onClick={() => props.onSelect(member.eventId)}
        aria-pressed={member.eventId === event.eventId}>Select immutable event {member.eventId} · #{member.sequence}</button>)}
      <button type="button" data-row-action="expand" aria-expanded={node.expanded} onClick={() => props.onExpand(node.key)}>{node.expanded ? "Collapse" : "Expand"} {node.type === "lifecycle_group" ? "lifecycle" : "routine"} events</button>
    </div>}
    {props.edges.length > 0 && <div className="node-clarification__actions" aria-label="Recorded relationships">{props.edges.map((edge) => {
      const outgoing = edge.sourceEventId === event.eventId;
      const target = outgoing ? edge.targetEventId : edge.sourceEventId;
      return <button type="button" key={edge.key} data-row-action="relationship" onClick={() => props.onRelationshipJump(target)}>
        {outgoing ? "Jump to" : "Incoming"} {edge.type.replaceAll("_", " ")} event {target}{edge.targetNodeIndex === null ? " · not loaded" : ""}
      </button>;
    })}</div>}
    {props.onFocusInspector && <button type="button" className="node-clarification__inspect" onClick={props.onFocusInspector}>Focus evidence inspector →</button>}
  </motion.section>;
}
