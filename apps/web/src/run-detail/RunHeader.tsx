import type { RunDetailV1 } from "@agentlens/api-contract";

import { AssessmentEditor } from "../assessment/AssessmentEditor.js";
import { AssessmentSummary } from "../assessment/AssessmentSummary.js";
import { durationText, likelyTestsText, providerText, words } from "../runs/runFacts.js";

function statusLabel(run: RunDetailV1): string {
  return run.status.state === "known"
    ? run.status.value.replaceAll("_", " ")
    : `Unsupported status: ${run.status.safeToken}`;
}

export function RunHeader({ run, onAssessmentSaved }: Readonly<{
  run: RunDetailV1;
  onAssessmentSaved?: (eventId: string) => void;
}>) {
  const recorderDuration = durationText(run);
  const startedAt = new Date(run.startedAt).toISOString();
  const endedAt = run.endedAt === null ? null : new Date(run.endedAt).toISOString();
  return (
    <header className="run-detail-header">
      <div>
        <p className="page-eyebrow">Run evidence</p>
        <h1>{run.label ?? "Unlabeled run"}</h1>
        <p className="run-detail-header__identity">{run.runId}</p>
      </div>
      <dl>
        <div><dt>Lifecycle</dt><dd>{statusLabel(run)}</dd></div>
        <div><dt>Provider</dt><dd>{providerText(run)}</dd></div>
        <div><dt>Repository</dt><dd>{run.repository.display}</dd></div>
        <div><dt>Events</dt><dd>{run.eventCount.toLocaleString()}</dd></div>
        <div><dt>Recorder started</dt><dd><time dateTime={startedAt}>{startedAt}</time></dd></div>
        <div><dt>Recorder ended</dt><dd>{endedAt === null ? "Not yet ended" : <time dateTime={endedAt}>{endedAt}</time>}</dd></div>
        <div><dt>Recorder duration</dt><dd>{recorderDuration ?? `Unavailable · ${words(run.summary.elapsedRecorderTimeMs.state === "unavailable" ? run.summary.elapsedRecorderTimeMs.reason : "not_captured")}`}</dd></div>
        <div><dt>Likely tests</dt><dd>{likelyTestsText(run)}</dd></div>
        <div><dt>Assessment</dt><dd><AssessmentSummary assessment={run.summary.assessment} /></dd></div>
      </dl>
      {onAssessmentSaved !== undefined && (
        <AssessmentEditor
          runId={run.runId}
          assessment={run.summary.assessment}
          onConfirmed={onAssessmentSaved}
        />
      )}
      {(run.warningCodes.length > 0 || run.contradictionCodes.length > 0) && (
        <div className="run-detail-header__signals" aria-label="Run warnings and contradictions">
          {run.contradictionCodes.map((code) => (
            <span className="signal signal--contradiction" key={`contradiction-${code}`}>
              Contradiction: {words(code)}
            </span>
          ))}
          {run.warningCodes.map((code) => (
            <span className="signal signal--warning" key={`warning-${code}`}>
              Warning: {words(code)}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
