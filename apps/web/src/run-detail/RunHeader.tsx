import type { RunDetailV1 } from "@agentlens/api-contract";

function statusLabel(run: RunDetailV1): string {
  return run.status.state === "known"
    ? run.status.value.replaceAll("_", " ")
    : `Unsupported status: ${run.status.safeToken}`;
}

export function RunHeader({ run }: Readonly<{ run: RunDetailV1 }>) {
  return (
    <header className="run-detail-header">
      <div>
        <p className="page-eyebrow">Run evidence</p>
        <h1>{run.label ?? "Unlabeled run"}</h1>
        <p className="run-detail-header__identity">{run.runId}</p>
      </div>
      <dl>
        <div><dt>Lifecycle</dt><dd>{statusLabel(run)}</dd></div>
        <div><dt>Provider</dt><dd>{run.provider.state === "known" ? run.provider.value : `Unsupported: ${run.provider.safeToken}`}</dd></div>
        <div><dt>Repository</dt><dd>{run.repository.display}</dd></div>
        <div><dt>Events</dt><dd>{run.eventCount.toLocaleString()}</dd></div>
      </dl>
    </header>
  );
}
