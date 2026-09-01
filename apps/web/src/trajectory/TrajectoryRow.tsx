import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { useEffect, useState } from "react";
import type { KeyboardEvent, Ref } from "react";

import { uniqueRelationships } from "./relationships.js";
import type { TrajectoryLayoutRow } from "./types.js";

const provenanceLabels = {
  observed: "Observed evidence",
  derived: "Derived evidence",
  git_recovered: "Git-recovered evidence",
  recorder: "Recorder evidence",
  human: "Human evidence"
} as const;

const statusLabels = {
  in_progress: { glyph: "◌", label: "In progress" },
  completed: { glyph: "✓", label: "Completed" },
  failed: { glyph: "×", label: "Failed" },
  declined: { glyph: "−", label: "Declined" },
  interrupted: { glyph: "■", label: "Interrupted" },
  unknown: { glyph: "?", label: "Unknown" }
} as const;

function status(event: TrajectoryEventV1): Readonly<{ glyph: string; label: string }> {
  return event.status.state === "known"
    ? statusLabels[event.status.value]
    : { glyph: "?", label: `Unsupported status: ${event.status.safeToken}` };
}

function timeLabel(event: TrajectoryEventV1) {
  return (
    <div className="trajectory-row__times">
      <span>Recorder time <time dateTime={event.receivedAt}>{event.receivedAt}</time></span>
      <span>{event.sourceOccurredAt.state === "available"
        ? <>Provider time <time dateTime={event.sourceOccurredAt.value}>{event.sourceOccurredAt.value}</time></>
        : "Provider time unavailable · not captured"}</span>
    </div>
  );
}

export function TrajectoryRow(props: Readonly<{
  row: TrajectoryLayoutRow;
  selectedEventId: string | null;
  tabIndex: number;
  rowRef: Ref<HTMLDivElement>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSelect: (eventId: string) => void;
  onExpandGroup: (groupKey: string) => void;
  onRelationshipJump: (eventId: string) => void;
}>) {
  const events = props.row.type === "event" ? [props.row.event] : props.row.events;
  const primary = events.at(-1)!;
  const selected = events.some(({ eventId }) => eventId === props.selectedEventId);
  const relationshipSource = events.find(({ eventId }) => eventId === props.selectedEventId) ?? primary;
  const presentation = status(primary);
  const relationships = selected ? uniqueRelationships(relationshipSource.relationships) : [];
  const actions: Array<Readonly<{
    kind: "select" | "expand" | "relationship";
    label: string;
    invoke: () => void;
  }>> = [{
    kind: "select",
    label: `Select event ${primary.eventId}`,
    invoke: () => props.onSelect(primary.eventId)
  }];
  if (props.row.type === "lifecycle_group") {
    for (const event of props.row.events) {
      if (event.eventId === primary.eventId) continue;
      actions.push({
        kind: "select",
        label: `Select immutable event ${event.eventId}`,
        invoke: () => props.onSelect(event.eventId)
      });
    }
    actions.push({
      kind: "expand",
      label: "Expand lifecycle events",
      invoke: () => props.onExpandGroup(props.row.key)
    });
  }
  for (const relationship of relationships) {
    actions.push({
      kind: "relationship",
      label: `Jump to ${relationship.type.replaceAll("_", " ")} event ${relationship.eventId}`,
      invoke: () => props.onRelationshipJump(relationship.eventId)
    });
  }
  const [actionIndex, setActionIndex] = useState(0);
  useEffect(() => setActionIndex(0), [props.row.key, props.selectedEventId]);
  const currentAction = actions[Math.min(actionIndex, actions.length - 1)]!;
  const actionLabel = actions.length <= 1 ? "" :
    ` Use Left and Right Arrow to choose a row action. Actions: ${actions.map(({ label }) => label).join("; ")}. Current action: ${currentAction.label}.`;
  return (
    <div
      ref={props.rowRef}
      role="option"
      aria-selected={selected}
      aria-label={`${primary.safeSummary}. ${provenanceLabels[primary.provenance]}. ${presentation.label}.${actionLabel}`}
      aria-keyshortcuts={actions.length > 1 ? "ArrowLeft ArrowRight Enter Space" : "Enter Space"}
      className={`trajectory-row trajectory-row--${primary.provenance}${selected ? " trajectory-row--selected" : ""}`}
      data-event-id={primary.eventId}
      data-index={primary.sequence}
      tabIndex={props.tabIndex}
      onClick={() => props.onSelect(primary.eventId)}
      onKeyDown={(keyboard) => {
        if ((keyboard.key === "ArrowLeft" || keyboard.key === "ArrowRight") && actions.length > 1) {
          keyboard.preventDefault();
          keyboard.stopPropagation();
          setActionIndex((current) => keyboard.key === "ArrowRight"
            ? (current + 1) % actions.length
            : (current - 1 + actions.length) % actions.length);
          return;
        }
        if (keyboard.key === "Enter" || keyboard.key === " ") {
          keyboard.preventDefault();
          keyboard.stopPropagation();
          currentAction.invoke();
          return;
        }
        props.onKeyDown(keyboard);
      }}
    >
      <span className="trajectory-row__gutter">
        <span aria-hidden="true" className="trajectory-row__shape" />
        <span>{provenanceLabels[primary.provenance]}</span>
      </span>
      <span aria-hidden="true" className="trajectory-row__spine-node" />
      <article className="trajectory-row__card">
        <header>
          <span className="trajectory-row__kind">{primary.presentationClass === "recorder_recovery" ? "Recorder recovery" : primary.kind}</span>
          <span className="trajectory-row__status"><span aria-hidden="true">{presentation.glyph}</span> {presentation.label}</span>
        </header>
        <p>{primary.safeSummary || "No safe summary available."}</p>
        {timeLabel(primary)}
        {props.row.type === "lifecycle_group" && (
          <div className="trajectory-row__group">
            <span>{props.row.events.length} immutable lifecycle events</span>
            {actions.filter(({ kind }) => kind === "select").map((action) => (
              <span
                aria-hidden="true"
                className="trajectory-row__action"
                data-row-action="select"
                key={action.label}
                onClick={(click) => { click.stopPropagation(); action.invoke(); }}
              >{action.label}</span>
            ))}
            <span
              aria-hidden="true"
              className="trajectory-row__action"
              data-row-action="expand"
              onClick={(click) => { click.stopPropagation(); props.onExpandGroup(props.row.key); }}
            >Expand lifecycle events</span>
          </div>
        )}
        {primary.presentationClass === "unknown" && (
          <p className="trajectory-row__unsupported">Unsupported event kind · detail unavailable</p>
        )}
        {relationships.length > 0 && (
          <div className="trajectory-row__relationships" aria-hidden="true">
            {actions.filter(({ kind }) => kind === "relationship").map((action) => (
              <span
                className="trajectory-row__action"
                data-row-action="relationship"
                key={action.label}
                onClick={(click) => { click.stopPropagation(); action.invoke(); }}
              >{action.label}</span>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
