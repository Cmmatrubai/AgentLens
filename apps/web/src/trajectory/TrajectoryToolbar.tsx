import type { EventAnchorV1 } from "@agentlens/api-contract";

export function TrajectoryToolbar(props: Readonly<{
  eventCount: number;
  totalEventCount: number | null;
  isComplete: boolean;
  hasEarlier: boolean;
  hasLater: boolean;
  onEarlier: (() => void) | null;
  onLater: (() => void) | null;
  anchors?: Readonly<{
    firstFailure: EventAnchorV1 | null;
    recorderRecovery: EventAnchorV1 | null;
    latestLikelyTest: EventAnchorV1 | null;
    finalGitEvidence: EventAnchorV1 | null;
    latestEvent: EventAnchorV1 | null;
  }>;
  onJump?: (eventId: string) => void;
}>) {
  const eventCount = props.totalEventCount === null
    ? props.eventCount.toLocaleString() + " immutable events loaded"
    : props.eventCount.toLocaleString() + " of " + props.totalEventCount.toLocaleString() +
      " immutable events loaded";
  const jumps = [
    ["first failure", props.anchors?.firstFailure],
    ["recorder recovery", props.anchors?.recorderRecovery],
    ["latest likely test", props.anchors?.latestLikelyTest],
    ["final Git evidence", props.anchors?.finalGitEvidence],
    ["latest event", props.anchors?.latestEvent]
  ] as const;
  return (
    <header className="trajectory-toolbar">
      <div>
        <p className="page-eyebrow">Canonical event sequence</p>
        <h2>Execution trajectory</h2>
        <span data-complete={props.isComplete ? "true" : "false"}>{eventCount}</span>
      </div>
      <div className="trajectory-toolbar__legend" aria-label="Evidence provenance legend">
        <span>◇ Observed</span><span>◆ Derived</span><span>□ Git recovered</span>
        <span>△ Recorder</span><span>○ Human</span>
      </div>
      {props.onJump !== undefined && jumps.some(([, anchor]) => anchor != null) && (
        <div className="trajectory-toolbar__jumps" aria-label="Trajectory jump controls">
          {jumps.map(([label, anchor]) => anchor === null || anchor === undefined ? null : (
            <button key={label} type="button" onClick={() => props.onJump?.(anchor.eventId)}>
              Jump to {label}
            </button>
          ))}
        </div>
      )}
      <div className="trajectory-toolbar__paging">
        <button type="button" disabled={!props.hasEarlier} onClick={props.onEarlier ?? undefined}>Load earlier</button>
        <button type="button" disabled={!props.hasLater} onClick={props.onLater ?? undefined}>Load later</button>
      </div>
    </header>
  );
}
