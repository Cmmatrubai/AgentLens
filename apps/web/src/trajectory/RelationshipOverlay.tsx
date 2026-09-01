import { useLayoutEffect, useMemo, useState } from "react";

import { uniqueRelationships } from "./relationships.js";

import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import type { RefObject } from "react";

type Connector = Readonly<{
  key: string;
  targetEventId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}>;

function sameConnectors(left: readonly Connector[], right: readonly Connector[]): boolean {
  return left.length === right.length && left.every((line, index) => {
    const candidate = right[index];
    return candidate !== undefined && line.key === candidate.key && line.x1 === candidate.x1 &&
      line.y1 === candidate.y1 && line.x2 === candidate.x2 && line.y2 === candidate.y2;
  });
}

export function RelationshipOverlay(props: Readonly<{
  selected: TrajectoryEventV1 | null;
  visibleEventIds: ReadonlySet<string>;
  rowElements: ReadonlyMap<string, HTMLElement>;
  stageRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  layoutKey: string;
}>) {
  const visible = useMemo(() => uniqueRelationships(props.selected?.relationships ?? []).filter(
    ({ eventId }) => props.visibleEventIds.has(eventId)
  ), [props.selected, props.visibleEventIds]);
  const [connectors, setConnectors] = useState<readonly Connector[]>([]);

  useLayoutEffect(() => {
    const stage = props.stageRef.current;
    const viewport = props.viewportRef.current;
    const source = props.selected === null ? undefined : props.rowElements.get(props.selected.eventId);
    if (stage === null || viewport === null || source === undefined || visible.length === 0) {
      setConnectors((current) => current.length === 0 ? current : []);
      return;
    }
    const measure = (): void => {
      const stageRect = stage.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      const next = visible.flatMap((relationship): readonly Connector[] => {
        const target = props.rowElements.get(relationship.eventId);
        if (target === undefined || target === source) return [];
        const targetRect = target.getBoundingClientRect();
        const sourceVisible = sourceRect.bottom > viewportRect.top && sourceRect.top < viewportRect.bottom;
        const targetVisible = targetRect.bottom > viewportRect.top && targetRect.top < viewportRect.bottom;
        if (!sourceVisible || !targetVisible) return [];
        return [{
          key: `${relationship.type}:${relationship.eventId}`,
          targetEventId: relationship.eventId,
          x1: sourceRect.left + sourceRect.width / 2 - stageRect.left,
          y1: sourceRect.top + sourceRect.height / 2 - stageRect.top,
          x2: targetRect.left + targetRect.width / 2 - stageRect.left,
          y2: targetRect.top + targetRect.height / 2 - stageRect.top
        }];
      });
      setConnectors((current) => sameConnectors(current, next) ? current : next);
    };
    measure();
    viewport.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        viewport.removeEventListener("scroll", measure);
        window.removeEventListener("resize", measure);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(stage);
    observer.observe(source);
    for (const relationship of visible) {
      const target = props.rowElements.get(relationship.eventId);
      if (target !== undefined) observer.observe(target);
    }
    return () => {
      viewport.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [props.layoutKey, props.rowElements, props.selected, props.stageRef, props.viewportRef, visible]);

  if (connectors.length === 0) return null;
  return (
    <svg
      className="relationship-overlay"
      data-relationship-overlay
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      {connectors.map((connector) => (
        <line
          key={connector.key}
          className="relationship-overlay__connector"
          data-relationship-connector
          data-target-event-id={connector.targetEventId}
          x1={connector.x1}
          y1={connector.y1}
          x2={connector.x2}
          y2={connector.y2}
        />
      ))}
    </svg>
  );
}
