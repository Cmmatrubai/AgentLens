import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { projectTrajectory } from "./projectTrajectory.js";
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
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const anchorRef = useRef<Readonly<{ key: string; offset: number }> | null>(null);
  const selectedIndex = rows.findIndex((row) => row.type === "event"
    ? row.event.eventId === props.selectedEventId
    : row.events.some(({ eventId }) => eventId === props.selectedEventId));
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, selectedIndex));
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 144,
    overscan: 3,
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
    for (const item of virtualItems) {
      const row = rows[item.index]!;
      if (row.type === "event") ids.add(row.event.eventId);
      else for (const event of row.events) ids.add(event.eventId);
    }
    return ids;
  }, [rows, virtualItems]);
  const selected = props.events.find(({ eventId }) => eventId === props.selectedEventId) ?? null;

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null || scrollRef.current === null) return;
    const index = rows.findIndex(({ key }) => key === anchor.key);
    if (index === -1) return;
    const offset = virtualizer.getOffsetForIndex(index, "start")?.[0];
    if (offset !== undefined) {
      virtualizer.scrollToOffset(offset - anchor.offset);
    }
  }, [rows, virtualizer]);

  useEffect(() => {
    const first = virtualItems[0];
    if (first === undefined || scrollRef.current === null) return;
    anchorRef.current = {
      key: rows[first.index]!.key,
      offset: first.start - scrollRef.current.scrollTop
    };
    if (!virtualItems.some(({ index }) => index === focusIndex)) setFocusIndex(first.index);
  }, [focusIndex, rows, virtualItems]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    setFocusIndex(selectedIndex);
    virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  const focus = (index: number): void => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    setFocusIndex(bounded);
    virtualizer.scrollToIndex(bounded, { align: "auto" });
    const mounted = rowRefs.current.get(bounded);
    if (mounted !== undefined) mounted.focus();
    else requestAnimationFrame(() => rowRefs.current.get(bounded)?.focus());
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
      <div className="trajectory-stage" style={{ height: virtualizer.getTotalSize() }}>
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
                  if (element === null) rowRefs.current.delete(item.index);
                  else {
                    rowRefs.current.set(item.index, element);
                    virtualizer.measureElement(element);
                  }
                }}
                onSelect={props.onSelect}
                onExpandGroup={(key) => props.onExpandGroup?.(key)}
                onRelationshipJump={props.onRelationshipJump}
                visibleEventIds={visibleEventIds}
                onKeyDown={(keyboard) => {
                  if (keyboard.key === "ArrowDown" || keyboard.key === "ArrowUp" ||
                      keyboard.key === "Home" || keyboard.key === "End") {
                    keyboard.preventDefault();
                    if (keyboard.key === "ArrowDown") focus(item.index + 1);
                    if (keyboard.key === "ArrowUp") focus(item.index - 1);
                    if (keyboard.key === "Home") focus(0);
                    if (keyboard.key === "End") focus(rows.length - 1);
                  } else if (keyboard.key === "Enter" || keyboard.key === " ") {
                    keyboard.preventDefault();
                    props.onSelect(primary.eventId);
                  } else if (keyboard.key === "Escape") {
                    keyboard.preventDefault();
                    props.onEscapeDeepEvidence();
                  }
                }}
              />
            </div>
          );
        })}
        <RelationshipOverlay selected={selected} visibleEventIds={visibleEventIds} />
      </div>
    </div>
  );
}
