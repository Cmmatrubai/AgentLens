import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { useState } from "react";
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

function EventPresentation(props: Readonly<{ event: TrajectoryEventV1 }>) {
  const presentation = status(props.event);
  return (
    <>
      <header>
        <span className="trajectory-row__kind">{props.event.presentationClass === "recorder_recovery"
          ? "Recorder recovery"
          : props.event.kind}</span>
        <span className="trajectory-row__status"><span aria-hidden="true">{presentation.glyph}</span> {presentation.label}</span>
      </header>
      <p>{props.event.safeSummary || "No safe summary available."}</p>
      {timeLabel(props.event)}
    </>
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
  const selectedMember = events.find(({ eventId }) => eventId === props.selectedEventId);
  const activeEvent = selectedMember ?? primary;
  const selected = selectedMember !== undefined;
  const presentation = status(activeEvent);
  const relationships = selected ? uniqueRelationships(activeEvent.relationships) : [];
  const actions: Array<Readonly<{
    kind: "select" | "expand" | "relationship";
    label: string;
    invoke: () => void;
  }>> = [{
    kind: "select",
    label: `Select event ${activeEvent.eventId}`,
    invoke: () => props.onSelect(activeEvent.eventId)
  }];
  if (props.row.type === "lifecycle_group") {
    for (const event of props.row.events) {
      if (event.eventId === activeEvent.eventId) continue;
      actions.push({
        kind: "select",
        label: `Select immutable event ${event.eventId}`,
        invoke: () => props.onSelect(event.eventId)
      });
    }
    actions.push({
      kind: "expand",
      label: props.row.expanded ? "Collapse lifecycle events" : "Expand lifecycle events",
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
  const actionContext = `${props.row.key}:${activeEvent.eventId}`;
  const [actionCursor, setActionCursor] = useState<Readonly<{ context: string; index: number }>>({
    context: actionContext,
    index: 0
  });
  if (actionCursor.context !== actionContext) {
    setActionCursor({ context: actionContext, index: 0 });
  }
  const actionIndex = actionCursor.context === actionContext
    ? Math.min(actionCursor.index, actions.length - 1)
    : 0;
  const currentAction = actions[actionIndex]!;
  const actionLabel = actions.length <= 1 ? "" :
    ` Use Left and Right Arrow to choose a row action. Actions: ${actions.map(({ label }) => label).join("; ")}. Current action: ${currentAction.label}.`;
  return (
    <div
      ref={props.rowRef}
      role="option"
      aria-selected={selected}
      aria-label={`${activeEvent.safeSummary}. ${provenanceLabels[activeEvent.provenance]}. ${presentation.label}.${actionLabel}`}
      aria-keyshortcuts={actions.length > 1 ? "ArrowLeft ArrowRight Enter Space" : "Enter Space"}
      className={`trajectory-row trajectory-row--${activeEvent.provenance}${selected ? " trajectory-row--selected" : ""}`}
      data-event-id={activeEvent.eventId}
      data-expanded={props.row.type === "lifecycle_group" ? props.row.expanded : undefined}
      data-sequence={activeEvent.sequence}
      tabIndex={props.tabIndex}
      onClick={() => props.onSelect(activeEvent.eventId)}
      onKeyDown={(keyboard) => {
        if ((keyboard.key === "ArrowLeft" || keyboard.key === "ArrowRight") && actions.length > 1) {
          keyboard.preventDefault();
          keyboard.stopPropagation();
          setActionCursor({
            context: actionContext,
            index: keyboard.key === "ArrowRight"
              ? (actionIndex + 1) % actions.length
              : (actionIndex - 1 + actions.length) % actions.length
          });
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
        <span>{provenanceLabels[activeEvent.provenance]}</span>
      </span>
      <span aria-hidden="true" className="trajectory-row__spine-node" />
      <article className="trajectory-row__card">
        {props.row.type === "lifecycle_group" && props.row.expanded ? (
          <div className="trajectory-row__members" aria-hidden="true">
            {props.row.events.map((event) => (
              <section
                className={`trajectory-row__member${event.eventId === props.selectedEventId
                  ? " trajectory-row__member--selected"
                  : ""}`}
                data-lifecycle-member={event.eventId}
                data-sequence={event.sequence}
                key={`${event.eventId}:${event.sequence}`}
                onClick={(click) => { click.stopPropagation(); props.onSelect(event.eventId); }}
              >
                <span className="trajectory-row__member-provenance">{provenanceLabels[event.provenance]}</span>
                <EventPresentation event={event} />
              </section>
            ))}
          </div>
        ) : <EventPresentation event={activeEvent} />}
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
            >{props.row.expanded ? "Collapse lifecycle events" : "Expand lifecycle events"}</span>
          </div>
        )}
        {activeEvent.presentationClass === "unknown" && (
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
