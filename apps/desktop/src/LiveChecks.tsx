import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  FlaskConical,
  Square,
  Terminal,
} from "lucide-react";
import { Button } from "./ui";
import type { CheckEvaluation } from "./live-types";
import { liveDuration, liveError } from "./live-presentation";
const messages: Record<string, string> = {
  invalid_check_request:
    "Give the check a name, a command, and a time limit between 1 and 600 seconds.",
  check_dependencies_unsupported:
    "This copy does not have a supported pnpm 11 setup. Check its package manifest and lockfile, or run without dependency installation.",
  check_dependency_setup_failed:
    "Dependency setup did not finish successfully. Open setup output for details. The check outcome is unknown.",
  check_dependency_pair_not_ready:
    "Both copies must finish dependency setup before either check runs. Review the setup result, then try again.",
  check_busy:
    "Another check is still running. Wait for it to finish before starting a new one.",
  check_cleanup_unconfirmed:
    "An interrupted check needs attention. Confirm its processes have stopped before running another check.",
  check_evidence_unavailable:
    "Saved check evidence could not be read. It has been preserved for recovery.",
  check_storage_failed:
    "The check could not be saved. Check available disk space before trying again.",
  check_workspace_unavailable:
    "The saved working copies are unavailable. Reopen the original workspace before running checks.",
  comparison_incomplete:
    "Both agent recordings must be complete and readable before verification.",
  check_snapshot_unsupported:
    "This working copy contains unsupported files or exceeds the snapshot limit. Dependencies and ignored files are not copied.",
  check_snapshot_changed:
    "The working copy changed during preparation. Wait for file changes to finish, then try again.",
  check_platform_unavailable:
    "The check runner currently requires macOS. No unrestricted command was run.",
  check_execution_unavailable:
    "The command could not be started. Its outcome is unknown.",
};
const phase: Record<string, string> = {
  queued: "Waiting",
  preparing: "Preparing a copy",
  running: "Running command",
  completed: "Command finished",
  cancelled: "Cancelled",
  timed_out: "Time limit reached",
  unavailable: "Could not evaluate",
  interrupted: "Interrupted",
};
export function LiveChecks({
  id,
  onComparison,
}: {
  id: string;
  onComparison: () => void;
}) {
  const api = typeof window !== "undefined" ? window.agentlens : undefined;
  const [evaluation, setEvaluation] = useState<CheckEvaluation | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState<string | null>(null),
    [readError, setReadError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [title, setTitle] = useState(""),
    [command, setCommand] = useState(""),
    [seconds, setSeconds] = useState(60),
    [prepareDependencies, setPrepareDependencies] = useState(false),
    [consent, setConsent] = useState(false),
    [cleanup, setCleanup] = useState(false),
    [form, setForm] = useState(true);
  const initialized = useRef(false),
    epoch = useRef(0);
  useEffect(() => {
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const version = epoch.current;
    async function read() {
      try {
        const r = await api?.liveChecksRead(id);
        if (cancelled || version !== epoch.current) return;
        if (!r?.ok) throw Error(r?.error ?? "check_evidence_unavailable");
        setEvaluation(r.evaluation);
        setLoaded(true);
        setReadError(null);
        if (!initialized.current) {
          initialized.current = true;
          setForm(!r.evaluation);
        }
      } catch (e) {
        if (!cancelled && version === epoch.current)
          setReadError(
            e instanceof Error ? e.message : "check_evidence_unavailable",
          );
      }
      if (!cancelled && version === epoch.current)
        timer = setTimeout(() => void read(), 1200);
    }
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, id, revision]);
  async function action(kind: "start" | "stop" | "acknowledge" | "open") {
    if (!api || busy) return;
    epoch.current++;
    setBusy(true);
    setError(null);
    try {
      if (kind === "open") {
        const r = await api.liveOpenComparison(id);
        if (!r.ok) throw Error(r.error);
        onComparison();
        return;
      }
      const r =
        kind === "start"
          ? await api.liveChecksStart(id, {
              title,
              command,
              timeoutSeconds: seconds,
              acknowledged: consent,
              prepareDependencies,
            })
          : kind === "stop"
            ? await api.liveChecksStop(id)
            : await api.liveChecksAcknowledge(id, cleanup);
      if (!r.ok) throw Error(r.error);
      setEvaluation(r.evaluation);
      if (kind === "start") {
        setForm(false);
        setConsent(false);
      }
      setCleanup(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "check_execution_unavailable");
    } finally {
      setBusy(false);
      setRevision((v) => v + 1);
    }
  }
  const running = evaluation?.state === "running",
    visibleError = error ?? readError,
    blocked =
      evaluation?.cleanupUnconfirmed && !evaluation.cleanupAcknowledgedAt;
  return (
    <section className="live-checks" aria-labelledby="live-checks-title">
      <header>
        <span className="live-checks-icon">
          <FlaskConical size={20} />
        </span>
        <div>
          <h2 id="live-checks-title">Verify the result</h2>
          <p>Run the same check command against both attempts.</p>
        </div>
        <span className="live-checks-label">Command verification</span>
      </header>
      {visibleError && (
        <div className="live-checks-error" role="alert">
          <p>
            {messages[visibleError] ??
              "Check updates are unavailable. Existing evidence remains saved."}
          </p>
          <Button
            small
            variant="ghost"
            onClick={() => {
              setError(null);
              setRevision((v) => v + 1);
            }}
          >
            Reload checks
          </Button>
        </div>
      )}
      {!loaded && !visibleError && <p role="status">Reading saved checks…</p>}
      {evaluation && (
        <div className="live-checks-results">
          <div className="live-checks-result-title">
            <strong>{evaluation.title}</strong>
            <span>{new Date(evaluation.startedAt).toLocaleString()}</span>
          </div>
          <details className="live-checks-command-disclosure">
            <summary>View check command</summary>
            <code className="live-checks-command">{evaluation.command}</code>
          </details>
          <div className="live-checks-sides">
            {evaluation.attempts.map((a) => (
              <details
                className="live-check-result"
                key={`${evaluation.id}-${a.key}`}
              >
                <summary>
                  <span className="live-check-letter">
                    {a.key.toUpperCase()}
                  </span>
                  <span>
                    <strong>
                      {a.outcome === "pass"
                        ? "Command passed"
                        : a.outcome === "fail"
                          ? "Command failed"
                          : a.preparation?.state === "running"
                            ? "Installing dependencies"
                            : phase[a.state]}
                    </strong>
                    <small>
                      {a.durationMs !== null
                        ? a.durationMs < 1000
                          ? `${Math.round(a.durationMs)} ms`
                          : liveDuration(a.durationMs)
                        : a.state === "queued"
                          ? "Runs after preparation"
                          : "Outcome not established"}
                    </small>
                  </span>
                  {a.outcome === "pass" ? (
                    <Check size={16} />
                  ) : running ? (
                    <Clock3 size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </summary>
                <div className="live-check-result-detail">
                  {a.preparation && (
                    <details className="live-checks-command-disclosure">
                      <summary>
                        Dependency setup ·{" "}
                        {a.preparation.state === "completed"
                          ? "Installed"
                          : a.preparation.state === "running"
                            ? "Installing"
                            : "Not completed"}
                      </summary>
                      <p>
                        {a.preparation.nodeVersion
                          ? `Node ${a.preparation.nodeVersion} · pnpm ${a.preparation.pnpmVersion}`
                          : "Tool versions unavailable"}
                        {a.preparation.durationMs !== undefined &&
                          ` · ${Math.round(a.preparation.durationMs)} ms setup time`}
                      </p>
                      {a.preparation.error && (
                        <p>
                          {messages[a.preparation.error] ??
                            liveError(a.preparation.error)}
                        </p>
                      )}
                      {a.preparation.command && (
                        <code className="live-checks-command">
                          {a.preparation.command}
                        </code>
                      )}
                      <pre
                        tabIndex={0}
                        aria-label={`Agent ${a.key.toUpperCase()} dependency setup output`}
                      >
                        {a.preparation.output || "No setup output saved yet."}
                      </pre>
                      {a.preparation.outputTruncated && (
                        <p>Setup output was shortened at the capture limit.</p>
                      )}
                      {a.preparation.fingerprint && (
                        <p className="live-check-identity">
                          Dependency inputs{" "}
                          <code>{a.preparation.fingerprint}</code>
                        </p>
                      )}
                    </details>
                  )}
                  {a.error && <p>{messages[a.error] ?? liveError(a.error)}</p>}
                  <p>
                    Exit code: {a.exitCode ?? "not available"} ·{" "}
                    {phase[a.state]}
                  </p>
                  <pre
                    tabIndex={0}
                    aria-label={`Agent ${a.key.toUpperCase()} check output`}
                  >
                    {(a.output.startsWith(`Command: ${evaluation.command}\n`)
                      ? a.output.slice(
                          `Command: ${evaluation.command}\n`.length,
                        )
                      : a.output) || "No command output recorded yet."}
                  </pre>
                  {a.outputTruncated && (
                    <p>Output was shortened at the capture limit.</p>
                  )}
                  {a.snapshotHash && (
                    <p className="live-check-identity">
                      Snapshot <code>{a.snapshotHash}</code>
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
          <p className="live-field-hint">
            A pass means this command exited successfully. It does not prove the
            whole task is correct.
          </p>
          {evaluation.persistenceError && (
            <p className="first-use-error" role="alert">
              Some check evidence could not be saved. These results cannot be
              promoted into the comparison.
            </p>
          )}
          {running ? (
            <Button small disabled={busy} onClick={() => void action("stop")}>
              <Square size={12} />
              Stop checks
            </Button>
          ) : (
            <div className="live-checks-actions">
              <Button
                small
                disabled={busy || evaluation.persistenceError}
                onClick={() => void action("open")}
              >
                See comparison <ArrowRight size={14} />
              </Button>
              <Button
                small
                variant="ghost"
                disabled={busy || !!blocked}
                onClick={() => {
                  setTitle(evaluation.title);
                  setCommand(evaluation.command);
                  setSeconds(evaluation.timeoutSeconds);
                  setPrepareDependencies(
                    evaluation.prepareDependencies === true,
                  );
                  setConsent(false);
                  setForm(true);
                }}
              >
                Run another check
              </Button>
            </div>
          )}
        </div>
      )}
      {blocked && (
        <div className="live-cleanup-notice">
          <h3>Check the interrupted processes</h3>
          <p>
            AgentLens could not confirm that the previous check stopped. Check
            your process manager or restart the computer. It will not retry
            automatically.
          </p>
          <label className="live-launch-consent">
            <input
              type="checkbox"
              checked={cleanup}
              onChange={(e) => setCleanup(e.target.checked)}
            />
            <span>I have confirmed the check processes have stopped.</span>
          </label>
          <Button
            small
            disabled={!cleanup || busy}
            onClick={() => void action("acknowledge")}
          >
            Acknowledge cleanup
          </Button>
        </div>
      )}
      {loaded && form && !running && !blocked && (
        <div className="live-checks-form">
          <label htmlFor="check-title">What should this check establish?</label>
          <input
            id="check-title"
            maxLength={120}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setConsent(false);
            }}
            placeholder="For example: the search regression tests pass"
            disabled={busy}
          />
          <label htmlFor="check-command">Check command</label>
          <div className="live-checks-command-input">
            <Terminal size={16} />
            <input
              id="check-command"
              maxLength={4000}
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                setConsent(false);
              }}
              placeholder="For example: node --test tests/search.test.js"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          <label className="live-checks-time" htmlFor="check-time">
            Time limit per attempt
            <select
              id="check-time"
              value={seconds}
              disabled={busy}
              onChange={(e) => {
                setSeconds(Number(e.target.value));
                setConsent(false);
              }}
            >
              {[30, 60, 120, 300, 600].map((n) => (
                <option key={n} value={n}>
                  {n < 60
                    ? `${n} seconds`
                    : `${n / 60} minute${n > 60 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </label>
          <p className="live-field-hint">
            Fresh copies preserve the original work. Ignored files, installed
            dependencies and Git metadata are not copied. The check command runs
            with network access disabled.
          </p>
          <label className="live-launch-consent">
            <input
              type="checkbox"
              checked={prepareDependencies}
              disabled={busy}
              onChange={(e) => {
                setPrepareDependencies(e.target.checked);
                setConsent(false);
              }}
            />
            <span>Install locked dependencies before checking</span>
          </label>
          {prepareDependencies && (
            <p className="live-field-hint">
              Requires installed pnpm 11 and a supported lockfile in both
              results. Setup can download packages, with install scripts
              disabled and a five-minute limit per copy. Both installs must
              succeed before either check runs. Each result uses its own
              dependencies; setup time is saved separately.
            </p>
          )}
          <label className="live-launch-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Run this command twice and save its output locally. It can read
              local files; writes are restricted to each evaluation copy.
            </span>
          </label>
          <Button
            variant="primary"
            disabled={
              !loaded || busy || !title.trim() || !command.trim() || !consent
            }
            onClick={() => void action("start")}
          >
            {busy ? "Preparing checks…" : "Run checks on both attempts"}
            <ArrowRight size={15} />
          </Button>
        </div>
      )}
    </section>
  );
}
