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
  const mounted = [...positions].sort(([a], [b]) => a - b);
  const backbone = mounted.reduce((path, [index, position]) => {
    const x = graph.nodes[index]!.lane === 1 ? 59 : 27;
    return `${path} L ${x} ${position.start + 38}`;
  }, "M 27 0") + ` L 27 ${props.height}`;
  return <svg className="execution-graph-edges" aria-hidden="true" focusable="false"
    data-relationship-overlay="true" width="100%" height={props.height} style={{ pointerEvents: "none" }}>
    <defs><marker id={arrowId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="var(--evidence-derived)" /></marker></defs>
    <path className="execution-graph-backbone" data-graph-backbone="chronological" d={backbone} />
    {graph.edges.map((edge) => {
      const source = positions.get(edge.sourceNodeIndex);
      const target = edge.targetNodeIndex === null ? undefined : positions.get(edge.targetNodeIndex);
      if (!source && !target) return null;
      const sourceY = source ? source.start + 38 : edge.sourceNodeIndex < (edge.targetNodeIndex ?? 0) ? start + 12 : end - 12;
      const targetY = target ? target.start + 38 : edge.targetNodeIndex !== null && edge.targetNodeIndex < edge.sourceNodeIndex ? start + 12 : Math.min(end - 12, sourceY + 72);
      if (Math.max(sourceY, targetY) < start || Math.min(sourceY, targetY) > end) return null;
      const y1 = Math.max(start + 12, Math.min(end - 12, sourceY));
      const y2 = Math.max(start + 12, Math.min(end - 12, targetY));
      const x1 = graph.nodes[edge.sourceNodeIndex]!.lane === 1 ? 59 : 27;
      const x2 = edge.targetNodeIndex !== null && graph.nodes[edge.targetNodeIndex]!.lane === 1 ? 59 : 27;
      const label = `${edge.type.replaceAll("_", " ")}${edge.targetNodeIndex === null ? " · not loaded" : !target || targetY !== y2 || !source || sourceY !== y1 ? " · offscreen" : ""}`;
      return <g key={edge.key} className={`execution-graph-relationship${edge.sourceEventId === props.selectedEventId || edge.targetEventId === props.selectedEventId ? " is-selected" : ""}`}>
        <path data-graph-edge={edge.type} data-relationship-connector={edge.key} data-source={edge.sourceEventId} data-target={edge.targetEventId}
          d={`M ${x1} ${y1} C 4 ${y1}, 4 ${y2}, ${x2} ${y2}`} markerEnd={`url(#${arrowId})`} />
        <text x="72" y={Math.max(start + 12, y1 - 26)}>{label}</text>
      </g>;
    })}
  </svg>;
}
