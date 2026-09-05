import type { ExecutionGraph } from "./graphTypes.js";
import { useId } from "react";

export function ExecutionGraphEdges(props: Readonly<{
  graph: ExecutionGraph; positions: ReadonlyMap<number, { start: number; size: number }>;
  viewportStart: number; viewportHeight: number; height: number; selectedEventId: string | null;
}>) {
  const { graph, positions } = props;
  const arrowId = useId();
  const start = props.viewportStart;
  const end = start + props.viewportHeight;
  const orderedPositions = [...positions].sort(([a], [b]) => a - b);
  const backbone = orderedPositions.reduce((path, [index, position]) => {
    const x = graph.nodes[index]!.lane === 1 ? 59 : 27;
    return `${path} L ${x} ${position.start + 38}`;
  }, "M 27 0") + ` L 27 ${props.height}`;
  const visibleEdges = graph.edges.flatMap((edge) => {
    const source = positions.get(edge.sourceNodeIndex);
    const target = edge.targetNodeIndex === null ? undefined : positions.get(edge.targetNodeIndex);
    if (!source) return [];
    const sourceY = source.start + 38;
    const targetY = target ? target.start + 38 : sourceY + 72;
    if (Math.max(sourceY, targetY) < start || Math.min(sourceY, targetY) > end) return [];
    const y1 = Math.max(start + 12, Math.min(end - 12, sourceY));
    const y2 = Math.max(start + 12, Math.min(end - 12, targetY));
    const boundary = edge.targetNodeIndex === null ? " · not loaded"
      : targetY !== y2 || sourceY !== y1 ? " · offscreen" : "";
    return [{ edge, y1, y2, label: `${edge.type.replaceAll("_", " ")}${boundary}`,
      desiredLabelY: Math.max(start + 12, y1 - 26) }];
  });
  // Allocate label baselines independently from source geometry: same-source and
  // clipped-boundary relationships can share endpoints but must not share text.
  const labelPositions = new Map<string, number>();
  const labelCapacity = Math.max(1, Math.floor((props.viewportHeight - 24) / 16) + 1);
  const sharedLabels = new Map<string, { edgeKey: string; label: string; desiredLabelY: number; count: number }>();
  for (const item of visibleEdges) {
    // Only crowded overlays share text, by exact type and boundary state. Every
    // individual directed path and its source/target identity remain present.
    const key = visibleEdges.length > labelCapacity ? item.label : item.edge.key;
    const previous = sharedLabels.get(key);
    if (previous) previous.count += 1;
    else sharedLabels.set(key, { edgeKey: item.edge.key, label: item.label, desiredLabelY: item.desiredLabelY, count: 1 });
  }
  const orderedLabels = [...sharedLabels.values()].sort((a, b) =>
    a.desiredLabelY - b.desiredLabelY || a.edgeKey.localeCompare(b.edgeKey));
  const labelsByEdge = new Map(orderedLabels.map((item) => [item.edgeKey,
    `${item.label}${item.count > 1 ? ` · ${item.count} relationships` : ""}`]));
  let previousLabelY = start - 4;
  for (const item of orderedLabels) {
    const y = Math.max(item.desiredLabelY, previousLabelY + 16);
    labelPositions.set(item.edgeKey, y);
    previousLabelY = y;
  }
  // Pull a crowded lower boundary upward while retaining the same line spacing.
  let nextLabelY = end + 4;
  for (const item of [...orderedLabels].reverse()) {
    const y = Math.min(labelPositions.get(item.edgeKey)!, nextLabelY - 16);
    labelPositions.set(item.edgeKey, y);
    nextLabelY = y;
  }
  return <svg className="execution-graph-edges" aria-hidden="true" focusable="false"
    data-relationship-overlay="true" width="100%" height={props.height} style={{ pointerEvents: "none" }}>
    <defs><marker id={arrowId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="var(--evidence-derived)" /></marker></defs>
    <path className="execution-graph-backbone" data-graph-backbone="chronological" d={backbone} />
    {visibleEdges.map(({ edge, y1, y2 }) => {
      const x1 = graph.nodes[edge.sourceNodeIndex]!.lane === 1 ? 59 : 27;
      const x2 = edge.targetNodeIndex !== null && graph.nodes[edge.targetNodeIndex]!.lane === 1 ? 59 : 27;
      return <g key={edge.key} className={`execution-graph-relationship${edge.sourceEventId === props.selectedEventId || edge.targetEventId === props.selectedEventId ? " is-selected" : ""}`}>
        <title>{edge.sourceEventId} → {edge.targetEventId} · {edge.type.replaceAll("_", " ")}</title>
        <path data-graph-edge={edge.type} data-relationship-connector={edge.key} data-source={edge.sourceEventId} data-target={edge.targetEventId}
          d={`M ${x1} ${y1} C 4 ${y1}, 4 ${y2}, ${x2} ${y2}`} markerEnd={`url(#${arrowId})`} />
        {labelsByEdge.has(edge.key) && <text x="72" y={labelPositions.get(edge.key)} data-graph-edge-label={edge.key}>{labelsByEdge.get(edge.key)}</text>}
      </g>;
    })}
  </svg>;
}
