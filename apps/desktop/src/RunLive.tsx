import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileCheck2,
  FolderGit2,
  GitBranch,
  Info,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Terminal,
  WifiOff,
} from "lucide-react";
import type { Task } from "./data";
import { Button, Modal, ModelMark } from "./ui";
import {
  attemptProgress,
  modelName,
  runHeading,
  TOTAL_TICKS,
  type DemoRun,
} from "./run-model";

const momentLabels = [
  "Starting from the saved revision",
  "Reading the task and success conditions",
  "Inspecting the relevant files",
  "Applying a focused change",
  "Running the selected acceptance checks",
  "Saving the captured evidence",
];
export function RunLive({
  run,
  task,
  onCancel,
  onResume,
  onSetup,
  onReview,
  onInterrupt,
}: {
  run: DemoRun;
  task: Task;
  onCancel: () => void;
  onResume: () => void;
  onSetup: () => void;
  onReview: () => void;
  onInterrupt: () => void;
}) {
  const [cancelDialog, setCancelDialog] = useState(false);
  const [details, setDetails] = useState(false);
  const finished = run.status === "complete",
    stopped = run.status === "cancelled",
    interrupted = run.status === "interrupted";
  const active = run.status === "running";
  const currentStage =
    run.tick < 2 ? 0 : run.tick < 9 ? 1 : run.tick < 16 ? 2 : finished ? 4 : 3;
  const progress = Math.round((run.tick / TOTAL_TICKS) * 100);
  return (
    <div className="page live-page">
      <div className="live-topline">
        <span className={"live-state " + (active ? "running" : run.status)}>
          {active ? (
            <LoaderCircle size={12} className="spin" />
          ) : finished ? (
            <Check size={12} />
          ) : interrupted ? (
            <WifiOff size={12} />
          ) : (
            <Square size={11} />
          )}{" "}
          {active
            ? "COMPARISON IN PROGRESS"
            : finished
              ? "READY TO REVIEW"
              : interrupted
                ? "PROGRESS RECOVERED"
                : "COMPARISON STOPPED"}
        </span>
        <span className="live-demo-label">DEMO · ACCELERATED PLAYBACK</span>
      </div>
      <div className="page-heading live-heading">
        <div>
          <h1 aria-live="polite">{runHeading(run)}</h1>
          <p>
            {interrupted
              ? run.reason === "reload"
                ? "The window was reloaded. Your sample progress is still here."
                : "The simulated connection was interrupted. Recorded progress is still here."
              : stopped
                ? "No complete comparison was created. You can start again with the same setup."
                : finished
                  ? "Review the selected results, including any gaps in evidence."
                  : "You can explore the workspace while the sample continues in the background."}
          </p>
        </div>
        {(active || interrupted) && (
          <Button variant="ghost" onClick={() => setCancelDialog(true)}>
            <Square size={13} />
            Stop comparison
          </Button>
        )}
      </div>
      <div className="live-case-context">
        <span>
          <FolderGit2 size={14} />
          {task.repository}
        </span>
        <ChevronRight size={12} />
        <strong>{task.title}</strong>
        <span className="live-check-count">
          {run.config.checkIds.length} selected{" "}
          {run.config.checkIds.length === 1 ? "check" : "checks"}
        </span>
      </div>
      <div
        className="live-overall-progress"
        aria-label="Comparison progress"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          animate={{ width: progress + "%" }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <div className="run-milestones">
        {[
          "Prepare",
          "Baseline attempt",
          "Candidate attempt",
          "Verify evidence",
          "Compare",
        ].map((label, index) => (
          <span
            key={label}
            className={
              index < currentStage
                ? "done"
                : index === currentStage
                  ? "current"
                  : ""
            }
          >
            <span>
              {index < currentStage || finished ? (
                <Check size={10} />
              ) : (
                index + 1
              )}
            </span>
            {label}
          </span>
        ))}
      </div>
      {(interrupted || stopped) && (
        <motion.div
          className={"run-recovery " + (stopped ? "stopped" : "")}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span>
            {interrupted ? <WifiOff size={23} /> : <Square size={20} />}
          </span>
          <div>
            <h2>
              {interrupted
                ? "Continue with the same comparison"
                : "The comparison stopped here"}
            </h2>
            <p>
              {interrupted
                ? "The case, model roles and selected checks are unchanged. Resume explicitly when you’re ready."
                : "You can revisit this progress or start a fresh comparison with the same setup."}
            </p>
          </div>
          <Button variant="primary" onClick={interrupted ? onResume : onSetup}>
            {interrupted ? <Play size={14} /> : <RotateCcw size={14} />}{" "}
            {interrupted ? "Resume demo" : "Review setup"}
          </Button>
        </motion.div>
      )}
      <div className="live-attempt-grid">
        {(["baseline", "candidate"] as const).map((role) => {
          const state = attemptProgress(run, role);
          const model = run.config[role];
          const missing = task.checks.filter(
            (check) =>
              run.config.checkIds.includes(check.id) &&
              check[model] === "unknown",
          ).length;
          const shownStep = state.done ? 6 : Math.min(5, state.step);
          const label = state.done
            ? missing
              ? "Partial evidence"
              : "Evidence saved"
            : stopped
              ? "Stopped"
              : interrupted
                ? "Waiting to resume"
                : state.active
                  ? "Working"
                  : "Queued";
          return (
            <article
              className={
                "live-attempt " +
                (state.active ? "active " : "") +
                (state.done ? "done " : "") +
                model
              }
              key={role}
            >
              <div className="live-attempt-head">
                <ModelMark side={model} />
                <span>
                  <strong>{modelName(model)}</strong>
                  <small>
                    {role === "baseline"
                      ? "Baseline · Attempt 01"
                      : "Candidate · Attempt 02"}
                  </small>
                </span>
                <span
                  className={
                    "attempt-live-status " + (state.done ? "done" : "")
                  }
                >
                  {state.done ? (
                    <Check size={12} />
                  ) : state.active ? (
                    <span className="working-dot" />
                  ) : null}
                  {label}
                </span>
              </div>
              <div className="live-attempt-visual" aria-hidden="true">
                <div className="orbit-track">
                  <motion.span
                    className="orbit-point"
                    animate={{ rotate: state.done ? 360 : state.step * 60 }}
                    transition={{ duration: 0.65 }}
                  />
                </div>
                <div className="orbit-core">
                  {state.done ? (
                    <Check size={23} />
                  ) : state.active ? (
                    <Terminal size={21} />
                  ) : interrupted ? (
                    <Pause size={21} />
                  ) : (
                    <Clock3 size={20} />
                  )}
                </div>
              </div>
              <div className="live-current-moment">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={label + shownStep}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.15 }}
                  >
                    <strong>
                      {state.done
                        ? missing
                          ? "A check result is missing"
                          : "Attempt captured"
                        : !state.started
                          ? "Waiting for a clean starting point"
                          : momentLabels[shownStep]}
                    </strong>
                    <p>
                      {state.done
                        ? missing
                          ? `${missing} missing result${missing === 1 ? " stays" : "s stay"} unknown`
                          : `${run.config.checkIds.length} selected ${run.config.checkIds.length === 1 ? "check" : "checks"} · sample output saved`
                        : state.active
                          ? "Following the same task and recorded tool setup"
                          : interrupted
                            ? "Your progress has been preserved"
                            : stopped
                              ? "The simulation will not advance"
                              : "Each model gets the same saved revision"}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="live-mini-steps">
                {momentLabels.map((label, index) => (
                  <span
                    key={label}
                    className={
                      index < state.step || state.done
                        ? "done"
                        : index === state.step && state.active
                          ? "current"
                          : ""
                    }
                    title={label}
                  />
                ))}
              </div>
              <div className="live-evidence-note">
                <ShieldCheck size={13} />
                {state.done
                  ? "Captured evidence kept separately from the verdict"
                  : "Results appear after the evidence is checked"}
              </div>
            </article>
          );
        })}
      </div>
      {finished ? (
        <motion.div
          className="run-ready-card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="ready-icon">
            <FileCheck2 size={25} />
          </span>
          <div>
            <h2>See how the attempts compare.</h2>
            <p>
              Open the comparison, then follow any result back to its selected
              check.
            </p>
          </div>
          <Button variant="primary" onClick={onReview}>
            Review comparison
            <ArrowRight size={15} />
          </Button>
        </motion.div>
      ) : (
        <div className="run-details">
          <button
            className="run-details-toggle"
            aria-expanded={details}
            onClick={() => setDetails((v) => !v)}
          >
            <GitBranch size={14} />
            View fixed comparison setup
            <ChevronDown size={14} className={details ? "rotated" : ""} />
          </button>
          <AnimatePresence>
            {details && (
              <motion.div
                className="run-detail-values"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <span>
                  Starting revision
                  <strong className="mono">7f31a2c · sample</strong>
                </span>
                <span>
                  Agent tools<strong>Read, edit, terminal</strong>
                </span>
                <span>
                  Attempt timeout
                  <strong>
                    {run.config.timeoutMinutes} minutes · configured
                  </strong>
                </span>
                <span>
                  Task & check version<strong>v1 · sample fixture</strong>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      <div className="run-footer-note">
        <span>
          <Info size={13} />
          Sample results come from fixed fixtures. No AI judge or provider is
          running.
        </span>
        {active && (
          <button className="text-action" onClick={onInterrupt}>
            <WifiOff size={12} />
            Preview an interruption
          </button>
        )}
      </div>
      <Modal
        open={cancelDialog && (active || interrupted)}
        onOpenChange={setCancelDialog}
        title="Stop this comparison?"
        description="The sample playback will stop. Recorded progress will remain available."
      >
        <div className="dialog-inner">
          <p>
            You can review the setup and start a fresh demonstration afterward.
            This does not create a completed comparison.
          </p>
        </div>
        <div className="dialog-footer">
          <Button variant="ghost" onClick={() => setCancelDialog(false)}>
            {interrupted ? "Back to comparison" : "Keep running"}
          </Button>
          <Button
            onClick={() => {
              onCancel();
              setCancelDialog(false);
            }}
          >
            <Square size={13} />
            Stop comparison
          </Button>
        </div>
      </Modal>
    </div>
  );
}
