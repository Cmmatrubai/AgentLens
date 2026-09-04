import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { findTrajectoryRowIndex, projectTrajectory } from "./projectTrajectory.js";
import { RelationshipOverlay } from "./RelationshipOverlay.js";
import { TrajectoryRow } from "./TrajectoryRow.js";
import { useFollowTail } from "./useFollowTail.js";
import type { LiveTrajectoryAppend } from "./useTrajectoryPages.js";

import type { TrajectoryEventV1 } from "@agentlens/api-contract";

const COMPACT_ROW_ESTIMATE = 68;

export function Trajectory(props: Readonly<{
  events: readonly TrajectoryEventV1[];
  runId?: string;
  liveAppend?: LiveTrajectoryAppend;
  selectedEventId: string | null;
  expandedGroupKeys: ReadonlySet<string>;
  onSelect: (eventId: string) => void;
  onEscapeDeepEvidence: () => void;
  onRelationshipJump: (eventId: string) => void;
  onExpandGroup?: (groupKey: string) => void;
  inlineEvidence?: ReactNode;
}>) {
  const rows = useMemo(() => projectTrajectory({
    events: props.events,
    expandedGroupKeys: props.expandedGroupKeys
  }), [props.events, props.expandedGroupKeys]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const eventRowRefs = useRef(new Map<string, HTMLDivElement>());
  const anchorRef = useRef<Readonly<{ eventId: string; offset: number }> | null>(null);
  const inlineEvidenceRef = useRef<HTMLDivElement>(null);
  const [inlineEvidenceHeight, setInlineEvidenceHeight] = useState(0);
  const [selectedRowHeight, setSelectedRowHeight] = useState(COMPACT_ROW_ESTIMATE);
  const pendingFocusRef = useRef<Readonly<{
    index: number;
    onFocused?: () => void;
  }> | null>(null);
  const selectedIndex = rows.findIndex((row) => row.type === "event"
    ? row.event.eventId === props.selectedEventId
    : row.events.some(({ eventId }) => eventId === props.selectedEventId));
  const selectedNeedsInlineEvidence = props.inlineEvidence !== undefined && props.inlineEvidence !== null;
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, selectedIndex));
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COMPACT_ROW_ESTIMATE,
    overscan: 3,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusIndex >= 0 && focusIndex < rows.length && !indexes.includes(focusIndex)) {
        indexes.push(focusIndex);
      }
      if (selectedNeedsInlineEvidence && selectedIndex >= 0 && !indexes.includes(selectedIndex)) {
        indexes.push(selectedIndex);
      }
      indexes.sort((left, right) => left - right);
      return indexes;
    },
    getItemKey: (index) => rows[index]!.key,
    measureElement: (element) => element.getBoundingClientRect().height || COMPACT_ROW_ESTIMATE,
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (element === null) return () => undefined;
      const publish = (): void => {
        const rect = element.getBoundingClientRect();
        callback({ width: rect.width || 800, height: rect.height || 520 });
      };
      publish();
      if (typeof ResizeObserver === "undefined") return () => undefined;
      const observer = new ResizeObserver(publish);
      observer.observe(element);
      return () => observer.disconnect();
    },
    initialRect: { width: 800, height: 520 }
  });
  const virtualItems = virtualizer.getVirtualItems();
  const selectedVirtualItem = selectedIndex < 0
    ? undefined
    : virtualItems.find(({ index }) => index === selectedIndex);
  const visibleEventIds = useMemo(() => {
    const ids = new Set<string>();
    const viewportStart = virtualizer.scrollOffset ?? 0;
    const viewportEnd = viewportStart + (scrollRef.current?.clientHeight || 520);
    for (const item of virtualItems) {
      if (item.end <= viewportStart || item.start >= viewportEnd) continue;
      const row = rows[item.index]!;
      if (row.type === "event") ids.add(row.event.eventId);
      else for (const event of row.events) ids.add(event.eventId);
    }
    return ids;
  }, [rows, virtualItems, virtualizer.scrollOffset]);
  const selected = props.events.find(({ eventId }) => eventId === props.selectedEventId) ?? null;
  const scrollToLatest = useCallback((): void => {
    if (rows.length === 0) return;
    virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
  }, [rows.length, virtualizer]);
  const runId = props.runId ?? props.events[0]?.runId ?? "";
  const followTail = useFollowTail({
    runId,
    liveAppend: props.liveAppend ?? { runId, revision: 0, identities: [] },
    onFollowTail: scrollToLatest
  });

  useLayoutEffect(() => {
    const element = inlineEvidenceRef.current;
    if (element === null) {
      setInlineEvidenceHeight(0);
      return;
    }
    const publish = (): void => {
      const next = Math.ceil(element.getBoundingClientRect().height);
      setInlineEvidenceHeight((current) => current === next ? current : next);
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.inlineEvidence, props.selectedEventId]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null || scrollRef.current === null) return;
    const index = findTrajectoryRowIndex(rows, anchor.eventId);
    if (index === -1) return;
    const offset = virtualizer.getOffsetForIndex(index, "start")?.[0];
    if (offset !== undefined) {
      virtualizer.scrollToOffset(offset - anchor.offset);
    }
  }, [rows, virtualizer]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport === null) return;
    const viewportStart = viewport.scrollTop;
    const viewportEnd = viewportStart + (viewport.clientHeight || 520);
    const first = virtualItems.find((item) => item.end > viewportStart && item.start < viewportEnd);
    if (first === undefined) return;
    const firstRow = rows[first.index]!;
    anchorRef.current = {
      eventId: firstRow.type === "event"
        ? firstRow.event.eventId
        : firstRow.events[0]!.eventId,
      offset: first.start - viewportStart
    };
    const focusInside = viewport.contains(document.activeElement);
    if (pendingFocusRef.current === null && !focusInside && first.index !== focusIndex) {
      setFocusIndex(first.index);
    }
  }, [focusIndex, rows, virtualItems]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    setFocusIndex(selectedIndex);
    virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    const mounted = rowRefs.current.get(pending.index);
    if (mounted === undefined || mounted.tabIndex !== 0) return;
    mounted.focus();
    if (document.activeElement !== mounted) return;
    pendingFocusRef.current = null;
    pending.onFocused?.();
  }, [focusIndex, virtualItems]);

  const focus = (index: number, onFocused?: () => void): void => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    const request = { index: bounded, ...(onFocused === undefined ? {} : { onFocused }) };
    pendingFocusRef.current = request;
    setFocusIndex(bounded);
    virtualizer.scrollToIndex(bounded, { align: "auto" });
  };

  if (rows.length === 0) {
    return <section className="trajectory-empty">No trajectory events are available for this run.</section>;
  }
  return (
    <section className="trajectory-shell" aria-label="Live execution trajectory">
      {followTail.newEventCount > 0 && (
        <div className="trajectory-new-events">
          <button type="button" onClick={() => {
            const latest = props.events.at(-1);
            if (latest !== undefined) {
              const latestIndex = findTrajectoryRowIndex(rows, latest.eventId);
              if (latestIndex !== -1) focus(latestIndex, followTail.jumpToLatest);
              props.onSelect(latest.eventId);
            }
          }}>
            {followTail.newEventCount} new {followTail.newEventCount === 1 ? "event" : "events"}
          </button>
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {followTail.newEventCount} new {followTail.newEventCount === 1 ? "event" : "events"} available
          </span>
        </div>
      )}
      <div
        ref={scrollRef}
        className="trajectory-viewport"
        onScroll={(event) => followTail.observeViewport(event.currentTarget)}
      >
        <div
          ref={stageRef}
          className="trajectory-stage"
          role="listbox"
          aria-label="Execution trajectory"
          style={{ height: virtualizer.getTotalSize() }}
        >
        {virtualItems.map((item) => {
          const row = rows[item.index]!;
          const containsSelection = row.type === "event"
            ? row.event.eventId === props.selectedEventId
            : row.events.some(({ eventId }) => eventId === props.selectedEventId);
          return (
            <div
              key={item.key}
              ref={(element) => virtualizer.measureElement(element)}
              className="trajectory-virtual-row"
              data-index={item.index}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <TrajectoryRow
                row={row}
                selectedEventId={props.selectedEventId}
                tabIndex={item.index === focusIndex ? 0 : -1}
                rowRef={(element) => {
                  const eventIds = row.type === "event" ? [row.event.eventId] : row.events.map(({ eventId }) => eventId);
                  if (element === null) {
                    const previous = rowRefs.current.get(item.index);
                    rowRefs.current.delete(item.index);
                    for (const eventId of eventIds) {
                      if (eventRowRefs.current.get(eventId) === previous) eventRowRefs.current.delete(eventId);
                    }
                  }
                  else {
                    rowRefs.current.set(item.index, element);
                    for (const eventId of eventIds) eventRowRefs.current.set(eventId, element);
                    if (containsSelection) {
                      const height = Math.ceil(element.getBoundingClientRect().height) || COMPACT_ROW_ESTIMATE;
                      setSelectedRowHeight((current) => current === height ? current : height);
                    }
                    const pending = pendingFocusRef.current;
                    if (pending?.index === item.index && element.tabIndex === 0) {
                      element.focus();
                      if (document.activeElement === element) {
                        pendingFocusRef.current = null;
                        pending.onFocused?.();
                      }
                    }
                  }
                }}
                onSelect={props.onSelect}
                onExpandGroup={(key) => props.onExpandGroup?.(key)}
                onRelationshipJump={props.onRelationshipJump}
                onKeyDown={(keyboard) => {
                  if (keyboard.key === "ArrowDown" || keyboard.key === "ArrowUp" ||
                      keyboard.key === "Home" || keyboard.key === "End") {
                    keyboard.preventDefault();
                    if (keyboard.key === "ArrowDown") focus(item.index + 1);
                    if (keyboard.key === "ArrowUp") focus(item.index - 1);
                    if (keyboard.key === "Home") focus(0);
                    if (keyboard.key === "End") focus(rows.length - 1);
                  } else if (keyboard.key === "Escape") {
                    keyboard.preventDefault();
                    props.onEscapeDeepEvidence();
                  }
                }}
              />
              {containsSelection && selectedNeedsInlineEvidence && inlineEvidenceHeight > 0 ? (
                <div
                  className="trajectory-inline-evidence-spacer"
                  aria-hidden="true"
                  style={{ height: inlineEvidenceHeight }}
                />
              ) : null}
            </div>
          );
        })}
          <RelationshipOverlay
            selected={selected}
            visibleEventIds={visibleEventIds}
            rowElements={eventRowRefs.current}
            stageRef={stageRef}
            viewportRef={scrollRef}
            layoutKey={virtualItems.map(({ index, start, size }) => `${index}:${start}:${size}`).join("|")}
          />
        </div>
        {selectedNeedsInlineEvidence && selectedVirtualItem !== undefined ? (
          <div
            ref={inlineEvidenceRef}
            className="trajectory-inline-evidence-anchor"
            data-inline-evidence-anchor-for={props.selectedEventId ?? undefined}
            style={{ transform: `translateY(${selectedVirtualItem.start + selectedRowHeight}px)` }}
          >
            {props.inlineEvidence}
          </div>
        ) : null}
      </div>
    </section>
  );
}
