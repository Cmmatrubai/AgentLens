import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  FileCode2,
  GitBranch,
  MessageSquare,
  Radio,
  Square,
  Terminal,
} from "lucide-react";
import { Button } from "./ui";
import { LiveChecks } from "./LiveChecks";
import type { LiveAttempt, LiveEvent, LiveSnapshot } from "./live-types";
import {
  liveDuration,
  liveError,
  liveModelName,
  liveStateLabel,
  liveTerminal,
} from "./live-presentation";

function EventRow({
  event,
  onInspect,
}: {
  event: LiveEvent;
  onInspect: () => void;
}) {
  const Icon =
    event.kind === "command"
      ? Terminal
      : event.kind === "file.change"
        ? FileCode2
        : event.kind === "message.agent"
          ? MessageSquare
          : event.kind.includes("error")
            ? CircleAlert
            : Radio;
  const title =
    event.kind === "command"
      ? event.command || "Command"
      : event.kind === "file.change"
        ? event.truncated
          ? "File changes · partial preview"
          : `Changed ${event.files.length || ""} ${event.files.length === 1 ? "file" : "files"}`
        : event.kind === "message.agent"
          ? event.message.trim()
            ? `Update · ${event.message.trim().split("\n")[0].slice(0, 180)}`
            : "Agent update"
          : event.summary || event.kind;
  return (
    <details
      className={`live-event ${event.status === "failed" ? "event-failed" : ""}`}
      onToggle={(event) => {
        if (event.currentTarget.open) onInspect();
      }}
    >
      <summary>
        <Icon size={15} />
        <span>{title}</span>
        <small>
          {event.status === "in_progress"
            ? "Started"
            : event.status === "failed"
              ? "Failed"
              : event.kind === "command" && event.status === "completed"
                ? "Finished"
                : ""}
        </small>
      </summary>
      <div className="live-event-detail">
        {event.command && (
          <pre tabIndex={0} aria-label="Full command">
            {event.command}
          </pre>
        )}
        {event.message && <p>{event.message}</p>}
        {event.files.length > 0 && (
          <ul>
            {event.files.map((path, i) => (
              <li key={i}>{path}</li>
            ))}
          </ul>
        )}
        {event.output ? (
          <pre tabIndex={0}>{event.output}</pre>
        ) : (
          event.kind === "command" && (
            <p>
              {event.status === "in_progress"
                ? "Command output has not been recorded yet."
                : "No output preview is available for this command."}
            </p>
          )
        )}
        {!event.message &&
          !event.output &&
          !event.files.length &&
          event.kind !== "command" && (
            <p>{event.summary || "Recorded lifecycle event."}</p>
          )}
        {event.truncated && (
          <p className="live-output-limit">
            Preview shortened. The recorder ledger retains captured evidence
            within its capture limits.
          </p>
        )}
        <small>
          Recorded activity · {new Date(event.receivedAt).toLocaleTimeString()}
        </small>
      </div>
    </details>
  );
}

export function LiveLane({
  attempt,
  now,
  busy,
  onStop,
}: {
  attempt: LiveAttempt;
  now: number;
  busy: boolean;
  onStop: () => void;
}) {
  const reduced = useReducedMotion();
  const body = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [shown, setShown] = useState(attempt.events);
  const [all, setAll] = useState(false);
  const done = liveTerminal(attempt.state);
  useEffect(() => {
    if (following)
      setShown((previous) =>
        previous.at(-1)?.id === attempt.events.at(-1)?.id &&
        previous.length === attempt.events.length
          ? previous
          : attempt.events,
      );
  }, [attempt.events, following]);
  useEffect(() => {
    if (following && body.current)
      body.current.scrollTop = body.current.scrollHeight;
  }, [shown, following]);
  const visible = all
    ? shown
    : shown.filter(
        (e) =>
          ["command", "file.change", "message.agent"].includes(e.kind) ||
          /error|fail|mcp/.test(e.kind),
      );
  const lastShown = shown.at(-1)?.id;
  const hasNew = attempt.events.at(-1)?.id !== lastShown;
  return (
    <section
      className={`live-lane side-${attempt.key}`}
      aria-label={`Agent ${attempt.key.toUpperCase()} workspace`}
    >
      <header className="live-lane-header">
        <span className="live-agent-letter">{attempt.key.toUpperCase()}</span>
        <div>
          <h2>{liveModelName(attempt.model)}</h2>
          <span>{attempt.effort} reasoning</span>
        </div>
        <span className="live-elapsed">
          <Clock3 size={12} />
          {attempt.startedAt
            ? liveDuration((attempt.endedAt ?? now) - attempt.startedAt)
            : "—"}
        </span>
      </header>
      <div className={`live-lane-state state-${attempt.state}`} role="status">
        <span className="live-state-dot" />
        {liveStateLabel[attempt.state]}
        {!done && (
          <button
            onClick={onStop}
            disabled={busy || attempt.state === "stopping"}
            aria-label={`Stop agent ${attempt.key.toUpperCase()}`}
          >
            <Square size={11} />
            {attempt.state === "stopping" ? "Stopping…" : "Stop"}
          </button>
        )}
        {attempt.state === "completed" && <Check size={14} />}
      </div>
      <div
        className="live-lane-activity"
        ref={body}
        tabIndex={0}
        aria-label={`Agent ${attempt.key.toUpperCase()} recorded activity`}
        onScroll={() => {
          const el = body.current;
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 48)
            setFollowing(false);
        }}
      >
        {visible.length ? (
          visible.map((event, index) => (
            <motion.div
              key={event.id}
              initial={
                reduced || index < visible.length - 3
                  ? false
                  : { opacity: 0, y: 5 }
              }
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
            >
              <EventRow event={event} onInspect={() => setFollowing(false)} />
            </motion.div>
          ))
        ) : (
          <div className="live-lane-empty">
            <Radio size={24} />
            <h3>
              {done
                ? "No activity preview available"
                : "Waiting for recorded activity"}
            </h3>
            <p>
              {done
                ? "This attempt ended before meaningful activity was available. Any captured evidence is kept with its workspace."
                : "Actions appear here after the recorder saves them. Quiet periods do not mean the agent has stopped."}
            </p>
          </div>
        )}
        {attempt.error && (
          <p className="live-lane-error">
            <CircleAlert size={16} />
            {liveError(attempt.error)}
          </p>
        )}
        {attempt.state === "completed" && (
          <div className="live-lane-complete">
            <Check size={17} />
            <div>
              <strong>Work recorded</strong>
              <p>
                The agent finished its run. Correctness has not been
                independently checked.
              </p>
            </div>
          </div>
        )}
      </div>
      <footer className="live-lane-footer">
        <button
          onClick={() => {
            setFollowing(true);
            if (body.current)
              body.current.scrollTop = body.current.scrollHeight;
          }}
          className={!following && hasNew ? "has-new" : ""}
        >
          <ArrowDown size={13} />
          {!following && hasNew
            ? "New activity · Jump to latest"
            : following
              ? "Following latest activity"
              : "Jump to latest"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          All records
        </label>
      </footer>
      <div className="live-lane-meta">
        {attempt.eventCount} recorded events
        {attempt.omittedEvents > 0 &&
          ` · Latest ${attempt.events.length} in preview`}
        {!done &&
          attempt.lastActivityAt &&
          now - attempt.lastActivityAt > 15000 && (
            <span>
              No new activity for{" "}
              {Math.floor((now - attempt.lastActivityAt) / 1000)}s
            </span>
          )}
      </div>
    </section>
  );
}

export function LiveWorkspace({
  id,
  onBack,
  onComparison,
}: {
  id?: string;
  onBack: () => void;
  onComparison: () => void;
}) {
  const api = typeof window === "undefined" ? undefined : window.agentlens;
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [cleanupChecked, setCleanupChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      if (!api?.liveRead) {
        setConnectionError("desktop_required");
        return;
      }
      try {
        const r = await api.liveRead(id);
        if (cancelled) return;
        if (r.ok) {
          setSnapshot(r);
          setConnectionError(null);
        } else setConnectionError(r.error);
      } catch {
        if (!cancelled) setConnectionError("connection_lost");
      }
      if (!cancelled) timer = setTimeout(() => void read(), 1000);
    }
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, id, refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function stop(key: "a" | "b" | "all") {
    if (!api || !snapshot?.job || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.liveStop(snapshot.job.id, key);
      if (!r.ok) setActionError(r.error);
    } catch {
      setActionError("connection_lost");
    } finally {
      setBusy(false);
      setRefresh((v) => v + 1);
    }
  }
  async function open() {
    if (!api || !snapshot?.job || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.liveOpenComparison(snapshot.job.id);
      if (r.ok) onComparison();
      else setActionError(r.error);
    } catch {
      setActionError("live_operation_failed");
    } finally {
      setBusy(false);
    }
  }
  async function acknowledgeCleanup() {
    if (!api || !snapshot?.job || !cleanupChecked || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.liveAcknowledgeCleanup(snapshot.job.id, true);
      if (!r.ok) setActionError(r.error);
    } catch {
      setActionError("live_operation_failed");
    } finally {
      setBusy(false);
      setRefresh((v) => v + 1);
    }
  }
  const job = snapshot?.job;
  const running = !!job && job.attempts.some((a) => !liveTerminal(a.state));
  const complete = !!job && job.attempts.every((a) => a.state === "completed");
  return (
    <div className="live-workspace">
      <Button variant="ghost" small onClick={onBack}>
        <ArrowLeft size={14} />
        Your comparisons
      </Button>
      {connectionError && (
        <div className="live-connection-error" role="alert">
          <CircleAlert size={17} />
          <p>
            {connectionError === "connection_lost" ||
            connectionError === "live_operation_failed"
              ? "Live updates are temporarily unavailable. Recordings may still be running. AgentLens will reconnect without restarting them; the last received activity remains visible."
              : connectionError === "desktop_required"
                ? "Open AgentLens desktop to start or follow recorded agent work."
                : liveError(connectionError)}
          </p>
          <Button small onClick={() => setRefresh((v) => v + 1)}>
            Retry connection
          </Button>
        </div>
      )}
      {!job ? (
        <div className="live-loading" role="status">
          {connectionError
            ? "Your saved evidence stays on this computer."
            : snapshot
              ? "No recorded workspace yet. Choose a project to get started."
              : "Opening your workspace…"}
        </div>
      ) : (
        <>
          <header className="live-workspace-header">
            <div>
              <div className="eyebrow">
                {running ? "LIVE WORKSPACE" : "RECORDED WORKSPACE"}
              </div>
              <h1>
                {job.state === "preparing" && job.dependencyPlan
                  ? "Preparing both copies"
                  : running
                    ? "Live comparison"
                    : complete
                      ? "Recordings complete"
                      : "Comparison ended"}
              </h1>
              <details className="live-task">
                <summary>
                  <span>Task · {job.task.split("\n")[0]}</span>
                </summary>
                <p>{job.task}</p>
              </details>
              <div className="live-workspace-context">
                <span>
                  <GitBranch size={13} />
                  {job.project.name} · {job.baseCommit.slice(0, 8)}
                </span>
                <span>Same task · Separate working copies</span>
                <span>{job.timeoutMs / 60000} min per agent</span>
              </div>
            </div>
            {running && (
              <Button small disabled={busy} onClick={() => void stop("all")}>
                <Square size={12} />
                {job.state === "preparing" && job.dependencyPlan
                  ? "Stop setup"
                  : "Stop both"}
              </Button>
            )}
          </header>
          {job.dependencyPlan && (
            <section
              className="live-dependency-progress"
              aria-label="Dependency preparation"
            >
              <div>
                <h2>Project setup</h2>
                <p>
                  Both copies must be ready before either agent starts. Install
                  scripts are disabled; agent time starts after setup.
                </p>
              </div>
              {job.error?.startsWith("dependency_") && (
                <p role="alert">{liveError(job.error)}</p>
              )}
              <div className="live-dependency-sides">
                {job.attempts.map((a) => (
                  <details key={a.key}>
                    <summary>
                      <strong>Agent {a.key.toUpperCase()}</strong>
                      <span>
                        {a.preparation?.state === "completed"
                          ? "Dependencies installed"
                          : a.preparation?.state === "running"
                            ? "Installing dependencies…"
                            : a.preparation
                              ? a.preparation.state === "timed_out"
                                ? "Setup timed out"
                                : a.preparation.state === "cancelled" ||
                                    a.preparation.state === "interrupted"
                                  ? "Setup stopped"
                                  : "Setup needs attention"
                              : job.state === "preparing"
                                ? "Waiting for setup"
                                : "Setup did not run"}
                      </span>
                    </summary>
                    {a.preparation && (
                      <>
                        <p>
                          {a.preparation.nodeVersion &&
                            `Node ${a.preparation.nodeVersion} · pnpm ${a.preparation.pnpmVersion}`}
                          {a.preparation.durationMs !== undefined &&
                            ` · ${a.preparation.durationMs < 1000 ? `${Math.round(a.preparation.durationMs)} ms` : liveDuration(a.preparation.durationMs)} setup time`}
                        </p>
                        {a.preparation.error && (
                          <p>{liveError(a.preparation.error)}</p>
                        )}
                        <pre
                          tabIndex={0}
                          aria-label={`Agent ${a.key.toUpperCase()} setup output`}
                        >
                          {a.preparation.output || "No setup output saved yet."}
                        </pre>
                        {a.preparation.outputTruncated && (
                          <p>Only the first 16 KiB of output was retained.</p>
                        )}
                      </>
                    )}
                  </details>
                ))}
              </div>
            </section>
          )}
          {job.persistenceError && (
            <p className="first-use-error" role="alert">
              Some workspace updates could not be saved. Recording evidence may
              be partial. Keep the app open and check available disk space
              before continuing.
            </p>
          )}
          {actionError && (
            <p className="first-use-error" role="alert">
              {liveError(actionError)}
            </p>
          )}
          {job.cleanupUnconfirmed && !job.cleanupAcknowledgedAt && (
            <div className="live-cleanup-notice">
              <h2>Check the interrupted processes</h2>
              <p>
                AgentLens lost the recorder before it could confirm cleanup.
                Check your system’s process manager or restart your computer to
                stop any remaining agent work. This recording will remain failed
                and unverified.
              </p>
              <label className="live-launch-consent">
                <input
                  type="checkbox"
                  checked={cleanupChecked}
                  onChange={(e) => setCleanupChecked(e.target.checked)}
                />
                <span>
                  I have checked that the agent processes are stopped.
                </span>
              </label>
              <Button
                disabled={!cleanupChecked || busy || running}
                onClick={() => void acknowledgeCleanup()}
              >
                Acknowledge and continue
              </Button>
            </div>
          )}
          {job.cleanupAcknowledgedAt && (
            <p className="first-use-notice">
              Process cleanup was acknowledged by the user. This does not verify
              the interrupted recording or change its result.
            </p>
          )}
          {complete && !job.persistenceError && (
            <LiveChecks key={job.id} id={job.id} onComparison={onComparison} />
          )}
          <div className="live-lanes">
            {job.attempts.map((a) => (
              <LiveLane
                key={`${job.id}-${a.key}`}
                attempt={a}
                now={now}
                busy={busy}
                onStop={() => void stop(a.key)}
              />
            ))}
          </div>
          <div className="live-workspace-next">
            <div>
              <strong>
                {running
                  ? "Recording continues while you explore."
                  : complete
                    ? "Understand what each agent did differently."
                    : "Your partial work has been kept."}
              </strong>
              <p>
                {running
                  ? "You can leave this page and return. Quitting the app stops the agents and finalizes their recordings."
                  : complete
                    ? "Compare the recorded work and optionally add AI analysis. Independent correctness remains unknown until checks are supplied."
                    : "Open the activity above or inspect the saved working copies. Starting again creates a new comparison; it never replaces this evidence."}
              </p>
            </div>
            {complete && (
              <Button
                variant="primary"
                disabled={busy || !!job.persistenceError}
                onClick={() => void open()}
              >
                Open comparison <ArrowRight size={16} />
              </Button>
            )}
            {!running && !complete && (
              <Button onClick={onBack}>
                New comparison <ArrowRight size={15} />
              </Button>
            )}
          </div>
          <details className="live-options live-storage">
            <summary>Saved work and recording details</summary>
            <p>
              Activity previews are bounded. Full captured events and artifacts
              live in each attempt’s recording directory beside its working
              copy. No attempt is automatically retried.
            </p>
            {job.attempts.map((a) => (
              <div key={a.key}>
                <strong>
                  Agent {a.key.toUpperCase()} · {a.model}
                </strong>
                <code>{a.workspace}</code>
                <span>Recording directory</span>
                <code>
                  {a.recordingPath ??
                    "Recording directory was not included in this older workspace."}
                </code>
                <small>Run ID: {a.runId ?? "No run identity was saved"}</small>
              </div>
            ))}
          </details>
          {!!snapshot?.recoveryWarnings.length && (
            <p className="first-use-notice">
              Some saved workspace metadata could not be read. Those files were
              preserved, and other workspaces remain available.
            </p>
          )}
        </>
      )}
    </div>
  );
}
