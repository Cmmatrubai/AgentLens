import type {
  EventDetailV1,
  NormalizedContentResponseV1,
  TrajectoryEventV1
} from "@agentlens/api-contract";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AgentLensClientError } from "../api/client.js";
import {
  useAssessmentNoteQuery,
  useEventContentQuery,
  useEventDetailQuery,
  useEventNativeQuery
} from "../api/evidenceQueries.js";
import { AvailabilityNotice, type AvailabilityState } from "../evidence/AvailabilityNotice.js";
import { CommandEvidence } from "../evidence/CommandEvidence.js";
import { NativeEvidence } from "../evidence/NativeEvidence.js";
import { TextEvidence } from "../evidence/TextEvidence.js";
import { InspectorTabs, type InspectorTab, type InspectorTabId } from "./InspectorTabs.js";

function requestFailure(error: unknown): AvailabilityState {
  if (error instanceof AgentLensClientError) {
    if (error.code === "evidence_binding_mismatch") return "corrupt";
    if (error.code === "content_unavailable") return "not_captured";
  }
  return "artifact_unreadable";
}

function contentText(response: NormalizedContentResponseV1): Readonly<{ title: string; text: string }> | null {
  const content = response.content;
  switch (content.kind) {
    case "message": return { title: `Redacted ${content.role} message`, text: content.text };
    case "reasoning": return { title: "Redacted reasoning", text: content.text };
    case "command": return { title: "Redacted command", text: content.command };
    case "command_output": return { title: "Redacted command output", text: content.output };
    case "command_evidence": return null;
    case "file_change": return {
      title: "Redacted file-change evidence",
      text: content.changes.map(({ kind, path }) => `${kind}\t${path}`).join("\n")
    };
    case "tool": return {
      title: `Redacted ${content.name} evidence`,
      text: [content.input, content.result].filter((value): value is string => value !== undefined).join("\n")
    };
    case "plan": return {
      title: "Redacted plan evidence",
      text: content.items.map(({ status, text }) => `${status}\t${text}`).join("\n")
    };
    case "git": return { title: `Redacted Git ${content.section.replaceAll("_", " ")}`, text: content.text };
    case "recorder": return { title: `Recorder ${content.diagnosticClass}`, text: content.message };
    case "test": return { title: "Derived likely-test evidence", text: `${content.family}: ${content.outcome}` };
    case "assessment": return {
      title: "Human assessment evidence",
      text: `${content.verdict}\nTask completed: ${content.taskCompleted}${content.note === undefined ? "" : `\n${content.note}`}`
    };
    case "error": return { title: `Redacted ${content.errorClass}`, text: content.message };
  }
}

function DetailFacts({ detail }: Readonly<{ detail: EventDetailV1 }>) {
  return (
    <dl className="evidence-facts">
      <div><dt>Event</dt><dd>{detail.eventId}</dd></div>
      <div><dt>Sequence</dt><dd>{detail.sequence}</dd></div>
      <div><dt>Kind</dt><dd>{detail.kind}</dd></div>
      <div><dt>Provenance</dt><dd>{detail.provenance.replaceAll("_", " ")}</dd></div>
    </dl>
  );
}

function AssessmentFacts({ detail }: Readonly<{
  detail: Extract<EventDetailV1, { presentationClass: "assessment" }>;
}>) {
  const note = detail.note.state === "unavailable"
    ? `unavailable · ${detail.note.reason.replaceAll("_", " ")}`
    : detail.note.state;
  return (
    <dl className="evidence-facts assessment-evidence-facts">
      <div><dt>Reviewer</dt><dd>Reviewer: {detail.verdict}</dd></div>
      <div><dt>Task completion</dt><dd>Task completed: {detail.taskCompleted}</dd></div>
      <div><dt>Reviewer note</dt><dd>Reviewer note: {note}</dd></div>
    </dl>
  );
}

export function EventInspector(props: Readonly<{
  event: TrajectoryEventV1;
  runId: string;
  onRelationshipJump: (eventId: string) => void;
  session?: EventInspectorSession;
  onSessionChange?: (session: EventInspectorSession) => void;
}>) {
  const idPrefix = useId().replaceAll(":", "");
  const eligibleNative = props.event.provenance === "observed" &&
    props.event.nativePayload.state === "available";
  const [internalSession, setInternalSession] = useState<EventInspectorSession>(initialEventInspectorSession);
  const identity = `${props.runId}:${props.event.eventId}`;
  const suppliedSession = props.session ?? internalSession;
  const session = suppliedSession.identity === identity ? suppliedSession : initialEventInspectorSession;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const updateSession = (patch: Partial<EventInspectorSession>): void => {
    const next = { ...sessionRef.current, ...patch, identity };
    sessionRef.current = next;
    setInternalSession(next);
    props.onSessionChange?.(next);
  };
  useEffect(() => {
    if (!eligibleNative && session.selectedTab === "provider") updateSession({ selectedTab: "evidence" });
  }, [eligibleNative, session.selectedTab]);

  const detail = useEventDetailQuery(
    props.runId,
    props.event.eventId,
    props.event.detail.state === "available"
  );
  const content = useEventContentQuery(props.runId, props.event.eventId, session.contentRequested);
  const native = useEventNativeQuery(props.runId, props.event.eventId, eligibleNative && session.nativeRequested);
  const note = useAssessmentNoteQuery(props.runId, props.event.eventId, session.noteRequested);
  const tabs = useMemo<readonly InspectorTab[]>(() => [
    { id: "evidence", label: "Evidence" },
    { id: "relationships", label: "Relationships" },
    ...(eligibleNative ? [{ id: "provider" as const, label: "Redacted provider payload" }] : [])
  ], [eligibleNative]);

  const chooseTab = (tab: InspectorTabId): void => {
    updateSession({ selectedTab: tab, ...(tab === "provider" ? { nativeRequested: true } : {}) });
  };

  return (
    <section className="event-inspector" aria-labelledby={`${idPrefix}-title`}>
      <p className="page-eyebrow">Selected evidence</p>
      <h2 id={`${idPrefix}-title`}>Event inspector</h2>
      <p className="event-inspector__summary">{props.event.safeSummary || "No safe summary available."}</p>
      <InspectorTabs idPrefix={idPrefix} tabs={tabs} selected={session.selectedTab} onSelect={chooseTab} />
      {session.selectedTab === "evidence" && (
        <div
          role="tabpanel"
          aria-label="Evidence"
          aria-labelledby={`${idPrefix}-tab-evidence`}
          id={`${idPrefix}-panel-evidence`}
        >
          {props.event.detail.state === "unavailable" && <AvailabilityNotice state="unsupported_kind" />}
          {detail.isPending && props.event.detail.state === "available" && <p>Loading bounded event detail…</p>}
          {detail.isError && <AvailabilityNotice state={requestFailure(detail.error)} />}
          {detail.data !== undefined && (
            <>
              <DetailFacts detail={detail.data} />
              {detail.data.presentationClass === "assessment" && <AssessmentFacts detail={detail.data} />}
              {detail.data.presentationClass === "command" ? (
                <CommandEvidence
                  detail={detail.data}
                  content={content.data ?? null}
                  requestState={content.isError ? "error" : content.isFetching ? "loading" :
                    content.data === undefined ? "idle" : "loaded"}
                  requestError={content.isError ? requestFailure(content.error) : null}
                  onRequestContent={() => updateSession({ contentRequested: true })}
                />
              ) : (
                <GeneralEvidence
                  detail={detail.data}
                  content={content.data ?? null}
                  contentError={content.isError ? requestFailure(content.error) : null}
                  contentLoading={content.isFetching}
                  onRequestContent={() => updateSession({ contentRequested: true })}
                />
              )}
              {detail.data.presentationClass === "assessment" && detail.data.note.state === "available" && (
                <section className="assessment-note-evidence">
                  {note.data === undefined && !note.isError && (
                    <button type="button" onClick={() => updateSession({ noteRequested: true })} disabled={note.isFetching}>
                      {note.isFetching ? "Loading assessment note…" : "Load assessment note"}
                    </button>
                  )}
                  {note.isError && <AvailabilityNotice state={requestFailure(note.error)} />}
                  {note.data !== undefined && <TextEvidence title="Redacted assessment note" text={note.data.content} />}
                </section>
              )}
            </>
          )}
        </div>
      )}
      {session.selectedTab === "relationships" && (
        <div
          role="tabpanel"
          aria-label="Relationships"
          aria-labelledby={`${idPrefix}-tab-relationships`}
          id={`${idPrefix}-panel-relationships`}
        >
          <dl className="evidence-facts">
            <div><dt>Opaque source group</dt><dd>{props.event.source.opaqueRef}</dd></div>
            <div><dt>Session or thread dimension</dt><dd>{props.event.source.hasSessionOrThread ? "Present" : "Absent"}</dd></div>
            <div><dt>Turn dimension</dt><dd>{props.event.source.hasTurn ? "Present" : "Absent"}</dd></div>
            <div><dt>Item or tool dimension</dt><dd>{props.event.source.hasItemOrTool ? "Present" : "Absent"}</dd></div>
            <div><dt>Correlation dimension</dt><dd>{props.event.source.hasCorrelation ? "Present" : "Absent"}</dd></div>
          </dl>
          {props.event.relationships.length === 0 ? <p>No exact AgentLens relationships are recorded.</p> : (
            <ul className="event-relationships">
              {props.event.relationships.map((relationship, index) => (
                <li key={`${relationship.type}:${relationship.eventId}:${index}`}>
                  <code>{relationship.type}</code> · <code>{relationship.eventId}</code>
                  <button type="button" onClick={() => props.onRelationshipJump(relationship.eventId)}>
                    Jump to {relationship.type.replaceAll("_", " ")} event {relationship.eventId}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {session.selectedTab === "provider" && eligibleNative && (
        <div
          role="tabpanel"
          aria-label="Redacted provider payload"
          aria-labelledby={`${idPrefix}-tab-provider`}
          id={`${idPrefix}-panel-provider`}
        >
          {native.isPending && <p>Loading redacted provider payload…</p>}
          {native.isError && <AvailabilityNotice state={requestFailure(native.error)} />}
          {native.data !== undefined && <NativeEvidence response={native.data} />}
        </div>
      )}
    </section>
  );
}

export interface EventInspectorSession {
  readonly identity: string | null;
  readonly selectedTab: InspectorTabId;
  readonly contentRequested: boolean;
  readonly nativeRequested: boolean;
  readonly noteRequested: boolean;
}

export const initialEventInspectorSession: EventInspectorSession = Object.freeze({
  identity: null,
  selectedTab: "evidence",
  contentRequested: false,
  nativeRequested: false,
  noteRequested: false
});

function GeneralEvidence(props: Readonly<{
  detail: EventDetailV1;
  content: NormalizedContentResponseV1 | null;
  contentError: AvailabilityState | null;
  contentLoading: boolean;
  onRequestContent: () => void;
}>) {
  if (!("content" in props.detail)) return <AvailabilityNotice state="unsupported_kind" />;
  if (props.content !== null) {
    const projected = contentText(props.content);
    return projected === null
      ? <AvailabilityNotice state="unsupported_kind" />
      : <TextEvidence title={projected.title} text={projected.text} />;
  }
  if (props.contentError !== null) return <AvailabilityNotice state={props.contentError} />;
  if (props.detail.content.state === "unavailable") {
    return <AvailabilityNotice state={props.detail.content.reason} />;
  }
  return (
    <button type="button" onClick={props.onRequestContent} disabled={props.contentLoading}>
      {props.contentLoading ? "Loading normalized content…" : "Load normalized content"}
    </button>
  );
}
