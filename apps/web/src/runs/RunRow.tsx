import type {
  EvidenceUnavailableReasonV1,
  ProviderCapabilityLimitationV1,
  RunListItemV1
} from "@agentlens/api-contract";
import { Link } from "react-router-dom";

import { Availability } from "../components/Availability.js";
import { ProvenanceMark } from "../components/ProvenanceMark.js";
import { StatusBadge } from "../components/StatusBadge.js";

function words(value: string): string {
  return value.replaceAll("_", " ");
}

function unavailableReason(reason: EvidenceUnavailableReasonV1): string {
  switch (reason) {
    case "provider_capability": return "provider capability";
    case "capture_policy": return "capture policy";
    case "not_captured": return "not captured";
    case "not_yet_available": return "not yet available";
    case "artifact_omitted": return "artifact omitted";
    case "artifact_unreadable": return "artifact unreadable";
  }
}

function providerText(run: RunListItemV1): string {
  return run.provider.state === "known"
    ? run.provider.value
    : `Unsupported provider: ${run.provider.safeToken}`;
}

function likelyTestsText(run: RunListItemV1): string {
  const tests = run.summary.likelyTests;
  if (tests.state === "none_detected") return "Likely tests: none detected";
  if (tests.state === "unavailable_due_to_capture_policy") {
    return "Likely tests: unavailable due to capture policy";
  }
  const failures = tests.attempts.previousFailures;
  return `Latest likely test: ${tests.attempts.latest} · ${failures} previous ${failures === 1 ? "failure" : "failures"}`;
}

function reviewText(run: RunListItemV1): string {
  const assessment = run.summary.assessment;
  if (assessment.state === "projected") {
    return "Not reviewed · projected state · no human evidence";
  }
  return `Reviewer: ${assessment.verdict}`;
}

function gitText(run: RunListItemV1): string {
  if (run.finalGitEvidence.state === "unavailable") {
    return `Final Git evidence: ${words(run.finalGitEvidence.reason)}`;
  }
  const diff = run.summary.trackedFinalDiff;
  const diffText = diff.state === "available"
    ? diff.value === "artifact" ? "tracked diff available" : "tracked diff absent"
    : `tracked diff unavailable (${unavailableReason(diff.reason)})`;
  const untracked = run.summary.untrackedFiles;
  const untrackedText = untracked.state === "available"
    ? `${untracked.value} untracked ${untracked.value === 1 ? "entry" : "entries"}`
    : `untracked-file metadata unavailable (${unavailableReason(untracked.reason)})`;
  return `Final Git evidence: ${diffText} · ${untrackedText}`;
}

function durationText(run: RunListItemV1): string | undefined {
  const elapsed = run.summary.elapsedRecorderTimeMs;
  if (elapsed.state === "unavailable") return undefined;
  if (elapsed.value < 1_000) return `${elapsed.value} ms`;
  return `${(elapsed.value / 1_000).toFixed(elapsed.value % 1_000 === 0 ? 0 : 1)} s`;
}

function commandsText(run: RunListItemV1): string {
  const terminal = run.summary.terminalCommands;
  const failed = run.summary.failedTerminalCommands;
  if (terminal.state === "unavailable" || failed.state === "unavailable") {
    return "Command lifecycle: unavailable";
  }
  return `Command lifecycle: ${terminal.value} terminal · ${failed.value} failed`;
}

function capabilityLabel(value: ProviderCapabilityLimitationV1): string {
  return `${words(value.capability)} ${words(value.availability)}`;
}

function providerLimitations(run: RunListItemV1): string {
  const limitations = run.summary.providerCapabilityLimitations;
  if (limitations.state === "unavailable") {
    return `Provider limitations: unavailable (${unavailableReason(limitations.reason)})`;
  }
  return `Provider limitations: ${limitations.value.map(capabilityLabel).join(" · ")}`;
}

export function RunRow({ run }: Readonly<{ run: RunListItemV1 }>) {
  const title = run.label ?? "Unlabeled run";
  const recorderDuration = durationText(run);
  return (
    <li className="run-ledger__item">
      <article className="run-row">
        <Link className="run-row__destination" to={`/runs/${encodeURIComponent(run.runId)}`} aria-label={`${title} — inspect run evidence`}>
          <div className="run-row__primary">
            <div className="run-row__identity">
              <span className="run-row__label">{title}</span>
              <span className="run-row__repository">{run.repository.display}</span>
              <code>{run.repository.fingerprint}</code>
            </div>
            <div className="run-row__status">
              <StatusBadge status={run.status} />
              <span className="run-row__provider">{providerText(run)}</span>
              <time dateTime={new Date(run.startedAt).toISOString()}>
                {new Intl.DateTimeFormat(undefined, {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
                }).format(run.startedAt)}
              </time>
              <Availability
                label="Recorder duration"
                unavailableReason="not yet available"
                {...(recorderDuration === undefined ? {} : { value: recorderDuration })}
              />
            </div>
          </div>

          <dl className="run-row__evidence">
            <div>
              <dt>Lifecycle</dt>
              <dd>{commandsText(run)}</dd>
            </div>
            <div>
              <dt>Likely tests</dt>
              <dd>{likelyTestsText(run)}</dd>
            </div>
            <div>
              <dt>Human review</dt>
              <dd className="run-row__review">
                {run.summary.assessment.state === "explicit" && <ProvenanceMark provenance="human" />}
                {reviewText(run)}
              </dd>
            </div>
            <div>
              <dt>Git</dt>
              <dd>{gitText(run)}</dd>
            </div>
          </dl>

          <div className="run-row__signals">
            {run.finalGitEvidence.state === "available" && run.finalGitEvidence.headChanged && (
              <span className="signal signal--warning">HEAD changed</span>
            )}
            {run.finalGitEvidence.state === "available" && run.finalGitEvidence.branchChanged && (
              <span className="signal signal--warning">Branch changed</span>
            )}
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
            <span className="run-row__limitations">{providerLimitations(run)}</span>
          </div>
        </Link>
      </article>
    </li>
  );
}
