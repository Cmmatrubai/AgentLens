import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  FileCode2,
  FileInput,
  GitBranch,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { Button, Modal } from "./ui";
import { MissingCheckResults } from "./ComparisonStates";
import type {
  ComparisonResponse,
  IndependentCheck,
  RealAttempt,
  RealComparison,
} from "./comparison-types";
import type { RecordedEvent } from "./recorded-types";
import {
  ComparisonFindings,
  FindingEvidenceDialog,
} from "./ComparisonFindings";
import { publicDemo as publicDemoBuild } from './app-capabilities';
import { loadPublicComparison } from './public-demo-data';
import { readComparisonData } from './comparison-data';
const InsightPanel = import.meta.env.MODE === 'demo' ? null : lazy(() => import('./InsightPanel').then(m => ({default: m.InsightPanel})));
const model = (a: RealAttempt) =>
  (a.model || a.key).replace(
    /^gpt-(.+)-(sol|terra)$/i,
    (_, version, family) =>
      `GPT-${version} ${family[0].toUpperCase()}${family.slice(1)}`,
  );
const attemptLabel = (a: RealAttempt) => a.key || a.model || "Attempt";
const reasoning = (a: RealAttempt) =>
  a.reasoningEffort
    ? `${a.reasoningEffort} reasoning`
    : "Reasoning unavailable";
const modelSymbol = (a: RealAttempt) =>
  (a.key || model(a)).trim().slice(0, 1).toUpperCase() || "?";
const elapsed = (ms: number | null) =>
  ms === null
    ? "Not available"
    : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
const state = (a: RealAttempt) =>
  a.state === "pending"
    ? "Waiting to start"
    : a.state === "recording"
      ? "Recording attempt"
      : a.run
        ? a.run.status === "completed"
          ? "Recorded"
          : `Recorded · ${a.run.status}`
        : a.state === "failed"
          ? "Execution unavailable"
          : "Preparing";
type Selection =
  | { kind: "check"; attempt: RealAttempt; check: IndependentCheck }
  | { kind: "run"; attempt: RealAttempt }
  | { kind: "event"; attempt: RealAttempt; event: RecordedEvent }
  | { kind: "file"; attempt: RealAttempt; index: number };
export function RealComparisonView({ publicView = 'case', bundledExample = false }: { publicView?: 'case' | 'evidence'; bundledExample?: boolean } = {}) {
  const publicDemo = publicDemoBuild || bundledExample;
  const [data, setData] = useState<RealComparison | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(false),
    [notSelected, setNotSelected] = useState(false),
    [importError, setImportError] = useState<string | null>(null),
    [selection, setSelection] = useState<Selection | null>(null),
    [findingId, setFindingId] = useState<string | null>(null),
    [sources, setSources] = useState(false);
  const overviewRef = useRef<HTMLElement>(null);
  const findingsRef = useRef<HTMLDivElement>(null);
  const attemptsRef = useRef<HTMLDivElement>(null);
  const checksRef = useRef<HTMLElement>(null);
  const jumpTo = (section: HTMLElement | null) => {
    if (!section) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };
  const generation = useRef(0),
    poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const read = useCallback(async () => {
    const id = ++generation.current;
    clearTimeout(poll.current);
    setBusy(true);
    try {
      const r: ComparisonResponse = bundledExample
        ? await loadPublicComparison(import.meta.env.BASE_URL)
        : await readComparisonData();
      if (id !== generation.current) return;
      if (!r.ok && r.error === "comparison_not_selected") {
        setData(null); setSelection(null); setFindingId(null); setSources(false);
        setError(false); setNotSelected(true); return;
      }
      setNotSelected(false);
      if (
        !r.ok ||
        r.comparison.schemaVersion !== 1 ||
        r.comparison.attempts.length !== 2
      )
        throw new Error("Unavailable");
      setData(r.comparison);
      setFindingId((previous) =>
        r.comparison.review?.findings.some((f) => f.id === previous)
          ? previous
          : null,
      );
      setSelection((previous) => {
        if (!previous) return null;
        const attempt = r.comparison.attempts.find(
          (a) => a.key === previous.attempt.key,
        );
        if (!attempt) return null;
        if (previous.kind === "check") {
          const check = attempt.checks.find((c) => c.id === previous.check.id);
          return check ? { kind: "check", attempt, check } : null;
        }
        if (previous.kind === "event") {
          const event = attempt.run?.events.find(
            (e) => e.id === previous.event.id,
          );
          return event ? { kind: "event", attempt, event } : null;
        }
        if (previous.kind === "file") {
          const path = previous.attempt.run?.git.files[previous.index]?.path;
          const index =
            attempt.run?.git.files.findIndex((f) => f.path === path) ?? -1;
          return index >= 0 ? { kind: "file", attempt, index } : null;
        }
        return { kind: "run", attempt };
      });
      setError(false);
      const recordingsComplete = r.comparison.attempts.every(
        (attempt) => attempt.run?.status === "completed",
      );
      if (
        !publicDemo && !r.comparison.imported &&
        (!recordingsComplete ||
          (!!r.comparison.checks.length && !r.comparison.ready))
      )
        poll.current = setTimeout(() => void read(), 10000);
    } catch {
      if (id === generation.current) {
        setNotSelected(false);
        setData(null);
        setSelection(null);
        setFindingId(null);
        setSources(false);
        setError(true);
      }
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }, [bundledExample, publicDemo]);
  useEffect(() => {
    void read();
    return () => {
      generation.current++;
      clearTimeout(poll.current);
    };
  }, [read]);
  const openPair = async (requireChecks = false) => {
    if (publicDemo || !window.agentlens || busy) return;
    const id = ++generation.current;
    clearTimeout(poll.current);
    setBusy(true);
    setImportError(null);
    try {
      const result = await window.agentlens.openInsightPair({ requireChecks });
      if (id !== generation.current) return;
      if (!result.ok) throw new Error(result.error);
      if (!result.cancelled) await read();
    } catch (error) {
      if (id === generation.current)
        setImportError(error instanceof Error && error.message === "evaluation_missing"
          ? "That file has no evaluated check results. Your current comparison is unchanged."
          : "The file could not be opened as a saved comparison. Your current comparison is unchanged.");
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  const complete = !!data?.attempts.every(
    (attempt) => attempt.run?.status === "completed",
  );
  const inconclusive =
    !!data &&
    complete &&
    data.attempts.some(
      (a) =>
        a.unknown > 0 ||
        data.checks.some(
          (check) => !a.checks.some((result) => result.id === check.id),
        ),
    );
  const hasChecks = !!data?.checks.length;
  const checksReady =
    !!data &&
    hasChecks &&
    data.attempts.every((attempt) => Number.isFinite(attempt.evaluatedAt));
  const bothPass =
    !!data &&
    complete &&
    checksReady &&
    data.attempts.every((a) =>
      data.checks.every(
        (check) =>
          a.checks.find((result) => result.id === check.id)?.outcome === "pass",
      ),
    );
  const different =
    !!data &&
    complete &&
    checksReady &&
    data.checks.some(
      (c) =>
        data.attempts[0].checks.find((x) => x.id === c.id)?.outcome !==
        data.attempts[1].checks.find((x) => x.id === c.id)?.outcome,
    );
  return (
    <div className="page recorded-page real-comparison-page">
      <div className="recorded-topline">
        <span className="recorded-badge">
          <span /> {publicDemo ? 'RECORDED CASE STUDY · EXAMPLE' : data?.imported ? 'YOUR COMPARISON · IMPORTED' : 'YOUR COMPARISON'}
        </span>
        {(!publicDemo || error) && <Button
          small
          variant="ghost"
          onClick={() => void read()}
          disabled={busy}
        >
          <RefreshCw size={13} className={busy ? "spin" : ""} />
          Refresh comparison
        </Button>}
      </div>
      {!data ? (
        <div className="recorded-loading" role={error ? "alert" : "status"}>
          {error || notSelected ? (
            <Info size={26} />
          ) : (
            <LoaderCircle size={26} className="spin" />
          )}
          <h1>
            {notSelected ? "No comparison selected yet." : error
              ? "Comparison evidence is unavailable."
              : "Opening your comparison."}
          </h1>
          <p>
            {notSelected ? "Start with your own task, or open a saved comparison. The recorded example is available separately." : error
              ? publicDemo ? "The bundled case could not be loaded or its integrity check failed. Try loading it again." : window.agentlens
                ? "Open a saved comparison, or try reading the local evidence again."
                : "The local reader could not validate the comparison. Open the desktop app to import saved evidence."
              : "Checking the frozen task and recorded attempt identities."}
          </p>
          {(error || notSelected) && !publicDemo && window.agentlens && (
            <Button onClick={() => void openPair()} disabled={busy}>
              <FileInput size={15} /> Open saved comparison
            </Button>
          )}
          {notSelected && <div className="comparison-empty-actions">
            <Button variant="primary" onClick={() => { window.location.hash = "/import"; }}>Start a comparison <ArrowRight size={15} /></Button>
            <Button variant="ghost" onClick={() => { window.location.hash = "/example"; }}>Explore the recorded example</Button>
          </div>}
          {error && (
            <Button variant="ghost" onClick={() => void read()} disabled={busy}>
              Try again
            </Button>
          )}
          {importError && <p role="alert">{importError}</p>}
        </div>
      ) : (
        <>
          <div className="real-comparison-heading">
            <div className="eyebrow">
              ONE TASK / TWO {data.imported ? "SAVED" : "CONTROLLED"} ATTEMPTS
            </div>
            <h1>{publicDemo && publicView === 'evidence' ? 'Follow the evidence.' : data.desktopRecorded ? 'Compare the approaches' : data.title}</h1>
            <p className={data.desktopRecorded ? "real-task-preview" : undefined}>
              {publicDemo && publicView === 'evidence' ? 'Inspect the selected recorded work and the checks run independently on both submissions.' : data.desktopRecorded ? (data.taskPrompt || data.title) : data.imported
                ? "Compare two recorded approaches to the same task. Open the details for the full request."
                : "Can an agent keep a malformed 64 MiB record from overwhelming the recorder?"}
            </p>
            <div className="real-controls">
              <span>
                <GitBranch size={13} />
                Same starting revision
              </span>
              <span>
                <ShieldCheck size={13} />
                {data.checks.length
                  ? `${data.checks.length} ${data.verificationKind === "command" ? "command" : "independent"} ${data.checks.length === 1 ? "check" : "checks"}`
                  : "No independent checks supplied"}
              </span>
              {!!data.timeoutMs && (
                <span>
                  <Clock3 size={13} />
                  {Math.round(data.timeoutMs / 60000)}-minute limit each
                </span>
              )}
              <button onClick={() => setSources(true)}>
                Comparison details
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
          {!publicDemo && <nav className="comparison-section-nav" aria-label="Jump to comparison section">
            <button type="button" aria-controls="comparison-overview" onClick={() => jumpTo(overviewRef.current)}>Overview</button>
            <button type="button" aria-controls="comparison-findings" onClick={() => jumpTo(findingsRef.current)}>Findings</button>
            <button type="button" aria-controls="comparison-attempts" onClick={() => jumpTo(attemptsRef.current)}>Attempts</button>
            <button type="button" aria-controls="comparison-checks" onClick={() => jumpTo(checksRef.current)}>Checks</button>
          </nav>}
          {(!publicDemo || publicView === 'case') && <section className="real-verdict comparison-jump-target" id="comparison-overview" ref={overviewRef} tabIndex={-1} aria-label="Comparison overview">
            <span className="real-verdict-kicker">
              {complete
                ? data.review?.state === "available"
                  ? "COMPARISON OVERVIEW"
                  : checksReady
                    ? data.verificationKind === "command" ? "COMMAND VERIFICATION" : "INDEPENDENT EVALUATION"
                    : "RECORDED EVIDENCE"
                : "COMPARISON IN PROGRESS"}
            </span>
            <h2>
              {!complete
                ? "The evidence is coming together."
                : data.verificationKind === "command"
                  ? inconclusive ? "Some command results remain unknown." : bothPass ? "The check command passed on both attempts." : different ? "Same check command. Different results." : "The check command failed on both attempts."
                : !hasChecks
                  ? "Independent correctness is unknown."
                  : !checksReady
                    ? data.imported
                      ? "Independent evaluation is incomplete."
                      : "Independent evaluation is pending."
                    : inconclusive
                      ? "Some conditions remain unverified."
                      : bothPass
                        ? data.review?.state === "available"
                          ? "Both passed. Their approaches differed."
                          : "Both attempts meet the checked conditions."
                        : different
                          ? "Same task. Different outcomes."
                          : "Both attempts have gaps to inspect."}
            </h2>
            <p>
              {!complete
                ? "Each model works in its own clean repository. Independent checks follow the recorded attempt."
                : data.verificationKind === "command"
                  ? "Your command ran separately on fresh copies of both saved attempts. A pass means it exited successfully; the command and its assertions determine what that proves. Open a result to inspect its output."
                : !hasChecks
                  ? "Both completed recordings can support workflow analysis, but this pair supplies no independent check outcomes."
                  : !checksReady
                    ? data.imported
                      ? "The supplied check coverage is incomplete across these attempts. Missing outcomes stay unknown."
                      : "Both recordings are complete. Independent check evidence is still pending."
                    : inconclusive
                      ? "Evaluation has finished. Unavailable results stay unknown; open a condition to inspect the recorded evaluator output."
                      : bothPass
                        ? "Review how they built and tested the solution, with evidence from both attempts."
                        : "The checks below show where each recorded attempt holds up and where more work is needed."}
            </p>
            {publicDemo && <div className="demo-result-pair">{data.attempts.map(a => <div key={a.key}><span>{model(a)} · {reasoning(a)}</span><strong>{a.passed} / {a.checks.length}<small> independent checks passed</small></strong></div>)}</div>}
          </section>}
          {!publicDemo && InsightPanel && <div className="comparison-jump-target" id="comparison-findings" ref={findingsRef} tabIndex={-1} role="region" aria-label="Generated findings">
            <Suspense fallback={<p role="status">Opening insight engine…</p>}><InsightPanel comparison={data} onComparisonChange={read} /></Suspense>
          </div>}
          {publicDemo && publicView === 'case' && <>
            <ComparisonFindings review={data.review} onSelect={setFindingId} variant="authored" />
            <div className="demo-evidence-next"><div><h2>Check the result for yourself.</h2><p>Open the recorded work and independent test results for each attempt.</p></div><a href="#/evidence">Explore evidence <ArrowRight size={16}/></a></div>
          </>}
          {!publicDemo && !data.imported && data.review?.state === "available" && (
            <details className="example-analysis">
              <summary>
                Case study notes
                <span>
                  Authored for C01 · separate from the AI draft
                </span>
              </summary>
              <ComparisonFindings
                review={data.review}
                onSelect={setFindingId}
                variant="authored"
              />
            </details>
          )}
          {(!publicDemo || publicView === 'evidence') && <><div className="real-attempts comparison-jump-target" id="comparison-attempts" ref={attemptsRef} tabIndex={-1} role="region" aria-label="Model attempts">
            {data.attempts.map((a, index) => (
              <motion.section
                className={`real-attempt side-${index} ${a.failed ? "has-failure" : ""}`}
                key={a.key}
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="real-attempt-top">
                  <span className="real-model-symbol">{modelSymbol(a)}</span>
                  <div>
                    <h3>{model(a)}</h3>
                    <span>{reasoning(a)}</span>
                  </div>
                  <span className="real-attempt-state">
                    {a.evaluatedAt
                      ? a.unknown
                        ? "Evaluation inconclusive"
                        : "Evaluated"
                      : state(a)}
                  </span>
                </div>
                <div className="real-attempt-metrics">
                  <div>
                    {a.checks.length ? (
                      <strong>
                        {a.passed}
                        <span> / {a.checks.length}</span>
                      </strong>
                    ) : (
                      <strong>—</strong>
                    )}
                    <small>
                      {a.checks.length
                        ? data.verificationKind === "command" ? "check commands passed" : "independent checks passed"
                        : "independent checks unavailable"}
                    </small>
                  </div>
                  <div>
                    <strong className="real-duration">
                      {elapsed(a.elapsedMs)}
                    </strong>
                    <small>recorder-observed elapsed</small>
                  </div>
                </div>
                <div className="real-attempt-bottom">
                  <span>
                    {a.failed > 0 ? `${a.failed} failed · ` : ""}
                    {a.unknown > 0
                      ? `${a.unknown} ${a.evaluatedAt ? "unverified" : "awaiting evidence"}`
                      : `${a.eventCount} recorded events`}
                  </span>
                  <Button
                    small
                    variant="ghost"
                    disabled={!a.run}
                    onClick={() => setSelection({ kind: "run", attempt: a })}
                  >
                    See recorded work
                    <ArrowRight size={13} />
                  </Button>
                </div>
              </motion.section>
            ))}
          </div>
          <section className="real-checks comparison-jump-target" id="comparison-checks" ref={checksRef} tabIndex={-1} aria-label={data.verificationKind === "command" ? "Command verification" : "Independent checks"}>
            <div className="recorded-section-heading">
              <h2>{data.verificationKind === "command" ? "What your command checked" : "What counts as success"}</h2>
              <span>
                {data.checks.length
                  ? data.verificationKind === "command" ? "User-defined command · run on both copies" : data.imported
                    ? "Check definitions · supplied with this pair"
                    : "Check definitions · frozen before execution"
                  : "No independent evaluation supplied"}
              </span>
            </div>
            {data.checks.length ? (
              <div
                className="real-check-table"
                role="table"
                aria-label={data.verificationKind === "command" ? "Command verification results" : "Independent comparison results"}
              >
                <div role="row" className="real-check-row real-check-header">
                  <span role="columnheader">Condition</span>
                  {data.attempts.map((a) => (
                    <span role="columnheader" key={a.key}>
                      {model(a)} ·{" "}
                      {a.reasoningEffort || "reasoning unavailable"}
                    </span>
                  ))}
                </div>
                {data.checks.map((c) => (
                  <div role="row" className="real-check-row" key={c.id}>
                    <span role="rowheader">{c.title}</span>
                    {data.attempts.map((a) => {
                      const check = a.checks.find((x) => x.id === c.id);
                      if (!check)
                        return (
                          <span
                            role="cell"
                            className="real-check-missing"
                            key={a.key}
                          >
                            Not supplied
                          </span>
                        );
                      return (
                        <span role="cell" key={a.key}>
                          <button
                            className={"real-check-result " + check.outcome}
                            onClick={() =>
                              setSelection({ kind: "check", attempt: a, check })
                            }
                            aria-label={`${model(a)}: ${c.title} — ${check.outcome}`}
                          >
                            <span>
                              {check.outcome === "pass" ? (
                                <Check size={14} />
                              ) : check.outcome === "fail" ? (
                                <X size={14} />
                              ) : (
                                <span className="unknown-dot" />
                              )}
                              {check.outcome === "pass"
                                ? "Passed"
                                : check.outcome === "fail"
                                  ? "Failed"
                                  : "Unknown"}
                            </span>
                            <ChevronRight size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <><MissingCheckResults canImport={!publicDemo && !!window.agentlens} busy={busy} onImport={() => void openPair(true)} onVerify={!publicDemo && data.desktopRecorded && /^[a-f0-9-]{36}$/.test(data.id) ? () => { window.location.hash = `/workspace/${data.id}`; } : undefined} />{data.verificationError && <p className="first-use-error" role="alert">Saved check evidence is unavailable. The original recordings remain inspectable; reopen the workspace to review the check status.</p>}</>
            )}
          {importError && <p className="first-use-error" role="alert">{importError}</p>}
          </section></>}
          <div className="real-scope">
            <Info size={15} />
            <p>
              {data.desktopRecorded
                ? "These two attempts were recorded in separate working copies at the same starting revision. Their results describe this task and these runs; they do not establish a general model ranking."
                : data.imported
                ? "This imported pair reflects identities and provenance supplied by its author. AgentLens validated its structure and local source associations, not the original recording process. It does not establish a general model ranking."
                : "This is one controlled pair on a historical task. It shows these attempts, not a general model ranking. The inherited regression suite includes one declared correction to a test that conflicted with the requested size limit."}
            </p>
          </div>
          <div className="recorded-read-stamp">
            <span>
              {publicDemo ? 'Selected public evidence · local paths replaced' : <>Read from preserved local evidence · {new Date(data.fetchedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}</>}
            </span>
            <span>{data.verificationKind === "command" ? "Agent claims and command verification stay separate." : "Agent claims and independent checks stay separate."}</span>
          </div>
        </>
      )}
      <FindingEvidenceDialog
        finding={data?.review?.findings.find((f) => f.id === findingId) ?? null}
        onClose={() => setFindingId(null)}
        analysisLabel="Authored case study notes"
      />
      <Modal
        open={!!selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        title={
          selection?.kind === "check"
            ? data?.verificationKind === "command" ? "Command verification evidence" : "Independent check evidence"
            : selection?.kind === "file"
              ? "Final Git changes"
              : "Recorded attempt evidence"
        }
        description={
          selection
            ? `${model(selection.attempt)} · ${reasoning(selection.attempt)}`
            : "Source evidence"
        }
        drawer
        className="recorded-drawer real-evidence-drawer"
      >
        {selection && (
          <>
            <div className="recorded-drawer-body">
              {selection.kind === "check" ? (
                <>
                  <div className="recorded-code-label">
                    {data?.verificationKind === "command" ? "COMMAND VERIFICATION" : "EXTERNAL EVALUATOR"} · {selection.check.outcome.toUpperCase()}
                  </div>
                  <h2>{selection.check.title}</h2>
                  <p className="recorded-content-note">
                    {data?.verificationKind === "command" ? "The same user-defined command ran in a fresh copy of each saved workspace. A pass means exit code zero; this does not independently establish that the whole task is correct. Snapshots capture the workspaces at verification time, including any later edits." : data?.imported
                      ? "This independent check result was supplied with the imported pair. It remains separate from the agent’s self-reported validation."
                      : "These results come from a separate evaluator checkout. They are not the agent’s self-reported validation."}
                  </p>
                  {selection.check.command && (
                    <details className="recorded-source-details">
                      <summary>View check command</summary>
                      <pre className="recorded-command-code">
                        {selection.check.command}
                      </pre>
                    </details>
                  )}
                  <pre className="recorded-output-code">
                    {data?.verificationKind === "command" && selection.check.output.startsWith(`Command: ${selection.check.command}\n`)
                      ? selection.check.output.slice(`Command: ${selection.check.command}\n`.length)
                      : selection.check.output}
                  </pre>
                  {selection.check.outputTruncated && (
                    <p className="recorded-content-note">
                      {data?.verificationKind === "command" ? "Only the first 16 KiB of command output was saved. The artifact hash identifies that saved excerpt." : data?.imported
                        ? "The supplied independent check output is truncated."
                        : "Display truncated to 180,000 characters. The full output remains in the hashed local artifact."}
                    </p>
                  )}
                  <details className="recorded-source-details">
                    <summary>Check source identity</summary>
                    {data?.verificationKind === "command" && <p>The saved artifact includes the command shown separately above and the execution output below.</p>}
                    <dl>
                      <dt>Artifact SHA-256</dt>
                      <dd>
                        {selection.check.artifactSha256 ?? "No artifact yet"}
                      </dd>
                      <dt>Attempt run ID</dt>
                      <dd>{selection.attempt.run?.id ?? "Not recorded yet"}</dd>
                      <dt>Evaluated snapshot</dt>
                      <dd>
                        {selection.attempt.snapshotHash ?? "Not evaluated yet"}
                      </dd>
                      <dt>Check ID</dt>
                      <dd>{selection.check.id}</dd>
                    </dl>
                    {data?.verificationKind === "command" && <pre className="recorded-output-code">{selection.check.output}</pre>}
                  </details>
                </>
              ) : selection.kind === "run" ? (
                <>
                  <div className="recorded-code-label">
                    PROVIDER RECORDS & FINAL GIT EVIDENCE
                  </div>
                  <h2>{model(selection.attempt)}’s recorded work</h2>
                  <p className="recorded-content-note">
                    {selection.attempt.run?.eventCount} events ·{" "}
                    {selection.attempt.run?.commandCount} recorded commands ·{" "}
                    {selection.attempt.run?.failedCommandCount} failed commands.
                    Recorded command outcomes are separate from independent
                    evaluation.
                  </p>
                  {publicDemo && <p className="recorded-boundary">This public selection includes {selection.attempt.run?.events.length} events and {selection.attempt.run?.git.files.length} changed files. The totals above describe the full original recording. Local paths are replaced; the original archive is not included.</p>}
                  {!!selection.attempt.controlNotes.length && (
                    <div className="recorded-boundary">
                      <Info size={14} />
                      <p>{selection.attempt.controlNotes.join(" ")}</p>
                    </div>
                  )}
                  <h3 className="real-drawer-section">Final Git changes</h3>
                  {selection.attempt.run?.git.files.length ? (
                    selection.attempt.run.git.files.map((f, i) => (
                      <button
                        className="real-evidence-row"
                        key={f.path}
                        onClick={() =>
                          setSelection({
                            kind: "file",
                            attempt: selection.attempt,
                            index: i,
                          })
                        }
                      >
                        <FileCode2 size={15} />
                        <span>{f.path}</span>
                        <ChevronRight size={13} />
                      </button>
                    ))
                  ) : (
                    <p className="recorded-content-note">
                      No final tracked diff is available.
                    </p>
                  )}
                  <h3 className="real-drawer-section">
                    Recorded commands and messages
                  </h3>
                  {selection.attempt.run?.events
                    .filter(
                      (e) =>
                        e.kind === "message.agent" ||
                        (e.kind === "command" && e.status !== "in_progress"),
                    )
                    .map((e) => (
                      <button
                        className="real-evidence-row"
                        key={e.id}
                        onClick={() =>
                          setSelection({
                            kind: "event",
                            attempt: selection.attempt,
                            event: e,
                          })
                        }
                      >
                        <span className="real-seq">#{e.sequence}</span>
                        <span>{e.command || "Agent message"}</span>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  <details className="recorded-source-details">
                    <summary>Run identity and capture</summary>
                    <dl>
                      <dt>Run ID</dt>
                      <dd>{selection.attempt.run?.id}</dd>
                      <dt>Capture status</dt>
                      <dd>{selection.attempt.run?.status}</dd>
                      <dt>Model source</dt>
                      <dd>
                        {data?.desktopRecorded
                          ? "Requested model from the frozen AgentLens launch settings"
                          : data?.imported
                          ? "Supplied by the imported comparison author"
                          : "Frozen launch configuration, verified against recorded invocation"}
                      </dd>
                    </dl>
                  </details>
                </>
              ) : selection.kind === "event" ? (
                <>
                  <Button
                    small
                    variant="ghost"
                    onClick={() =>
                      setSelection({ kind: "run", attempt: selection.attempt })
                    }
                  >
                    <ArrowLeft size={13} />
                    Back to attempt
                  </Button>
                  <div className="recorded-code-label">
                    PROVIDER EVENT #{selection.event.sequence}
                  </div>
                  <h2>
                    {selection.event.kind === "command"
                      ? "Recorded command"
                      : "Agent message"}
                  </h2>
                  {selection.event.command && (
                    <>
                      <div className="recorded-content-note">
                        {selection.event.exitCode === null
                          ? "Exit status unavailable"
                          : `Recorded exit ${selection.event.exitCode}`}
                      </div>
                      <pre className="recorded-command-code">
                        {selection.event.command}
                      </pre>
                      <pre className="recorded-output-code">
                        {selection.event.outputState === "unavailable"
                          ? "Captured output is unavailable."
                          : selection.event.output}
                      </pre>
                      {selection.event.outputState === "truncated" && (
                        <p className="recorded-content-note">
                          Output display is truncated.
                        </p>
                      )}
                    </>
                  )}
                  {selection.event.message && (
                    <>
                      <pre className="recorded-output-code">
                        {selection.event.message}
                      </pre>
                      <p className="recorded-content-note">
                        The agent’s explanation is separate from independent
                        check results.
                      </p>
                    </>
                  )}
                  <details className="recorded-source-details">
                    <summary>Original event identity</summary>
                    <dl>
                      <dt>Event ID</dt>
                      <dd>{selection.event.id}</dd>
                      <dt>Provenance</dt>
                      <dd>{selection.event.provenance}</dd>
                      <dt>Artifact ID</dt>
                      <dd>
                        {selection.event.artifactId ?? "Inline or unavailable"}
                      </dd>
                    </dl>
                  </details>
                </>
              ) : (
                <>
                  <Button
                    small
                    variant="ghost"
                    onClick={() =>
                      setSelection({ kind: "run", attempt: selection.attempt })
                    }
                  >
                    <ArrowLeft size={13} />
                    Back to attempt
                  </Button>
                  <div className="recorded-code-label">
                    GIT EVIDENCE · FINAL STATE
                  </div>
                  <h2>
                    {selection.attempt.run?.git.files[selection.index].path}
                  </h2>
                  <p className="recorded-content-note">
                    The final repository diff is not attributed to a single
                    agent action.
                  </p>
                  <pre className="recorded-output-code real-diff">
                    {selection.attempt.run?.git.files[selection.index].content}
                  </pre>
                  {selection.attempt.run?.git.files[selection.index]
                    .truncated && (
                    <p className="recorded-content-note">
                      Diff display is truncated.
                    </p>
                  )}
                  <details className="recorded-source-details">
                    <summary>Artifact identity</summary>
                    <p>{selection.attempt.run?.git.artifactId}</p>
                  </details>
                </>
              )}
            </div>
            <div className="dialog-footer">
              <span>
                <ShieldCheck size={12} /> Read-only evidence
              </span>
              <Button small onClick={() => setSelection(null)}>
                Close evidence
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={sources}
        onOpenChange={setSources}
        title="Comparison details"
        description="The shared conditions and limits of this pair."
        className="recorded-source-modal"
      >
        {data && (
          <>
            <div className="recorded-drawer-body">
              <details className="recorded-source-details">
                <summary>Full task request</summary>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {data.taskPrompt || "Task description unavailable."}
                </p>
              </details>
              <dl className="recorded-source-grid">
                <dt>Models</dt>
                <dd>
                  {data.attempts.map((attempt) => (
                    <span className="recorded-source-model" key={attempt.key}>
                      {model(attempt)} /{" "}
                      {attempt.reasoningEffort || "reasoning unavailable"}
                    </span>
                  ))}
                </dd>
                <dt>Starting revision</dt>
                <dd>{data.baseCommit}</dd>
                <dt>
                  {publicDemo ? "Original frozen manifest" : data.imported ? "Manifest identity" : "Frozen manifest"}
                </dt>
                <dd>{data.manifestHash}</dd>
                <dt>Prompt SHA-256</dt>
                <dd>{data.promptHash}</dd>
                <dt>Independent check bundle</dt>
                <dd>{data.checkBundleHash || "Not supplied"}</dd>
                <dt>{data.desktopRecorded ? "Execution" : "Execution order"}</dt>
                <dd>
                  {data.attempts.map(attemptLabel).join(data.desktopRecorded ? " and " : ", then ")}
                  {data.desktopRecorded ? " · concurrent recorded attempts" :
                  data.imported
                    ? " · supplied order"
                    : " · one intended attempt each"}
                </dd>
                <dt>Time limit</dt>
                <dd>
                  {data.timeoutMs
                    ? `${Math.round(data.timeoutMs / 60000)} minutes each`
                    : "Not supplied"}
                </dd>
              </dl>
              <p className="recorded-content-note">
                {publicDemo ? "This browser view loads a selected public snapshot and verifies it against the bundled content manifest. Local paths were replaced and exported text has new hashes. Original identifiers refer to the preserved recording, which is not bundled here." : data.desktopRecorded ? "AgentLens recorded both attempts locally and validated their saved result structure and matching starting revisions. Viewing this comparison does not execute a model." : data.imported
                  ? "The pair author supplied the identities and provenance. AgentLens validated the bundle structure and local source associations. Viewing it does not execute a model."
                  : "Completed recorder evidence was validated by AgentLens and preserved locally. Each read verifies its saved byte hashes. Viewing this comparison does not execute a model."}
              </p>
              <p className="recorded-content-note">
                {data.verificationKind === "command" ? "The user-defined command ran separately on fresh copies of the saved workspaces at verification time. Its exit code and bounded output are preserved. This does not guarantee independently authored assertions, exhaustive task correctness, or a model-wide ranking." : data.desktopRecorded ? "No independent evaluator was run for this pair. Agent reports and recorded command outcomes can inform analysis, but they do not establish that the requested task was completed correctly." : data.imported
                  ? "Independent check results are shown exactly as supplied and remain separate from recorded commands and agent reports. Their coverage is not exhaustive or a model-wide score."
                  : "The evaluator runs separately with restored original test assertions and one disclosed historical boundary correction. Passing these checks is bounded evidence; it is not exhaustive verification or a model-wide score."}
              </p>
              {data.startupFailures.map((f) => (
                <div className="recorded-boundary" key={f.runId}>
                  <Info size={14} />
                  <p>
                    <strong>Preserved startup failure</strong>
                    <br />
                    {f.reason}
                    <br />
                    Run {f.runId}
                  </p>
                </div>
              ))}
              {data.attempts.some(
                (attempt) => attempt.coverageLimits.length > 0,
              ) && (
                <details className="recorded-source-details">
                  <summary>Coverage limits</summary>
                  {data.attempts.flatMap((attempt) =>
                    attempt.coverageLimits.map((limit) => (
                      <p key={`${attempt.key}:${limit}`}>
                        <strong>{model(attempt)}:</strong> {limit}
                      </p>
                    )),
                  )}
                </details>
              )}
            </div>
            <div className="dialog-footer">
              <Button onClick={() => setSources(false)}>
                Back to comparison
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
