import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Info, LoaderCircle, ShieldCheck } from "lucide-react";
import { ComparisonFindings } from "./ComparisonFindings";
import type { ComparisonFinding, RealComparison } from "./comparison-types";
import type {
  InsightReadSuccess,
  InsightReviewSupportInput,
  InsightSupportConsent,
  InsightSupportPassage,
  InsightSupportClaim,
  InsightImportFact,
  InsightPreviewSource,
} from "./insight-types";
import {
  isCurrentSupportConsent,
  partitionSupportFindings,
} from "./insight-support-presentation";
import { Button, Modal } from "./ui";
import { describeInsightFailure } from "./insight-presentation";

function PassageEvidence({
  passages,
  sources,
  comparison,
  summary = "Quoted passages for this claim",
}: {
  passages: InsightSupportPassage[];
  sources: InsightPreviewSource[];
  comparison: RealComparison;
  summary?: string;
}) {
  if (!passages.length)
    return (
      <p className="support-passage-note">
        No exact passage was supplied for this claim.
      </p>
    );
  return (
    <details className="support-passages">
      <summary>{summary}</summary>
      <p className="support-passage-note">
        Quoted text is located in the supplied evidence. Whether it supports the
        claim remains an AI assessment.
      </p>
      {passages.map((passage, index) => {
        const task = passage.kind === "task_context";
        const facts = passage.kind === "attempt_facts";
        const metadata = passage.kind === "source_metadata";
        const source =
          !facts && passage.sourceId !== null
            ? sources.find((item) => item.id === passage.sourceId)
            : null;
        const attempt = comparison.attempts.find(
          (item) => item.key === passage.attemptKey,
        );
        return (
          <figure
            className="support-passage"
            key={`${passage.sourceId ?? passage.attemptKey}:${index}`}
          >
            <figcaption>
              <strong>
                {task
                  ? "Task requirements"
                  : facts
                    ? "Attempt facts"
                    : metadata
                      ? "Source details"
                      : "Quoted passage"}
              </strong>
              {!facts && !task && (
                <span>
                  {metadata
                    ? source?.label ||
                      passage.label.replace(/^Source details · /, "")
                    : passage.label}
                </span>
              )}
              {!task && (
                <span>
                  {attempt?.model || passage.attemptKey}
                  {source ? ` · ${source.provenance}` : ""}
                </span>
              )}
            </figcaption>
            <blockquote>
              <pre>{passage.quote}</pre>
            </blockquote>
            {source && (
              <details className="support-passage-context">
                <summary>Source excerpt</summary>
                <pre>{source.excerpt}</pre>
              </details>
            )}
          </figure>
        );
      })}
    </details>
  );
}

function ClaimChecks({
  facts = [],
  groups,
  sources,
  comparison,
}: {
  facts?: InsightImportFact[];
  groups: { finding: ComparisonFinding; claims: InsightSupportClaim[] }[];
  sources: InsightPreviewSource[];
  comparison: RealComparison;
}) {
  const visible = groups.filter((group) => group.claims.length);
  const count = visible.reduce(
    (total, group) => total + group.claims.length,
    0,
  );
  if (!count) return null;
  return (
    <details className="support-claim-checks">
      <summary>
        Inspect claim checks{" "}
        <span>
          {count} {count === 1 ? "claim" : "claims"} · AI assessment
        </span>
      </summary>
      {visible.map(({ finding, claims }) => (
        <section key={finding.id} className="support-claim-group">
          <h4>{finding.title}</h4>
          {claims.map((claim, index) => {
            const sideIndex = /^sides\[(\d+)\]\.observation$/.exec(
              claim.field,
            )?.[1];
            const owner = claim.attemptKey
              ? finding.sides.find(
                  (side) => side.attemptKey === claim.attemptKey,
                )
              : undefined;
            const field =
              sideIndex === undefined
                ? claim.field.replace(/^./, (letter) => letter.toUpperCase())
                : `${owner?.model || claim.attemptKey || "Attempt"} observation`;
            return (
              <article
                className="support-claim"
                key={`${claim.unitId}:${index}`}
              >
                <div className="support-claim-label">
                  <span>{field}</span>
                  <span>
                    {claim.localCheck?.status === "unknown" &&
                    claim.providerAssessment?.verdict === "supported"
                      ? "Local evidence check · Needs review"
                      : claim.verdict === "supported"
                        ? "AI assessment · Supported"
                        : claim.verdict === "unsupported"
                          ? "AI assessment · Unsupported"
                          : "AI assessment · Needs review"}
                  </span>
                </div>
                <blockquote>{claim.text}</blockquote>
                <p>{claim.reason}</p>
                {claim.localCheck && (
                  <details className="support-local-check">
                    <summary>
                      {claim.localCheck.status === "matched"
                        ? "Matched import facts"
                        : "Why this needs inspection"}
                    </summary>
                    <p>{claim.localCheck.reason}</p>
                    {facts
                      .filter((fact) =>
                        claim.localCheck!.factIds.includes(fact.id),
                      )
                      .filter(
                        (fact, index, selected) =>
                          selected.findIndex(
                            (other) =>
                              other.sourceId === fact.sourceId &&
                              other.line === fact.line &&
                              other.declaration === fact.declaration,
                          ) === index,
                      )
                      .map((fact) => (
                        <figure key={fact.id}>
                          <figcaption>
                            {fact.path}:{fact.line} · {fact.attemptKey}
                          </figcaption>
                          <pre>{fact.declaration}</pre>
                          <details>
                            <summary>Saved source identity</summary>
                            <p>Source: {fact.sourceId}</p>
                            <p>SHA-256: {fact.sourceSha256}</p>
                          </details>
                        </figure>
                      ))}
                    {claim.providerAssessment && (
                      <p>
                        Original AI assessment:{" "}
                        {claim.providerAssessment.verdict.replaceAll("_", " ")}.{" "}
                        {claim.providerAssessment.reason}
                      </p>
                    )}
                  </details>
                )}
                <PassageEvidence
                  passages={claim.passages}
                  sources={sources}
                  comparison={comparison}
                />
              </article>
            );
          })}
        </section>
      ))}
    </details>
  );
}

export function SupportAttemptFactsPreview({
  facts,
}: {
  facts: NonNullable<InsightReadSuccess["input"]["attemptFacts"]>;
}) {
  if (!facts.length) return null;
  return (
    <details className="support-attempt-facts-preview">
      <summary>Attempt facts sent for review</summary>
      <p>
        The review can cite these saved attempt facts as well as the selected
        excerpts. They include attempt identities, check outcomes and their
        coverage.
      </p>
      {facts.map((fact) => (
        <details key={fact.attemptKey}>
          <summary>{fact.label}</summary>
          <pre>{fact.text}</pre>
        </details>
      ))}
    </details>
  );
}

export function SupportSourceDetailsPreview({
  details,
}: {
  details: NonNullable<InsightReadSuccess["input"]["sourceDetails"]>;
}) {
  if (!details.length) return null;
  return (
    <details className="support-source-details-preview">
      <summary>
        Source details sent for review · {details.length}{" "}
        {details.length === 1 ? "source" : "sources"}
      </summary>
      <p>
        These saved details describe each selected source, including provenance
        and capture limits. The review can cite them separately from the source
        excerpt.
      </p>
      {details.map((source) => (
        <details key={source.sourceId}>
          <summary>{source.label}</summary>
          <pre>{source.text}</pre>
        </details>
      ))}
    </details>
  );
}

function DraftText({ finding }: { finding: ComparisonFinding }) {
  return (
    <div className="support-draft-text">
      <span>{finding.category}</span>
      <h4>{finding.title}</h4>
      <p>{finding.summary}</p>
      <dl>
        <dt>Interpretation</dt>
        <dd>{finding.interpretation}</dd>
        {finding.sides.map((side) => (
          <div key={side.attemptKey}>
            <dt>{side.model || side.attemptKey}</dt>
            <dd>{side.observation}</dd>
          </div>
        ))}
        <dt>Limits</dt>
        <dd>{finding.limitations}</dd>
      </dl>
    </div>
  );
}

export function SupportReview({
  insight,
  comparison,
  canReview,
  actionBusy,
  onReview,
  onSettings,
  onSelect,
}: {
  insight: InsightReadSuccess;
  comparison: RealComparison;
  canReview: boolean;
  actionBusy: boolean;
  onReview: (request: InsightReviewSupportInput) => Promise<void>;
  onSettings: () => void;
  onSelect: (finding: ComparisonFinding) => void;
}) {
  const [open, setOpen] = useState(false);
  const [consented, setConsented] = useState(false);
  const [snapshot, setSnapshot] = useState<InsightSupportConsent | null>(null);
  const analysis = insight.analysis;
  const support = insight.support;
  const partition = useMemo(
    () => partitionSupportFindings(analysis?.findings ?? [], support),
    [analysis, support],
  );
  const consentIdentity =
    analysis && support?.reviewKey
      ? {
          analysisId: analysis.id,
          inputHash: insight.input.hash,
          settingsHash: insight.settingsHash,
          reviewKey: support.reviewKey,
        }
      : null;
  useEffect(() => {
    setOpen(false);
    setConsented(false);
    setSnapshot(null);
  }, [
    analysis?.id,
    insight.input.hash,
    insight.settingsHash,
    support?.reviewKey,
  ]);
  if (!analysis) return null;
  const running = support?.state === "running";
  const unavailable =
    support?.state === "failed" || support?.state === "interrupted";
  const failure =
    support?.state === "failed"
      ? describeInsightFailure(support.error, support.diagnostics)
      : null;
  const reviewed = partition.reviewed;
  const pendingCount = partition.pending.length;
  const title = reviewed
    ? pendingCount
      ? `${pendingCount} ${pendingCount === 1 ? "finding needs" : "findings need"} review`
      : "AI support review complete"
    : running
      ? "Checking whether the evidence supports each finding"
      : unavailable
        ? (failure?.title ?? "The support review did not complete")
        : support?.state === "stale"
          ? "This draft needs a current support review"
          : "Draft findings are ready for an evidence check";
  const explanation = reviewed
    ? partition.supported.length
      ? `${partition.supported.length} ${partition.supported.length === 1 ? "finding is" : "findings are"} shown below. This is an AI assessment of the selected evidence, not a correctness guarantee.`
      : "The evidence review left every finding needing inspection. Read the concerns and original evidence before relying on this draft."
    : running
      ? "One requested AI review is running. The original draft and recorded evidence remain available."
      : unavailable
        ? `${failure ? `${failure.description} ` : ""}The original draft is preserved and no findings have been promoted. No retry is started automatically. Retrying is a separate provider request and may incur a charge.`
        : !canReview
          ? "Read the draft below, or open AgentLens on desktop to run an AI evidence check."
          : "Check these findings against the recorded evidence before relying on them. The original draft is preserved.";
  const beginReview = () => {
    if (!canReview || actionBusy || running || !consentIdentity) return;
    if (
      !insight.settings.enabled ||
      !insight.settings.model ||
      (insight.settings.authMode !== "none" && !insight.settings.hasKey)
    ) {
      onSettings();
      return;
    }
    setSnapshot(consentIdentity);
    setConsented(false);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setConsented(false);
    setSnapshot(null);
  };
  const submit = () => {
    if (
      !consented ||
      !snapshot ||
      !isCurrentSupportConsent(snapshot, consentIdentity) ||
      actionBusy ||
      running ||
      !canReview
    )
      return;
    const request = {
      ...snapshot,
      requestId: crypto.randomUUID(),
      recheck: support?.state !== "not_reviewed",
    };
    close();
    void onReview(request);
  };
  return (
    <>
      <div
        className={`insight-state support-state ${(pendingCount && reviewed) || unavailable ? "warning" : "quiet"}`}
        role="status"
      >
        {running ? (
          <LoaderCircle size={20} className="spin" />
        ) : (
          <ShieldCheck size={20} />
        )}
        <div>
          <h3>{title}</h3>
          <p>{explanation}</p>
        </div>
        {!running && (
          <Button
            small
            variant="ghost"
            onClick={beginReview}
            disabled={!canReview || actionBusy || !consentIdentity}
          >
            {!canReview
              ? "Review in desktop"
              : reviewed
                ? "Review again"
                : unavailable
                  ? "Review & retry"
                  : "Review evidence support"}
          </Button>
        )}
      </div>
      {reviewed && partition.supported.length > 0 && (
        <div className="support-reviewed-findings">
          <p className="insight-ai-note">
            <ShieldCheck size={12} /> AI support review · Check the linked
            evidence before relying on a finding.
          </p>
          <ComparisonFindings
            review={{
              state: "available",
              id: analysis.id,
              method: "AI support review",
              findings: partition.supported,
            }}
            onSelect={(id) => {
              const finding = partition.supported.find(
                (item) => item.id === id,
              );
              if (finding) onSelect(finding);
            }}
          />
          <ClaimChecks
            facts={support?.review?.importFacts?.facts}
            groups={partition.supported.map((finding) => ({
              finding,
              claims:
                support?.review?.findings.find(
                  (item) => item.findingId === finding.id,
                )?.claims ?? [],
            }))}
            sources={insight.input.sources}
            comparison={comparison}
          />
        </div>
      )}
      {pendingCount > 0 && (
        <details
          className="support-pending"
          key={`${analysis.id}:${reviewed ? "reviewed" : "draft"}`}
        >
          <summary>
            {reviewed ? "Needs review" : "Unreviewed draft"}{" "}
            <span>
              {pendingCount} {pendingCount === 1 ? "finding" : "findings"} ·
              Original text preserved
            </span>
          </summary>
          <div className="support-pending-list">
            {partition.pending.map(({ finding, result }) => (
              <article key={finding.id}>
                <div className="support-finding-heading">
                  <span>
                    {result?.verdict === "unsupported"
                      ? "Flagged as unsupported by AI"
                      : result
                        ? "Evidence review · Needs qualification"
                        : "AI draft · Not reviewed"}
                  </span>
                  <h3>{finding.title}</h3>
                </div>
                <p className="support-original-summary">{finding.summary}</p>
                {result && (
                  <div className="support-concerns">
                    <p>{result.reason}</p>
                    {result.issues.map((issue, index) => (
                      <div key={index} className="support-issue">
                        <blockquote>{issue.claim}</blockquote>
                        <p>{issue.explanation}</p>
                        {issue.passages ? (
                          <PassageEvidence
                            passages={issue.passages}
                            sources={insight.input.sources}
                            comparison={comparison}
                            summary="Quoted passages used for this concern"
                          />
                        ) : (
                          !!issue.sourceIds.length && (
                            <details className="support-issue-sources">
                              <summary>Evidence used for this concern</summary>
                              {issue.sourceIds.map((id) => {
                                const source = insight.input.sources.find(
                                  (item) => item.id === id,
                                );
                                return source ? (
                                  <details key={id}>
                                    <summary>
                                      {source.provenance} · {source.label}
                                    </summary>
                                    <pre>{source.excerpt}</pre>
                                  </details>
                                ) : null;
                              })}
                            </details>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <ClaimChecks
                  facts={support?.review?.importFacts?.facts}
                  groups={[{ finding, claims: result?.claims ?? [] }]}
                  sources={insight.input.sources}
                  comparison={comparison}
                />
                <div className="support-draft-actions">
                  <details>
                    <summary>Read the full original finding</summary>
                    <DraftText finding={finding} />
                  </details>
                  <button
                    className="compare-finding-button"
                    onClick={() => onSelect(finding)}
                    aria-label={`Compare evidence: ${finding.category}`}
                  >
                    Compare evidence <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
      {reviewed && support?.review && (
        <details className="insight-metadata support-metadata">
          <summary>AI support review details</summary>
          <dl>
            <dt>Reviewer model</dt>
            <dd>{support.review.model}</dd>
            <dt>Endpoint</dt>
            <dd>{support.review.baseUrl}</dd>
            <dt>Created</dt>
            <dd>
              {support.review.createdAt
                ? new Date(support.review.createdAt).toLocaleString()
                : "Time unavailable"}
            </dd>
            <dt>Review revision</dt>
            <dd>{support.review.id}</dd>
            <dt>Review version</dt>
            <dd>
              {support.review.version} · {support.review.promptVersion}
            </dd>
          </dl>
        </details>
      )}
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        title="Review evidence support"
        description={`Send this saved draft and its selected evidence to ${insight.settings.baseUrl} using ${insight.settings.model}.`}
        className="insight-consent-modal support-consent-modal"
      >
        <div className="insight-consent-body">
          <p className="insight-request-limits">
            This is one additional provider request and may incur a charge, even
            if it fails. Up to{" "}
            {insight.settings.maxOutputTokens.toLocaleString()} output tokens ·{" "}
            {insight.settings.timeoutSeconds} seconds · reasoning{" "}
            {insight.settings.reasoningEffort}.
          </p>
          <section className="insight-task-preview">
            <span>SAME TASK AND SELECTED EVIDENCE</span>
            <h3>{comparison.title}</h3>
            <p>{comparison.taskPrompt || "Task description unavailable."}</p>
            <details className="insight-input-identities">
              <summary>Shared comparison identities</summary>
              <dl>
                <dt>Declared starting revision</dt>
                <dd>{comparison.baseCommit}</dd>
                <dt>Declared manifest</dt>
                <dd>{comparison.manifestHash}</dd>
                <dt>Task prompt SHA-256</dt>
                <dd>{comparison.promptHash}</dd>
                <dt>Independent check bundle</dt>
                <dd>{comparison.checkBundleHash || "Not supplied"}</dd>
                <dt>Declared time limit</dt>
                <dd>
                  {comparison.timeoutMs
                    ? `${Math.round(comparison.timeoutMs / 60000)} minutes each`
                    : "Not supplied"}
                </dd>
              </dl>
            </details>
          </section>
          <div className="insight-facts-preview">
            {comparison.attempts.map((attempt) => (
              <section key={attempt.key}>
                <span>RECORDED ATTEMPT FACTS</span>
                <h4>{attempt.model || attempt.key}</h4>
                <p>
                  {attempt.reasoningEffort || "Reasoning unavailable"} ·{" "}
                  {attempt.elapsedMs === null
                    ? "Elapsed unavailable"
                    : `${Math.round(attempt.elapsedMs / 1000)}s elapsed`}{" "}
                  · {attempt.run?.commandCount ?? "Unknown"} commands ·{" "}
                  {attempt.run?.failedCommandCount ?? "Unknown"} failed
                </p>
                <p>
                  {attempt.checks.length
                    ? attempt.checks
                        .map((check) => `${check.title}: ${check.outcome}`)
                        .join(" · ")
                    : "No independent checks supplied"}
                </p>
                {!!attempt.controlNotes.length && (
                  <p>
                    Declared controls and provenance:{" "}
                    {attempt.controlNotes.join(" ")}
                  </p>
                )}
              </section>
            ))}
          </div>
          {insight.input.taskContext && (
            <details className="support-attempt-facts-preview">
              <summary>Task requirements sent for review</summary>
              <p>
                These describe what was requested. They do not establish what
                either attempt implemented.
              </p>
              <pre>{insight.input.taskContext}</pre>
            </details>
          )}
          <SupportAttemptFactsPreview
            facts={insight.input.attemptFacts ?? []}
          />
          <details className="support-draft-preview">
            <summary>
              Saved draft sent for review · {analysis.findings.length}{" "}
              {analysis.findings.length === 1 ? "finding" : "findings"}
            </summary>
            {analysis.findings.map((finding) => (
              <DraftText key={finding.id} finding={finding} />
            ))}
          </details>
          <div className="insight-preview-summary">
            <span>
              {insight.input.coverage.includedSources} selected excerpts
            </span>
            <span>
              {insight.input.coverage.characters.toLocaleString()} characters
            </span>
            <span>
              {insight.input.coverage.omittedSources} omitted candidates
            </span>
          </div>
          <div className="insight-source-preview">
            {insight.input.sources.map((source) => (
              <details key={source.id}>
                <summary>
                  <span>
                    <strong>{source.provenance}</strong>
                    {source.label}
                  </span>
                  <span>
                    {comparison.attempts.find(
                      (attempt) => attempt.key === source.attemptKey,
                    )?.model || source.attemptKey}
                  </span>
                </summary>
                {source.path && (
                  <div className="insight-source-path">{source.path}</div>
                )}
                <pre>{source.excerpt}</pre>
              </details>
            ))}
          </div>
          <SupportSourceDetailsPreview
            details={insight.input.sourceDetails ?? []}
          />
          {!!insight.input.coverage.limits.length && (
            <div className="insight-limits">
              <Info size={14} />
              <div>
                <strong>Evidence limits</strong>
                {insight.input.coverage.limits.map((limit) => (
                  <p key={limit}>{limit}</p>
                ))}
              </div>
            </div>
          )}
          <label className="insight-consent-check">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
            />
            <span>
              I reviewed this draft and evidence and want to send them for this
              additional support review.
            </span>
          </label>
          <p className="insight-privacy-note">
            <Info size={13} /> AI review can miss errors. It does not rewrite
            the draft or establish that the code is correct.
          </p>
        </div>
        <div className="dialog-footer">
          <Button small variant="ghost" onClick={close}>
            Back
          </Button>
          <Button
            small
            variant="primary"
            onClick={submit}
            disabled={
              !consented ||
              actionBusy ||
              !snapshot ||
              !isCurrentSupportConsent(snapshot, consentIdentity)
            }
          >
            Start support review <ArrowRight size={13} />
          </Button>
        </div>
      </Modal>
    </>
  );
}
