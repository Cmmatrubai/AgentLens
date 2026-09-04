import type { RunDetailV1 } from "@agentlens/api-contract";

import { AssessmentSummary } from "../assessment/AssessmentSummary.js";
import { durationText, likelyTestsText, providerText, words } from "../runs/runFacts.js";

function statusLabel(run: RunDetailV1): string {
  return run.status.state === "known"
    ? run.status.value.replaceAll("_", " ")
    : `Unsupported status: ${run.status.safeToken}`;
}

export function RunEvidenceStrip({ run }: Readonly<{ run: RunDetailV1 }>) {
  const recorderDuration = durationText(run);
  const startedAt = new Date(run.startedAt).toISOString();
  const endedAt = run.endedAt === null ? null : new Date(run.endedAt).toISOString();

  return (
    <section className="run-evidence-strip" aria-label="Run evidence summary">
      <dl>
        <div className="run-evidence-strip__primary"><dt>Lifecycle</dt><dd>{statusLabel(run)}</dd></div>
        <div className="run-evidence-strip__primary"><dt>Recorder duration</dt><dd>{recorderDuration ?? `Unavailable · ${words(run.summary.elapsedRecorderTimeMs.state === "unavailable" ? run.summary.elapsedRecorderTimeMs.reason : "not_captured")}`}</dd></div>
        <div className="run-evidence-strip__primary"><dt>Likely tests</dt><dd>{likelyTestsText(run)}</dd></div>
        <div className="run-evidence-strip__primary"><dt>Assessment</dt><dd><AssessmentSummary assessment={run.summary.assessment} /></dd></div>
        <div className="run-evidence-strip__metadata"><dt>Provider</dt><dd>{providerText(run)}</dd></div>
        <div className="run-evidence-strip__metadata"><dt>Repository</dt><dd>{run.repository.display}</dd></div>
        <div className="run-evidence-strip__metadata"><dt>Events</dt><dd>{run.eventCount.toLocaleString()}</dd></div>
        <div className="run-evidence-strip__metadata"><dt>Recorder started</dt><dd><time dateTime={startedAt}>{startedAt}</time></dd></div>
        <div className="run-evidence-strip__metadata"><dt>Recorder ended</dt><dd>{endedAt === null ? "Not yet ended" : <time dateTime={endedAt}>{endedAt}</time>}</dd></div>
      </dl>
    </section>
  );
}
