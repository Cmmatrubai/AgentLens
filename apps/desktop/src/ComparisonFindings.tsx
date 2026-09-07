import { useId, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, GitCompareArrows, Info, ShieldCheck } from "lucide-react";
import { Button, Modal } from "./ui";
import type {
  ComparisonFinding,
  FindingSide,
  FindingSource,
  RealComparison,
} from "./comparison-types";

const modelName = (side: FindingSide) => side.model || side.attemptKey;
const modelSymbol = (side: FindingSide) =>
  (side.model || side.attemptKey).trim().slice(0, 1).toUpperCase() || "?";

export function ComparisonFindings({
  review,
  onSelect,
  variant = "generated",
}: {
  review: RealComparison["review"];
  onSelect: (id: string) => void;
  variant?: "generated" | "example";
}) {
  const headingId = useId();
  if (!review || review.state !== "available")
    return (
      <section className="findings-unavailable">
        <Info size={16} />
        <p>
          Comparison analysis is unavailable for this evidence. The recorded
          results remain below.
        </p>
      </section>
    );
  return (
    <section className="comparison-findings" aria-labelledby={headingId}>
      <div className="findings-heading">
        <div>
          <h2 id={headingId}>Where the attempts differ</h2>
          <p>
            {review.findings.length} evidence-grounded{" "}
            {review.findings.length === 1 ? "finding" : "findings"}.
          </p>
        </div>
        <span>
          {variant === "example"
            ? "Example analysis · Authored for C01"
            : "Generated analysis · This saved revision"}
        </span>
      </div>
      <div className="finding-cards">
        {review.findings.map((finding, index) => (
          <motion.article
            className="finding-card"
            key={finding.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 }}
          >
            <div className="finding-category">
              <span>0{index + 1}</span>
              {finding.category}
            </div>
            <h3>{finding.title}</h3>
            <p>{finding.summary}</p>
            <button
              className="compare-finding-button"
              aria-label={`Compare evidence: ${finding.category}`}
              onClick={() => onSelect(finding.id)}
            >
              Compare evidence <ArrowRight size={14} />
            </button>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

function Excerpt({ source }: { source: FindingSource }) {
  return (
    <div className="finding-excerpt">
      <div className="finding-source-heading">
        <span>
          {source.kind === "file"
            ? "FINAL DIFF EXCERPT"
            : source.kind === "check"
              ? "INDEPENDENT CHECK"
              : source.provenance === "Agent report"
                ? "AGENT REPORT"
                : "CAPTURED OUTPUT"}
        </span>
        <span>
          Lines {source.fromLine}–{source.toLine}
        </span>
      </div>
      {source.command && (
        <details className="finding-command">
          <summary>
            {source.kind === "check"
              ? "Independent check command"
              : "Recorded command"}
            {source.exitCode !== null
              ? ` · exit ${source.exitCode}`
              : " · exit unavailable"}
          </summary>
          <pre>{source.command}</pre>
        </details>
      )}
      <pre className="finding-code" aria-label={source.label}>
        {source.excerpt.split("\n").map((line, i) => (
          <span
            className={`finding-code-line ${source.kind === "file" && line.startsWith("+") ? "added" : source.kind === "file" && line.startsWith("-") ? "removed" : ""}`}
            key={i}
          >
            <span aria-hidden="true" className="finding-line-number">
              {source.fromLine + i}
            </span>
            <code>{line || " "}</code>
          </span>
        ))}
      </pre>
      {source.truncated && (
        <p className="finding-capture-note">
          This supplied excerpt is incomplete because capture or selection
          limits applied.
        </p>
      )}
      <details className="finding-full-source">
        <summary>Show supplied source text</summary>
        <pre>{source.fullSource}</pre>
      </details>
      <details className="finding-identity">
        <summary>Source identity</summary>
        <dl>
          <dt>Source</dt>
          <dd>{source.identity}</dd>
          <dt>Evidence SHA-256</dt>
          <dd>{source.sha256}</dd>
          <dt>Excerpt coordinates</dt>
          <dd>
            Lines in the displayed{" "}
            {source.kind === "file"
              ? "diff, not source-file line numbers"
              : source.kind === "check"
                ? "independent check output"
                : "recorded output"}
            .
          </dd>
        </dl>
      </details>
    </div>
  );
}

function EvidenceSide({ side, index }: { side: FindingSide; index: number }) {
  const [selectedId, setSelectedId] = useState(side.sources[0].id);
  const source =
    side.sources.find((s) => s.id === selectedId) ?? side.sources[0];
  return (
    <section
      className={`finding-evidence-side side-${index}`}
      aria-label={`${modelName(side)} evidence`}
    >
      <header>
        <span className="finding-model-symbol">{modelSymbol(side)}</span>
        <div>
          <h3>{modelName(side)}</h3>
          <p>
            {side.reasoningEffort
              ? `${side.reasoningEffort} reasoning · This attempt`
              : "Reasoning setting unavailable · This attempt"}
          </p>
        </div>
      </header>
      <div className="finding-observation">
        <span>OBSERVED IN THE EVIDENCE</span>
        <p>{side.observation}</p>
      </div>
      {side.sources.length > 1 && (
        <div
          className="finding-source-choices"
          role="group"
          aria-label={`Evidence sources for ${modelName(side)}`}
        >
          {side.sources.map((s) => (
            <button
              key={s.id}
              aria-pressed={s.id === source.id}
              onClick={() => setSelectedId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="finding-source-caption">
        <span>{source.provenance}</span>
        {source.path && <span>{source.path}</span>}
        {source.provenance === "Agent report" && (
          <span>Self-reported explanation</span>
        )}
      </div>
      <Excerpt key={source.id} source={source} />
    </section>
  );
}

export function FindingEvidenceDialog({
  finding,
  onClose,
  analysisLabel = "Generated analysis",
}: {
  finding: ComparisonFinding | null;
  onClose: () => void;
  analysisLabel?: string;
}) {
  return (
    <Modal
      open={!!finding}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={finding?.title ?? "Compare evidence"}
      description={
        finding
          ? `Matched evidence from ${finding.sides.map(modelName).join(" and ")} on the same task.`
          : "Matched evidence from both attempts on the same task."
      }
      className="finding-comparison-modal"
    >
      {finding && (
        <>
          <div className="finding-dialog-body">
            <div className="finding-interpretation">
              <GitCompareArrows size={19} />
              <div>
                <span>WHY IT MATTERS · INTERPRETATION</span>
                <p>{finding.interpretation}</p>
              </div>
            </div>
            <div className="finding-evidence-grid">
              {finding.sides.map((side, index) => (
                <EvidenceSide
                  key={finding.id + side.attemptKey}
                  side={side}
                  index={index}
                />
              ))}
            </div>
            <div className="finding-limit">
              <Info size={15} />
              <p>{finding.limitations}</p>
            </div>
          </div>
          <div className="dialog-footer">
            <span>
              <ShieldCheck size={13} /> {analysisLabel} · Source associations
              validated
            </span>
            <Button small onClick={onClose}>
              Back to findings
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
