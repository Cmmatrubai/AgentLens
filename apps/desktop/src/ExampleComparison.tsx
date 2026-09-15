import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "./ui";
import { loadPublicComparison } from "./public-demo-data";
import { FindingEvidenceDialog } from "./ComparisonFindings";
import { RealComparisonView } from "./RealComparisonView";
import type { RealComparison } from "./comparison-types";

const name = (model: string) =>
  model.replace(
    /^gpt-(.+)-(sol|terra)$/i,
    (_, version, family) =>
      `GPT-${version} ${family[0].toUpperCase()}${family.slice(1)}`,
  );
export function ExampleComparison({ onOwn }: { onOwn: () => void }) {
  const [data, setData] = useState<RealComparison | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(0);
  const [evidence, setEvidence] = useState(false);
  const [allEvidence, setAllEvidence] = useState(false);
  const section = useRef<HTMLElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    let active = true;
    setError(false);
    loadPublicComparison(import.meta.env.BASE_URL)
      .then((result) => {
        if (active) {
          if (result.ok) setData(result.comparison);
          else setError(true);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    if (allEvidence) backButton.current?.focus();
  }, [allEvidence]);
  if (error)
    return (
      <div className="first-use" role="alert">
        <h1>The example couldn’t be opened.</h1>
        <p>
          The bundled evidence is missing or could not be verified. Your own
          comparison is unaffected.
        </p>
        <Button onClick={() => setRetry((v) => v + 1)}>Try again</Button>
      </div>
    );
  if (!data)
    return (
      <div className="first-use" role="status">
        Opening the recorded example…
      </div>
    );
  if (allEvidence)
    return (
      <>
        <div className="example-evidence-back">
          <Button
            ref={backButton}
            variant="ghost"
            onClick={() => {
              setAllEvidence(false);
              requestAnimationFrame(() => section.current?.focus());
            }}
          >
            <ArrowLeft size={16} /> Back to the example
          </Button>
        </div>
        <RealComparisonView bundledExample publicView="evidence" />
      </>
    );
  const findings = data.review.findings;
  const finding = findings[selected] ?? findings[0];
  return (
    <div className="first-use example-page">
      <div className="eyebrow">EXPLORE AN EXAMPLE · REAL RECORDINGS</div>
      <h1>Two agents. One task.</h1>
      <p className="first-use-lead">
        The task: keep unexpectedly large agent output from overwhelming the
        recorder. Both agents started from the same code, with the same time
        limit.
      </p>
      <section className="example-result" aria-label="Example result">
        <div>
          <span className="example-result-kicker">THE RESULT</span>
          <h2>
            Both passed.
            <br />
            Their approaches differed.
          </h2>
        </div>
        <div className="example-model-results">
          {data.attempts.map((a) => (
            <div key={a.key}>
              <span>{name(a.model)}</span>
              <strong>
                <Check size={17} /> {a.passed} / {data.checks.length}
              </strong>
              <small>independent checks passed</small>
            </div>
          ))}
        </div>
      </section>
      <p className="example-scope">
        <Info size={15} /> One task shows differences between these attempts. It
        doesn’t establish which model is best overall.
      </p>
      <section
        className="example-explore"
        ref={section}
        tabIndex={-1}
        aria-label="Explore model differences"
      >
        <div className="example-section-heading">
          <h2>What would you like to understand?</h2>
          <span>Authored case notes · Evidence linked</span>
        </div>
        <div className="example-difference-layout">
          <div
            className="example-choices"
            role="group"
            aria-label="Choose a difference"
          >
            {findings.map((f, index) => (
              <button
                key={f.id}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                <span className="example-choice-number">0{index + 1}</span>
                <span>{f.category}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
          {finding && (
            <motion.article
              className="example-insight"
              key={finding.id}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <h3>{finding.title}</h3>
              <p className="example-insight-summary">{finding.summary}</p>
              <div className="example-meaning">
                <h4>Why it matters</h4>
                <p>{finding.interpretation}</p>
              </div>
              <p className="example-insight-limit">
                <Info size={14} />
                {finding.limitations}
              </p>
              <Button onClick={() => setEvidence(true)}>
                Show evidence <ArrowRight size={15} />
              </Button>
            </motion.article>
          )}
        </div>
      </section>
      <div className="example-next">
        <div>
          <h2>Now try a task of your own.</h2>
          <p>Bring a saved comparison and explore what matters to you.</p>
        </div>
        <Button variant="primary" onClick={onOwn}>
          Compare your own agents <ArrowRight size={16} />
        </Button>
      </div>
      <Button variant="ghost" onClick={() => setAllEvidence(true)}>
        Explore all included evidence <ArrowRight size={15} />
      </Button>
      <FindingEvidenceDialog
        finding={evidence ? (finding ?? null) : null}
        onClose={() => setEvidence(false)}
        analysisLabel="Authored example notes"
      />
    </div>
  );
}
