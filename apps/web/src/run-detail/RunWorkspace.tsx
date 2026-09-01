import type { RunDetailV1, TrajectoryEventV1 } from "@agentlens/api-contract";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { GitEvidenceSummary } from "../evidence/GitEvidenceSummary.js";
import { Trajectory } from "../trajectory/Trajectory.js";
import { DeepEvidencePanel } from "./DeepEvidencePanel.js";
import {
  EventInspector,
  initialEventInspectorSession,
  type EventInspectorSession
} from "./EventInspector.js";

function useNarrowInspector(beforeChange: () => void): boolean {
  const query = "(max-width: 800px)";
  const [narrow, setNarrow] = useState(() =>
    typeof window.matchMedia === "function" && window.matchMedia(query).matches
  );
  const narrowRef = useRef(narrow);
  const beforeChangeRef = useRef(beforeChange);
  beforeChangeRef.current = beforeChange;
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = (): void => {
      if (narrowRef.current === media.matches) return;
      beforeChangeRef.current();
      narrowRef.current = media.matches;
      setNarrow(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function RunWorkspace(props: Readonly<{
  runId: string;
  run?: RunDetailV1;
  events: readonly TrajectoryEventV1[];
  selectedEventId: string | null;
  selectionState: "idle" | "resolving" | "unavailable";
  onSelect: (eventId: string) => void;
}>) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<ReadonlySet<string>>(new Set());
  const [deepEvidenceOpen, setDeepEvidenceOpen] = useState(false);
  const [inspectorSession, setInspectorSession] = useState<EventInspectorSession>(initialEventInspectorSession);
  const focusRestoreRef = useRef<Readonly<{
    id: string;
    text: string;
    tagName: string;
  }> | null>(null);
  const narrow = useNarrowInspector(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) ||
        active.closest(".event-inspector, .git-evidence-summary, .deep-evidence-panel") === null) return;
    focusRestoreRef.current = {
      id: active.id,
      text: active.textContent?.trim() ?? "",
      tagName: active.tagName
    };
  });
  useEffect(() => setExpandedGroupKeys(new Set()), [props.runId]);
  useEffect(() => setDeepEvidenceOpen(false), [props.runId, props.selectedEventId]);
  useEffect(() => setInspectorSession(initialEventInspectorSession), [props.runId, props.selectedEventId]);
  useLayoutEffect(() => {
    const restore = focusRestoreRef.current;
    if (restore === null) return;
    const byId = restore.id.length === 0 ? null : document.getElementById(restore.id);
    const candidate = byId ?? [...document.querySelectorAll<HTMLElement>(restore.tagName)]
      .find((element) => element.textContent?.trim() === restore.text);
    candidate?.focus();
    focusRestoreRef.current = null;
  }, [narrow]);
  const selected = props.events.find(({ eventId }) => eventId === props.selectedEventId) ?? null;
  const inspector = selected === null || props.run === undefined ? null : (
    <>
      <EventInspector
        event={selected}
        runId={props.runId}
        onRelationshipJump={props.onSelect}
        session={inspectorSession}
        onSessionChange={setInspectorSession}
      />
      <GitEvidenceSummary
        runId={props.runId}
        {...(props.run === undefined ? {} : { run: props.run })}
        onOpenDiff={() => setDeepEvidenceOpen(true)}
      />
    </>
  );
  const inlineInspector = narrow && selected !== null ? (
    <section
      className="trajectory-inline-inspector"
      data-testid="inline-event-inspector"
      data-inline-inspector-for={selected.eventId}
      onClick={(event) => event.stopPropagation()}
    >
      {inspector}
      <DeepEvidencePanel runId={props.runId} open={deepEvidenceOpen} onClose={() => setDeepEvidenceOpen(false)} />
    </section>
  ) : null;
  return (
    <div className="run-workspace">
      <Trajectory
        events={props.events}
        selectedEventId={props.selectedEventId}
        expandedGroupKeys={expandedGroupKeys}
        onSelect={props.onSelect}
        onRelationshipJump={props.onSelect}
        onEscapeDeepEvidence={() => setDeepEvidenceOpen(false)}
        inlineEvidence={inlineInspector}
        onExpandGroup={(key) => setExpandedGroupKeys((current) => {
          const next = new Set(current);
          next.has(key) ? next.delete(key) : next.add(key);
          return next;
        })}
      />
      {!narrow && <aside className="trajectory-inspector" aria-label="Selected evidence inspector">
        {props.selectionState === "resolving" && <p role="status">Resolving selected event…</p>}
        {props.selectionState === "unavailable" && (
          <p role="alert">The selected event is unavailable in this run.</p>
        )}
        {props.selectionState === "idle" && selected === null && (
          <p>Select a trajectory row to inspect its bounded evidence.</p>
        )}
        {inspector}
      </aside>}
      {!narrow && props.run !== undefined && (
        <DeepEvidencePanel runId={props.runId} open={deepEvidenceOpen} onClose={() => setDeepEvidenceOpen(false)} />
      )}
    </div>
  );
}
