import type { RunStatusFieldV1 } from "@agentlens/api-contract";

const statusPresentation = {
  starting: { label: "Starting", glyph: "◌" },
  running: { label: "Running", glyph: "●" },
  completed: { label: "Completed", glyph: "✓" },
  failed: { label: "Failed", glyph: "×" },
  interrupted: { label: "Interrupted", glyph: "■" },
  recorder_error: { label: "Recorder error", glyph: "!" }
} as const;

export function StatusBadge({ status }: Readonly<{ status: RunStatusFieldV1 }>) {
  if (status.state === "unsupported") {
    return (
      <span className="status-badge status-badge--unsupported">
        <span aria-hidden="true" className="status-badge__glyph">?</span>
        <span className="status-badge__label">Unsupported status: {status.safeToken}</span>
        <span className="status-badge__compatibility">Compatibility warning</span>
      </span>
    );
  }
  const presentation = statusPresentation[status.value];
  return (
    <span className={`status-badge status-badge--${status.value}`}>
      <span aria-hidden="true" className="status-badge__glyph">{presentation.glyph}</span>
      <span className="status-badge__label">{presentation.label}</span>
    </span>
  );
}
