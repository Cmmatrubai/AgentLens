import type { TrajectoryEventV1 } from "@agentlens/api-contract";
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
  visibleEventIds: ReadonlySet<string>;
}>) {
  const events = props.row.type === "event" ? [props.row.event] : props.row.events;
  const primary = events.at(-1)!;
  const selected = events.some(({ eventId }) => eventId === props.selectedEventId);
  const relationshipSource = events.find(({ eventId }) => eventId === props.selectedEventId) ?? primary;
  const presentation = status(primary);
  const offscreenRelationships = selected
    ? uniqueRelationships(relationshipSource.relationships).filter(({ eventId }) => !props.visibleEventIds.has(eventId))
    : [];
  const relatedLabel = offscreenRelationships.length === 0 ? "" :
    ` Related: ${offscreenRelationships.map((relationship) =>
      `${relationship.type.replaceAll("_", " ")} event ${relationship.eventId}`
    ).join("; ")}.`;
  return (
    <div
      ref={props.rowRef}
      role="option"
      aria-selected={selected}
      aria-label={`${primary.safeSummary}. ${provenanceLabels[primary.provenance]}. ${presentation.label}.${relatedLabel}`}
      className={`trajectory-row trajectory-row--${primary.provenance}${selected ? " trajectory-row--selected" : ""}`}
      data-event-id={primary.eventId}
      data-index={primary.sequence}
      tabIndex={props.tabIndex}
      onClick={() => props.onSelect(primary.eventId)}
      onKeyDown={props.onKeyDown}
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
            {props.row.events.map((event) => (
              <button key={event.eventId} type="button" tabIndex={-1} onClick={(click) => {
                click.stopPropagation();
                props.onSelect(event.eventId);
              }}>{event.status.state === "known" ? event.status.value : event.status.safeToken}</button>
            ))}
            <button type="button" tabIndex={-1} onClick={(click) => {
              click.stopPropagation();
              props.onExpandGroup(props.row.key);
            }}>Expand lifecycle events</button>
          </div>
        )}
        {primary.presentationClass === "unknown" && (
          <p className="trajectory-row__unsupported">Unsupported event kind · detail unavailable</p>
        )}
        {offscreenRelationships.length > 0 && (
          <div className="trajectory-row__relationships" aria-label="Off-screen relationships">
            {offscreenRelationships.map((relationship) => (
              <button
                key={`${relationship.type}:${relationship.eventId}`}
                type="button"
                tabIndex={-1}
                onClick={(click) => {
                  click.stopPropagation();
                  props.onRelationshipJump(relationship.eventId);
                }}
              >Jump to {relationship.type.replaceAll("_", " ")} event {relationship.eventId}</button>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
