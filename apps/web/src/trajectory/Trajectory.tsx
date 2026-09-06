import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { projectExecutionGraph } from "./projectExecutionGraph.js";
import { ExecutionNode } from "./ExecutionNode.js";
import { NodeClarification } from "./NodeClarification.js";
import { ExecutionGraphEdges } from "./ExecutionGraphEdges.js";
import { useFollowTail } from "./useFollowTail.js";
import type { LiveTrajectoryAppend } from "./useTrajectoryPages.js";
import "../styles/execution-graph.css";

export function Trajectory(props: Readonly<{
  events: readonly TrajectoryEventV1[]; runId?: string; liveAppend?: LiveTrajectoryAppend;
  selectedEventId: string | null; expandedGroupKeys: ReadonlySet<string>;
  onSelect: (eventId: string) => void; onEscapeDeepEvidence: () => void;
  onRelationshipJump: (eventId: string) => void; onExpandGroup?: (groupKey: string) => void;
  inlineEvidence?: ReactNode; onFocusInspector?: () => void;
}>) {
  const [clusterRoutine, setClusterRoutine] = useState(true);
  const graph = useMemo(() => projectExecutionGraph({ events: props.events,
    expandedGroupKeys: props.expandedGroupKeys, clusterRoutine }), [props.events, props.expandedGroupKeys, clusterRoutine]);
  const { nodes } = graph;
  const selectedIndex = props.selectedEventId === null ? -1 : graph.eventNodeIndex.get(props.selectedEventId) ?? -1;
  const selectedNode = nodes[selectedIndex];
  const selected = selectedNode?.events.find((event) => event.eventId === props.selectedEventId);
  const selectedEdges = graph.edges.filter((edge) => edge.sourceEventId === props.selectedEventId || edge.targetEventId === props.selectedEventId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const regionRefs = useRef(new Map<string, HTMLDivElement>());
  const clarificationRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ eventId: string; offset: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(props.selectedEventId ?? props.events[0]?.eventId ?? null);
  const [navigationMember, setNavigationMember] = useState<{ selection: string | null; eventId: string } | null>(null);
  const focusIndex = focusId === null ? 0 : graph.eventNodeIndex.get(focusId) ?? 0;
  const pendingFocus = useRef<{ eventId: string; onFocused?: () => void } | null>(null);
  const [wide, setWide] = useState(true);
  const [clarificationHeight, setClarificationHeight] = useState(0);
  const [footerReserve, setFooterReserve] = useState(400);
  const [selectedCardHeight, setSelectedCardHeight] = useState(100);
  const pins = new Set([selectedIndex, focusIndex]);
  for (const index of [selectedIndex - 1, selectedIndex + 1]) if (selectedIndex >= 0) pins.add(index);
  for (const edge of selectedEdges.slice(0, 4)) {
    pins.add(edge.sourceNodeIndex);
    if (edge.targetNodeIndex !== null) pins.add(edge.targetNodeIndex);
  }
  const virtualizer = useVirtualizer({
    count: nodes.length, getScrollElement: () => scrollRef.current,
    estimateSize: (index) => nodes[index]!.estimatedHeight,
    getItemKey: (index) => nodes[index]!.key, overscan: 3,
    rangeExtractor: (range) => [...new Set([...defaultRangeExtractor(range), ...pins])]
      .filter((index) => index >= 0 && index < nodes.length).sort((a, b) => a - b),
    measureElement: (element) => element.getBoundingClientRect().height ||
      nodes[Number(element.getAttribute("data-index"))]?.estimatedHeight || 160,
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (element === null) return () => undefined;
      const publish = () => {
        const rect = element.getBoundingClientRect();
        callback({ width: rect.width || 800, height: rect.height || 520 });
        setWide((rect.width || 800) >= 720);
      };
      publish();
      if (typeof ResizeObserver === "undefined") return () => undefined;
      const observer = new ResizeObserver(publish);
      observer.observe(element);
      return () => observer.disconnect();
    }, initialRect: { width: 800, height: 520 }
  });
  const virtualItems = virtualizer.getVirtualItems();
  const selectedItem = virtualItems.find((item) => item.index === selectedIndex);
  const lateral = wide && !props.inlineEvidence;
  // getVirtualItems refreshes this public geometry cache for the whole projection.
  // It includes measured sizes and estimates for unmounted nodes without adding cards.
  const positions = new Map(nodes.map((_node, index) => {
    const item = virtualizer.measurementsCache[index]!;
    return [index, { start: item.start, size: item.size }];
  }));
  const runId = props.runId ?? props.events[0]?.runId ?? "";
  const tailGeometry = useCallback(() => {
    const last = virtualizer.measurementsCache[nodes.length - 1];
    const height = scrollRef.current?.clientHeight || 520;
    const node = nodes.at(-1);
    const element = node && nodeRefs.current.get(node.key);
    return {
      // A tall final region must not put its node above the viewport either.
      offset: Math.max(0, Math.min(last?.start ?? 0, virtualizer.getTotalSize() - height)),
      bottomInset: (lateral ? footerReserve : 0) + Math.max(0, (last?.size ?? 0) - height),
      nodeEnd: (last?.start ?? 0) + (element
        ? element.offsetTop + (element.getBoundingClientRect().height || last?.size || 0)
        : last?.size ?? 0)
    };
  }, [nodes, virtualizer, lateral, footerReserve]);
  const scrollToLatest = useCallback(() => {
    if (nodes.length) {
      // Tail navigation supersedes the previous viewport's history anchor.
      anchorRef.current = null;
      virtualizer.scrollToOffset(tailGeometry().offset);
    }
  }, [nodes.length, virtualizer, tailGeometry]);
  const followTail = useFollowTail({ runId, liveAppend: props.liveAppend ?? { runId, revision: 0, identities: [] },
    onFollowTail: scrollToLatest });

  useLayoutEffect(() => {
    const element = clarificationRef.current;
    const card = selectedNode === undefined ? undefined : nodeRefs.current.get(selectedNode.key);
    const publish = () => {
      const height = Math.ceil(element?.getBoundingClientRect().height ?? 0);
      setClarificationHeight(height);
      if (lateral) setFooterReserve((current) => Math.max(current, height));
      setSelectedCardHeight(Math.ceil(card?.getBoundingClientRect().height || 100));
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    if (element) observer.observe(element);
    if (card) observer.observe(card);
    return () => observer.disconnect();
  }, [props.selectedEventId, props.inlineEvidence, selectedNode, lateral]);

  // Real region measurements replace estimates on expansion and narrow evidence changes.
  useLayoutEffect(() => {
    for (const element of regionRefs.current.values()) virtualizer.measureElement(element);
  }, [graph, lateral, clarificationHeight, selectedCardHeight, virtualizer]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const index = graph.eventNodeIndex.get(anchor.eventId);
    if (index === undefined) return;
    const offset = virtualizer.getOffsetForIndex(index, "start")?.[0];
    if (offset !== undefined) virtualizer.scrollToOffset(offset - anchor.offset);
  }, [graph, virtualizer]);

  const previousSelection = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (props.selectedEventId === previousSelection.current) return;
    // An around-event request can resolve this same selection on a later render.
    if (props.selectedEventId !== null && selectedIndex < 0) return;
    previousSelection.current = props.selectedEventId;
    if (selectedIndex < 0) return;
    setFocusId(props.selectedEventId);
    const offset = virtualizer.getOffsetForIndex(selectedIndex, "start")?.[0];
    const viewport = scrollRef.current;
    if (offset !== undefined && viewport && (offset < viewport.scrollTop || offset > viewport.scrollTop + (viewport.clientHeight || 520) - 80)) {
      virtualizer.scrollToOffset(Math.max(0, offset - (viewport.clientHeight || 520) / 3));
    }
  }, [props.selectedEventId, selectedIndex, virtualizer]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const first = virtualItems.find((item) => item.end > viewport.scrollTop && item.start < viewport.scrollTop + (viewport.clientHeight || 520));
    if (!first) { anchorRef.current = null; return; }
    const eventId = nodes[first.index]!.events[0]!.eventId;
    anchorRef.current = { eventId, offset: first.start - viewport.scrollTop };
    if (!pendingFocus.current && !viewport.contains(document.activeElement)) setFocusId(eventId);
  }, [nodes, virtualItems]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const index = graph.eventNodeIndex.get(pending.eventId);
    const node = index === undefined ? undefined : nodes[index];
    const element = node === undefined ? undefined : nodeRefs.current.get(node.key);
    if (!element || element.tabIndex !== 0) return;
    element.focus({ preventScroll: true });
    if (document.activeElement === element) {
      pendingFocus.current = null;
      pending.onFocused?.();
    }
  }, [focusId, graph, virtualItems]);

  const focus = (index: number, memberId?: string, onFocused?: () => void) => {
    const bounded = Math.max(0, Math.min(nodes.length - 1, index));
    const eventId = memberId ?? nodes[bounded]?.events.at(-1)?.eventId;
    if (!eventId) return;
    pendingFocus.current = { eventId, ...(onFocused ? { onFocused } : {}) };
    setNavigationMember({ selection: props.selectedEventId, eventId });
    setFocusId(eventId);
    virtualizer.scrollToIndex(bounded, { align: "auto" });
  };
  const jump = (id: string) => {
    const index = graph.eventNodeIndex.get(id);
    if (index !== undefined) focus(index, id);
    props.onRelationshipJump(id);
  };
  if (!nodes.length) return <section className="trajectory-empty">No trajectory events are available for this run.</section>;
  return <section className="trajectory-shell execution-graph" aria-label="Live execution trajectory">
    <div className="execution-graph-controls"><span>Chronological sequence · not causality</span>
      <label><input type="checkbox" checked={clusterRoutine} onChange={(event) => setClusterRoutine(event.target.checked)} />Group routine events</label>
    </div>
    {followTail.newEventCount > 0 && <div className="trajectory-new-events"><button type="button" onClick={() => {
      const latest = props.events.at(-1);
      if (latest) { focus(graph.eventNodeIndex.get(latest.eventId)!, latest.eventId, followTail.jumpToLatest); props.onSelect(latest.eventId); }
    }}>{followTail.newEventCount} new {followTail.newEventCount === 1 ? "event" : "events"}</button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{followTail.newEventCount} new {followTail.newEventCount === 1 ? "event" : "events"} available</span></div>}
    <div ref={scrollRef} className="trajectory-viewport" data-clarification-layout={lateral ? "adjacent" : "below"}
      onScroll={(event) => followTail.observeViewport(event.currentTarget, tailGeometry())}>
      <div className="execution-graph-canvas" style={{ height: virtualizer.getTotalSize() + (lateral ? footerReserve : 0) }}>
        <div className="trajectory-stage" role="listbox" aria-label="Execution trajectory" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((item) => {
            const node = nodes[item.index]!;
            return <div key={item.key} className="trajectory-virtual-row execution-graph-region" data-index={item.index}
              ref={(element) => { if (element) regionRefs.current.set(node.key, element); else regionRefs.current.delete(node.key); virtualizer.measureElement(element); }}
              style={{ transform: `translateY(${item.start}px)`, minHeight: node.estimatedHeight }}>
              <ExecutionNode node={node} selectedEventId={props.selectedEventId} tabIndex={item.index === focusIndex ? 0 : -1}
                activeEventId={navigationMember?.selection === props.selectedEventId ? navigationMember.eventId : null}
                nodeRef={(element) => { if (element) nodeRefs.current.set(node.key, element); else nodeRefs.current.delete(node.key); }}
                onSelect={props.onSelect} onExpand={(key) => props.onExpandGroup?.(key)}
                onKeyDown={(event) => {
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    focus(event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1 : item.index + (event.key === "ArrowDown" ? 1 : -1),
                      event.key === "Home" ? nodes[0]!.events[0]!.eventId : undefined);
                  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    const active = node.events.find((member) => member.eventId === props.selectedEventId) ?? node.events.at(-1)!;
                    const edge = graph.edges.find((edge) => event.key === "ArrowRight" ? edge.sourceEventId === active.eventId : edge.targetEventId === active.eventId);
                    if (edge) { event.preventDefault(); jump(event.key === "ArrowRight" ? edge.targetEventId : edge.sourceEventId); }
                  } else if (event.key === "Escape") { event.preventDefault(); props.onEscapeDeepEvidence(); }
                }} />
              {!lateral && item.index === selectedIndex && <div aria-hidden="true" style={{ height: clarificationHeight + 16 }} />}
            </div>;
          })}
        </div>
        <ExecutionGraphEdges graph={graph} positions={positions} selectedEventId={props.selectedEventId}
          viewportStart={virtualizer.scrollOffset ?? 0} viewportHeight={scrollRef.current?.clientHeight || 520} height={virtualizer.getTotalSize()} />
        {selected && selectedNode && selectedItem && <div ref={clarificationRef}
          className={`execution-graph-clarification ${lateral ? "is-adjacent" : "is-below"}`}
          data-inline-evidence-anchor-for={!lateral ? selected.eventId : undefined}
          style={{ transform: `translateY(${selectedItem.start + (lateral ? 12 : selectedCardHeight + 24)}px)` }}>
          <NodeClarification event={selected} node={selectedNode} edges={selectedEdges} onSelect={props.onSelect}
            onExpand={(key) => props.onExpandGroup?.(key)} onRelationshipJump={jump} onFocusInspector={props.onFocusInspector} />
          {props.inlineEvidence}
        </div>}
      </div>
    </div>
  </section>;
}
