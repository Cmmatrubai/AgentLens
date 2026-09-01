import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { findTrajectoryRowIndex, projectTrajectory } from "./projectTrajectory.js";
import { RelationshipOverlay } from "./RelationshipOverlay.js";
import { TrajectoryRow } from "./TrajectoryRow.js";

import type { TrajectoryEventV1 } from "@agentlens/api-contract";

export function Trajectory(props: Readonly<{
  events: readonly TrajectoryEventV1[];
  selectedEventId: string | null;
  expandedGroupKeys: ReadonlySet<string>;
  onSelect: (eventId: string) => void;
  onEscapeDeepEvidence: () => void;
  onRelationshipJump: (eventId: string) => void;
  onExpandGroup?: (groupKey: string) => void;
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
  const pendingFocusRef = useRef<number | null>(null);
  const selectedIndex = rows.findIndex((row) => row.type === "event"
    ? row.event.eventId === props.selectedEventId
    : row.events.some(({ eventId }) => eventId === props.selectedEventId));
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, selectedIndex));
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 144,
    overscan: 3,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (pendingFocusRef.current !== null && focusIndex >= 0 && focusIndex < rows.length &&
          !indexes.includes(focusIndex)) {
        indexes.push(focusIndex);
        indexes.sort((left, right) => left - right);
      }
      return indexes;
    },
    getItemKey: (index) => rows[index]!.key,
    measureElement: (element) => element.getBoundingClientRect().height || 144,
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
    const mounted = rowRefs.current.get(pending);
    if (mounted === undefined || mounted.tabIndex !== 0) return;
    mounted.focus();
    pendingFocusRef.current = null;
  }, [focusIndex, virtualItems]);

  const focus = (index: number): void => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    pendingFocusRef.current = bounded;
    setFocusIndex(bounded);
    virtualizer.scrollToIndex(bounded, { align: "auto" });
  };

  if (rows.length === 0) {
    return <section className="trajectory-empty" role="status">No trajectory events are available for this run.</section>;
  }
  return (
    <div
      ref={scrollRef}
      className="trajectory-viewport"
      role="listbox"
      aria-label="Execution trajectory"
    >
      <div ref={stageRef} className="trajectory-stage" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((item) => {
          const row = rows[item.index]!;
          const primary = row.type === "event" ? row.event : row.events.at(-1)!;
          return (
            <div
              key={item.key}
              className="trajectory-virtual-row"
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
                    virtualizer.measureElement(element);
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
    </div>
  );
}
