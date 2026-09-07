import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  FileCode2,
  FileText,
  FolderGit2,
  GitBranch,
  Info,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  WifiOff,
  X,
} from "lucide-react";
import { AnimatedTabs, Button, Modal } from "./ui";
import type {
  RecordedEvent,
  RecordedResponse,
  RecordedRun,
} from "./recorded-types";
import comparisonTargets from "../comparison-targets.json";
const date = (value: number | string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const duration = (ms: number | null) =>
  ms === null
    ? "Unavailable"
    : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
const shortPath = (path: string) =>
  path.replace(/^\[workspace\]\//, "").replace(/^.*\/worktree\//, "");
const provenance = (e: RecordedEvent) =>
  e.provenance === "observed"
    ? "Provider record"
    : e.provenance === "human"
      ? "Human assessment"
      : e.provenance === "git_recovered"
        ? "Git evidence"
        : e.provenance === "derived"
          ? "Derived interpretation"
          : "Recorder event";
const label = (e: RecordedEvent) =>
  e.kind === "command"
    ? e.command || "Command text unavailable"
    : e.kind === "file.change"
      ? e.files.map((f) => shortPath(f.path)).join(", ") ||
        "File-change metadata"
      : e.kind === "message.agent"
        ? "Agent message"
        : e.summary;
const terminal = (e: RecordedEvent) => e.status !== "in_progress";
function outcome(e: RecordedEvent) {
  return e.testOutcome === "unknown"
    ? "Check outcome unknown"
    : e.kind === "command" && e.exitCode !== null
      ? `Exit ${e.exitCode}`
      : e.status.replaceAll("_", " ");
}
function statusClass(e: RecordedEvent) {
  return e.testOutcome === "unknown"
    ? "unknown"
    : e.status === "failed" || (e.exitCode !== null && e.exitCode !== 0)
      ? "failed"
      : "neutral";
}
export function RecordedRunView() {
  const [run, setRun] = useState<RecordedRun | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<
    "overview" | "commands" | "changes" | "ledger"
  >("overview");
  const [selected, setSelected] = useState<RecordedEvent | null>(null),
    [file, setFile] = useState<number | null>(null),
    [filter, setFilter] = useState<"all" | "failed" | "tests">("all"),
    [query, setQuery] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const request = useRef(0);
  const read = useCallback(async () => {
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const data: RecordedResponse = window.agentlens
        ? await window.agentlens.readRecordedRun()
        : await fetch("/api/recorded-run", {
            headers: { "X-AgentLens-Read": "1" },
            cache: "no-store",
          }).then((r) => r.json());
      if (id !== request.current) return;
      if (!data.ok) throw new Error(data.error);
      if (
        data.run.schemaVersion !== 1 ||
        !Array.isArray(data.run.events) ||
        data.run.events.length !== data.run.eventCount
      )
        throw new Error("validation_failed");
      setRun(data.run);
      setSelected(null);
      setFile(null);
    } catch (e) {
      if (id !== request.current) return;
      setError(e instanceof Error ? e.message : "unavailable");
      setRun(null);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void read();
    return () => {
      request.current++;
    };
  }, [read]);
  const commands =
    run?.events.filter((e) => e.kind === "command" && terminal(e)) ?? [];
  const checks = commands.filter((e) => e.testOutcome !== null);
  const firstFailure =
    checks.find((e) => e.testOutcome === "fail") ??
    commands.find((e) => e.status === "failed");
  const finalValidation = checks.at(-1);
  const finalMessage = run?.events
    .filter((e) => e.kind === "message.agent")
    .at(-1);
  const showEvents =
    tab === "commands"
      ? commands.filter(
          (e) =>
            (filter !== "failed" || e.status === "failed") &&
            (filter !== "tests" || e.testOutcome !== null),
        )
      : (run?.events ?? []);
  const filtered = showEvents.filter((e) =>
    `${label(e)} ${e.sequence} ${e.kind}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const openEvent = (e: RecordedEvent) => {
    setSelected(e);
    setSourceOpen(false);
  };
  return (
    <div className="page recorded-page">
      <div className="recorded-topline">
        <span className="recorded-badge">
          <span /> REAL RECORDING · READ ONLY
        </span>
        <Button
          small
          variant="ghost"
          onClick={() => void read()}
          disabled={busy}
        >
          <RefreshCw size={13} className={busy ? "spin" : ""} />
          Refresh evidence
        </Button>
      </div>
      {busy && !run ? (
        <div className="recorded-loading" role="status">
          <LoaderCircle className="spin" size={25} />
          <h1>Opening the recorded evidence.</h1>
          <p>Reading the original run and validating its stored artifacts.</p>
        </div>
      ) : error ? (
        <div className="recorded-loading" role="alert">
          <WifiOff size={27} />
          <h1>Evidence is unavailable right now.</h1>
          <p>
            {error === "active_evidence"
              ? "The recording has an active database journal. It has been left untouched."
              : error === "validation_failed"
                ? "The reader could not validate this evidence. No sample data has been substituted."
                : "The local reader or configured recording could not be reached."}
          </p>
          <Button onClick={() => void read()}>Try again</Button>
        </div>
      ) : (
        run && (
          <>
            <div className="page-heading recorded-heading">
              <div>
                <div className="eyebrow">
                  T01 · A1 <span className="meta-dot">/</span> RECORDED CODING
                  TASK
                </div>
                <h1>{run.title}</h1>
                <p>
                  A historical agent run, connected directly to the evidence
                  ledger.
                </p>
              </div>
              <span className="recorded-date">{date(run.startedAt)}</span>
            </div>
            <div className="recorded-context">
              <span>
                <Terminal size={13} />
                {run.provider}
              </span>
              <span>
                <Clock3 size={13} />
                {duration(run.elapsedMs)} recorded
              </span>
              <span>
                <FileText size={13} />
                {run.eventCount} events
              </span>
              <button onClick={() => setSourceOpen(true)}>
                Source & provenance
                <ChevronRight size={12} />
              </button>
            </div>
            <AnimatedTabs
              id="recorded"
              tabs={[
                { id: "overview", label: "Overview" },
                { id: "commands", label: "Commands", count: commands.length },
                {
                  id: "changes",
                  label: "Final changes",
                  count: run.git.files.length,
                },
                {
                  id: "ledger",
                  label: "Evidence ledger",
                  count: run.eventCount,
                },
              ]}
              value={tab}
              onChange={(v) => {
                setTab(v);
                setQuery("");
                setFilter("all");
              }}
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                role="tabpanel"
                id="recorded-panel"
                aria-labelledby={"recorded-" + tab}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {tab === "overview" && (
                  <>
                    <div className="recorded-verdict">
                      <span className="state-badge neutral">
                        {run.status === "completed"
                          ? "Execution completed"
                          : run.status}
                      </span>
                      <h2>
                        {run.failedCommandCount
                          ? "A completed run with failures worth inspecting."
                          : "Follow the recorded result back to its source."}
                      </h2>
                      <p>
                        {run.failedCommandCount
                          ? "The agent finished its work. Some recorded commands failed, so completion alone does not settle correctness."
                          : "The recorded process state, command results and human review are kept separately."}
                      </p>
                    </div>
                    <div className="recorded-summary-grid">
                      <div className="recorded-finding">
                        <span className="summary-kicker">
                          RECORDED COMMANDS
                        </span>
                        <div className="recorded-count">
                          <strong>{run.commandCount}</strong>
                          <span>{run.failedCommandCount} failed commands</span>
                        </div>
                        <p>Command exit status comes from the recording.</p>
                        <button
                          className="text-action"
                          onClick={() => {
                            setFilter("failed");
                            setTab("commands");
                          }}
                        >
                          Inspect command failures
                          <ArrowRight size={13} />
                        </button>
                      </div>
                      <div className="recorded-finding">
                        <span className="summary-kicker">
                          HISTORICAL HUMAN REVIEW
                        </span>
                        <div className="recorded-assessment">
                          <strong>{run.assessment.verdict}</strong>
                          <span>
                            Task completed: {run.assessment.taskCompleted}
                          </span>
                        </div>
                        <p>
                          Saved separately from the agent’s completion message.
                        </p>
                        <button
                          className="text-action"
                          onClick={() => {
                            const e = run.events.find(
                              (e) => e.id === run.assessment.eventId,
                            );
                            if (e) openEvent(e);
                            else setSourceOpen(true);
                          }}
                        >
                          Inspect assessment source
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="recorded-section-head">
                      <h2>Start with the evidence that matters</h2>
                      <span>From this recorded attempt</span>
                    </div>
                    <div className="recorded-landmarks">
                      {firstFailure && (
                        <button onClick={() => openEvent(firstFailure)}>
                          <span className="landmark-icon amber-text">
                            <Terminal size={18} />
                          </span>
                          <span>
                            <strong>A test command failed</strong>
                            <small>
                              Read its captured output and exit status.
                            </small>
                          </span>
                          <span className="recorded-seq">
                            #{firstFailure.sequence}
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      )}
                      {finalValidation && (
                        <button onClick={() => openEvent(finalValidation)}>
                          <span className="landmark-icon">
                            <ListChecks size={18} />
                          </span>
                          <span>
                            <strong>Later validation was recorded</strong>
                            <small>
                              Inspect the output; a compound command has limited
                              test attribution.
                            </small>
                          </span>
                          <span className="recorded-seq">
                            #{finalValidation.sequence}
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      )}
                      <button onClick={() => setTab("changes")}>
                        <span className="landmark-icon">
                          <FileCode2 size={18} />
                        </span>
                        <span>
                          <strong>The final Git changes are preserved</strong>
                          <small>
                            {run.git.files.length} changed files in the
                            validated final-diff artifact.
                          </small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    </div>
                    <div className="recorded-boundary">
                      <Info size={14} />
                      <p>
                        This is one historical attempt. It does not establish a
                        model ranking. The saved review remains historical;
                        later independent evaluation is outside this recording.
                      </p>
                    </div>
                    <div className="next-comparison">
                      <div>
                        <span className="summary-kicker">
                          CONTROLLED COMPARISON
                        </span>
                        <strong>
                          Sol · High <span>versus</span> Terra · High
                        </strong>
                      </div>
                      <span>
                        <button
                          className="real-comparison-link"
                          onClick={() => {
                            location.hash = "/comparison";
                          }}
                        >
                          Open the comparison →
                        </button>
                      </span>
                    </div>
                  </>
                )}
                {(tab === "commands" || tab === "ledger") && (
                  <>
                    <div className="recorded-list-tools">
                      <div>
                        {tab === "commands" ? (
                          <>
                            <button
                              className={filter === "all" ? "active" : ""}
                              onClick={() => setFilter("all")}
                            >
                              All commands
                            </button>
                            <button
                              className={filter === "failed" ? "active" : ""}
                              onClick={() => setFilter("failed")}
                            >
                              Failed
                            </button>
                            <button
                              className={filter === "tests" ? "active" : ""}
                              onClick={() => setFilter("tests")}
                            >
                              Test-bearing
                            </button>
                          </>
                        ) : (
                          <span>All recorded events · original sequence</span>
                        )}
                      </div>
                      <label className="recorded-search">
                        <Search size={13} />
                        <input
                          aria-label="Search recorded evidence"
                          placeholder="Find an action or sequence…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    {tab === "commands" && filter === "tests" && (
                      <div className="recorded-boundary">
                        <Info size={14} />
                        <p>
                          {run.tests.total} test-bearing commands:{" "}
                          {run.tests.failed} classified failed,{" "}
                          {run.tests.unknown} unknown. Compound commands do not
                          provide an individual test exit status.
                          Classification: {run.tests.derivation}, derived when
                          read.
                        </p>
                      </div>
                    )}
                    <div className="recorded-event-list">
                      {filtered.map((e) => (
                        <button key={e.id} onClick={() => openEvent(e)}>
                          <span className="recorded-seq">#{e.sequence}</span>
                          <span className={"event-kind " + statusClass(e)}>
                            {e.kind === "command" ? (
                              <Terminal size={15} />
                            ) : e.kind === "file.change" ? (
                              <FileCode2 size={15} />
                            ) : (
                              <FileText size={15} />
                            )}
                          </span>
                          <span className="recorded-event-label">
                            <strong>{label(e)}</strong>
                            <small>
                              {tab === "ledger" ? e.kind : provenance(e)} ·{" "}
                              {new Date(e.receivedAt).toLocaleTimeString()}
                            </small>
                          </span>
                          <span
                            className={"recorded-outcome " + statusClass(e)}
                          >
                            {outcome(e)}
                          </span>
                          <ChevronRight size={13} />
                        </button>
                      ))}
                    </div>
                    {!filtered.length && (
                      <div className="recorded-empty">
                        <Search size={22} />
                        <h2>No matching evidence</h2>
                        <p>
                          Try a different command, event type or sequence
                          number.
                        </p>
                        <Button
                          small
                          onClick={() => {
                            setQuery("");
                            setFilter("all");
                          }}
                        >
                          Clear filters
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {tab === "changes" && (
                  <>
                    <div className="recorded-section-head">
                      <div>
                        <h2>Final Git changes</h2>
                        <p>
                          Recovered at the end of the run. These are not
                          per-action patches.
                        </p>
                      </div>
                      <span>{run.git.files.length} files</span>
                    </div>
                    <div className="recorded-files">
                      {run.git.files.map((f, i) => (
                        <button key={f.path} onClick={() => setFile(i)}>
                          <FileCode2 size={17} />
                          <span>
                            <strong>{shortPath(f.path)}</strong>
                            <small>
                              Validated redacted artifact · Git evidence
                            </small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                    {run.git.state !== "available" && (
                      <div className="recorded-empty">
                        <Info size={22} />
                        <h2>Final diff unavailable</h2>
                        <p>No validated diff is available for this record.</p>
                      </div>
                    )}
                    <div className="recorded-boundary">
                      <ShieldCheck size={14} />
                      <p>
                        Artifact identity is verified before reading. Opening a
                        diff does not apply it to your repository.
                      </p>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            <div className="recorded-read-stamp">
              <span />
              <span>Read from local evidence · {date(run.fetchedAt)}</span>
              <span>No recording or model execution is active here.</span>
            </div>
            <Modal
              open={!!selected}
              onOpenChange={(v) => {
                if (!v) setSelected(null);
              }}
              title="Recorded evidence"
              description="Original event identity, with the available recorded content."
              drawer
              className="recorded-evidence-drawer"
            >
              {selected && (
                <>
                  <div className="recorded-drawer-body">
                    <div className="recorded-drawer-kicker">
                      <span>EVENT #{selected.sequence}</span>
                      <span>{provenance(selected)}</span>
                    </div>
                    <h2>
                      {selected.kind === "command"
                        ? "Command evidence"
                        : selected.kind === "file.change"
                          ? "Recorded file change"
                          : selected.kind === "assessment.updated"
                            ? "Historical human assessment"
                            : selected.summary}
                    </h2>
                    <div className="recorded-evidence-status">
                      <span
                        className={"recorded-outcome " + statusClass(selected)}
                      >
                        {outcome(selected)}
                      </span>
                      <span>{date(selected.receivedAt)}</span>
                    </div>
                    {selected.command && (
                      <>
                        <div className="recorded-code-label">
                          RECORDED COMMAND
                        </div>
                        <pre className="recorded-command-code">
                          {selected.command}
                        </pre>
                      </>
                    )}
                    {selected.kind === "command" && (
                      <>
                        <div className="recorded-code-label">
                          CAPTURED OUTPUT{" "}
                          <span>
                            {selected.outputState === "truncated"
                              ? "Display truncated at 180,000 characters"
                              : selected.outputState === "available"
                                ? "Recorded content"
                                : "Unavailable"}
                          </span>
                        </div>
                        {selected.outputState === "unavailable" ? (
                          <p className="recorded-content-note">
                            No validated command output is available in this
                            record.
                          </p>
                        ) : (
                          <pre className="recorded-output-code">
                            {selected.output ||
                              "No text was emitted in the captured output."}
                          </pre>
                        )}
                        {selected.testOutcome === "unknown" && (
                          <div className="recorded-boundary">
                            <Info size={14} />
                            <p>
                              This compound command can contain passing test
                              text, but its individual test outcome remains
                              unknown in the derived summary.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {!!selected.files.length && (
                      <>
                        <div className="recorded-code-label">
                          PROVIDER-REPORTED PATHS
                        </div>
                        {selected.files.map((f) => (
                          <p className="recorded-file-path" key={f.path}>
                            {shortPath(f.path)} <span>{f.kind}</span>
                          </p>
                        ))}
                        <p className="recorded-content-note">
                          This event records file paths. No action-level patch
                          is attached to it.
                        </p>
                      </>
                    )}
                    {selected.message && (
                      <>
                        <div className="recorded-code-label">AGENT MESSAGE</div>
                        <pre className="recorded-message-code">
                          {selected.message}
                        </pre>
                        <p className="recorded-content-note">
                          The agent’s explanation is separate from independent
                          test results.
                        </p>
                      </>
                    )}
                    {selected.kind === "assessment.updated" && (
                      <div className="recorded-assessment-note">
                        <strong>
                          {run.assessment.verdict} · task completed{" "}
                          {run.assessment.taskCompleted}
                        </strong>
                        <p>
                          This is the saved human assessment from{" "}
                          {date(
                            run.assessment.reviewedAt ?? selected.receivedAt,
                          )}
                          . Private note contents are not included in this view.
                        </p>
                      </div>
                    )}
                    {!selected.command &&
                      !selected.message &&
                      !selected.files.length &&
                      selected.kind !== "assessment.updated" && (
                        <p className="recorded-content-note">
                          This view exposes the event’s recorded identity and
                          status. Additional event payload is not included.
                        </p>
                      )}
                    <details className="recorded-source-details">
                      <summary>Source identity and relationships</summary>
                      <dl>
                        <dt>Event ID</dt>
                        <dd>{selected.id}</dd>
                        <dt>Run ID</dt>
                        <dd>{run.id}</dd>
                        <dt>Evidence class</dt>
                        <dd>{selected.provenance}</dd>
                        <dt>Artifact ID</dt>
                        <dd>{selected.artifactId ?? "No separate artifact"}</dd>
                      </dl>
                      {selected.relationships.map((r) => (
                        <button
                          key={r.eventId + r.type}
                          onClick={() => {
                            const found = run.events.find(
                              (e) => e.id === r.eventId,
                            );
                            if (found) openEvent(found);
                          }}
                        >
                          {r.type} · {r.eventId}
                          <ArrowUpRight size={12} />
                        </button>
                      ))}
                    </details>
                  </div>
                  <div className="drawer-footer">
                    <span>
                      <ShieldCheck size={13} />
                      Read-only · local paths shortened for display
                    </span>
                    <Button small onClick={() => setSelected(null)}>
                      Close evidence
                    </Button>
                  </div>
                </>
              )}
            </Modal>
            <Modal
              open={file !== null}
              onOpenChange={(v) => {
                if (!v) setFile(null);
              }}
              title="Final Git diff"
              description="A validated final-diff artifact, recovered from the repository."
              drawer
              className="recorded-diff-drawer"
            >
              {file !== null && run.git.files[file] && (
                <>
                  <div className="recorded-drawer-body">
                    <div className="recorded-drawer-kicker">
                      <span>GIT EVIDENCE</span>
                      <span>Final state</span>
                    </div>
                    <h2>{run.git.files[file].path}</h2>
                    <p className="recorded-content-note">
                      This is the final repository diff. It is not attributed to
                      one agent action.
                    </p>
                    <div className="diff-view">
                      {run.git.files[file].content
                        .split("\n")
                        .map((line, i) => (
                          <div
                            key={i}
                            className={
                              line.startsWith("+") && !line.startsWith("+++")
                                ? "added"
                                : line.startsWith("-") &&
                                    !line.startsWith("---")
                                  ? "removed"
                                  : ""
                            }
                          >
                            <span className="line-number">{i + 1}</span>
                            <code>{line || " "}</code>
                          </div>
                        ))}
                    </div>
                    {run.git.files[file].truncated && (
                      <p className="recorded-content-note">
                        Display truncated at 180,000 characters.
                      </p>
                    )}
                    <details className="recorded-source-details">
                      <summary>Artifact identity</summary>
                      <p className="mono">{run.git.artifactId}</p>
                    </details>
                  </div>
                  <div className="drawer-footer">
                    <span>
                      <ShieldCheck size={13} />
                      SHA-256 validated · read only
                    </span>
                    <Button small onClick={() => setFile(null)}>
                      Close diff
                    </Button>
                  </div>
                </>
              )}
            </Modal>
            <Modal
              open={sourceOpen}
              onOpenChange={setSourceOpen}
              title="Connected recording"
              description="Where this view comes from and what it can establish."
            >
              <div className="dialog-inner">
                <dl className="context-list">
                  <div>
                    <dt>Run</dt>
                    <dd className="mono">{run.id}</dd>
                  </div>
                  <div>
                    <dt>Recorder</dt>
                    <dd>
                      {run.provider} ·{" "}
                      {run.agentVersion || "version unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>Historical model</dt>
                    <dd>{run.model ?? "Not captured in run metadata"}</dd>
                  </div>
                  <div>
                    <dt>Events loaded</dt>
                    <dd>{run.eventCount} · complete stored event list</dd>
                  </div>
                  <div>
                    <dt>Reader revision</dt>
                    <dd className="mono">{run.readerRevision.slice(0, 12)}</dd>
                  </div>
                  <div>
                    <dt>Token usage</dt>
                    <dd>
                      Unavailable · {run.tokenUsageReason.replaceAll("_", " ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Check classification</dt>
                    <dd>{run.tests.derivation} · derived when read</dd>
                  </div>
                  <div>
                    <dt>Stored derivations</dt>
                    <dd>{run.tests.durability ?? "Unavailable"}</dd>
                  </div>
                </dl>
                <p className="quiet-note">
                  Refresh reads the existing record again. It does not migrate,
                  repair, backfill or assess the recording. This is a snapshot
                  of stored evidence, not live agent execution.
                </p>
                <div className="recorded-target-details">
                  <strong>Controlled comparison configuration</strong>
                  <p>
                    {comparisonTargets.baseline.model} · high
                    <br />
                    {comparisonTargets.candidate.model} · high
                  </p>
                </div>
                {finalMessage && (
                  <Button
                    variant="ghost"
                    small
                    onClick={() => {
                      setSourceOpen(false);
                      openEvent(finalMessage);
                    }}
                  >
                    Inspect the agent’s final message
                    <ArrowRight size={13} />
                  </Button>
                )}
              </div>
              <div className="dialog-footer">
                <Button variant="primary" onClick={() => setSourceOpen(false)}>
                  Back to recording
                </Button>
              </div>
            </Modal>
          </>
        )
      )}
    </div>
  );
}
