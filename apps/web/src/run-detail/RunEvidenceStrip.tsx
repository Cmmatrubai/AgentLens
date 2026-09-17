import type { RunDetailV1 } from "@agentlens/api-contract";

import { AssessmentSummary } from "../assessment/AssessmentSummary.js";
import { durationText, likelyTestsText, providerText, words } from "../runs/runFacts.js";

function statusLabel(run: RunDetailV1): string {
  return run.status.state === "known"
    ? run.status.value.replaceAll("_", " ")
    : `Unsupported status: ${run.status.safeToken}`;
}

function tokenUsageUnavailableText(run: RunDetailV1): string {
  const usage = run.summary.observedTokenUsage;
  if (usage.state === "available") throw new Error("Expected unavailable token usage.");
  switch (usage.reason) {
    case "not_yet_available":
      return "Waiting for provider usage at turn completion.";
    case "capture_policy":
      return "Usage counters are unavailable under this run's capture policy.";
    case "redacted_by_policy":
      return "Provider usage fields were present but redacted by the capture policy used for this run.";
    case "not_captured":
      return "The provider did not emit usable usage counters.";
  }
}

function tokenCounterText(value: number | null): string {
  return value === null ? "not emitted" : value.toLocaleString();
}

export function RunEvidenceStrip({ run }: Readonly<{ run: RunDetailV1 }>) {
  const tokenUsage = run.summary.observedTokenUsage;
  const recorderDuration = durationText(run);
  const startedAt = new Date(run.startedAt).toISOString();
  const endedAt = run.endedAt === null ? null : new Date(run.endedAt).toISOString();

  return (
    <section className="run-evidence-strip" aria-label="Run evidence summary">
      <dl>
        <div className="run-evidence-strip__primary"><dt>Lifecycle</dt><dd>{statusLabel(run)}</dd></div>
        <div className="run-evidence-strip__primary"><dt>Recorder duration</dt><dd>{recorderDuration ?? `Unavailable · ${words(run.summary.elapsedRecorderTimeMs.state === "unavailable" ? run.summary.elapsedRecorderTimeMs.reason : "not_captured")}`}</dd></div>
        <div className="run-evidence-strip__primary"><dt>Test-bearing commands</dt><dd>{likelyTestsText(run)}</dd></div>
        <div className="run-evidence-strip__primary"><dt>Assessment</dt><dd><AssessmentSummary assessment={run.summary.assessment} /></dd></div>
        <div className="run-evidence-strip__metadata"><dt>Provider</dt><dd>{providerText(run)}</dd></div>
        <div className="run-evidence-strip__metadata"><dt>Repository</dt><dd>{run.repository.display}</dd></div>
        <div className="run-evidence-strip__metadata"><dt>Events</dt><dd>{run.eventCount.toLocaleString()}</dd></div>
        <div className="run-evidence-strip__metadata"><dt>Recorder started</dt><dd><time dateTime={startedAt}>{startedAt}</time></dd></div>
        <div className="run-evidence-strip__metadata"><dt>Recorder ended</dt><dd>{endedAt === null ? "Not yet ended" : <time dateTime={endedAt}>{endedAt}</time>}</dd></div>
        {tokenUsage.state === "available" ? (
          <>
            <div className="run-evidence-strip__metadata"><dt>Input</dt><dd>{tokenCounterText(tokenUsage.value.inputTokens)}</dd></div>
            <div className="run-evidence-strip__metadata"><dt>Cached input</dt><dd>{tokenCounterText(tokenUsage.value.cachedInputTokens)}</dd></div>
            <div className="run-evidence-strip__metadata"><dt>Output</dt><dd>{tokenCounterText(tokenUsage.value.outputTokens)}</dd></div>
            <div className="run-evidence-strip__metadata"><dt>Reasoning output</dt><dd>{tokenCounterText(tokenUsage.value.reasoningOutputTokens)}</dd></div>
            <div className="run-evidence-strip__metadata"><dt>Cache-write input</dt><dd>{tokenCounterText(tokenUsage.value.cacheWriteInputTokens)}</dd></div>
          </>
        ) : (
          <div className="run-evidence-strip__usage"><dt>Token usage</dt><dd>{tokenUsageUnavailableText(run)}</dd></div>
        )}
      </dl>
    </section>
  );
}
