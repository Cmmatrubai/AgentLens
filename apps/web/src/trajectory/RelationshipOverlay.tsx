import type { TrajectoryEventV1 } from "@agentlens/api-contract";

export function RelationshipOverlay(props: Readonly<{
  selected: TrajectoryEventV1 | null;
  visibleEventIds: ReadonlySet<string>;
}>) {
  const visible = props.selected?.relationships.filter(({ eventId }) =>
    props.visibleEventIds.has(eventId)
  ) ?? [];
  if (visible.length === 0) return null;
  return (
    <div
      className="relationship-overlay"
      data-relationship-overlay
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      {visible.map((relationship) => (
        <span
          key={`${relationship.type}:${relationship.eventId}`}
          className="relationship-overlay__connector"
          data-relationship-connector
        />
      ))}
    </div>
  );
}
