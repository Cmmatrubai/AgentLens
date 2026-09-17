import { DesktopEnvironmentPanel } from "./DesktopEnvironmentPanel";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Command } from "cmdk";
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  Code2,
  Copy,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  Info,
  ListChecks,
  LoaderCircle,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import {
  tasks,
  outcomeText,
  modelLabel,
  modelSide,
  type Task,
  type Check as TaskCheck,
  type SavedCase,
} from "./data";
import {
  AnimatedTabs,
  Button,
  Modal,
  ModelMark,
  OutcomeBadge,
  spring,
} from "./ui";

export type EvidenceTarget = {
  task: Task;
  check: TaskCheck;
  tab: "result" | "patch" | "context";
  side?: "a" | "b";
};
export function EvidenceDrawer({
  target,
  close,
  notify,
}: {
  target: EvidenceTarget | null;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState<"result" | "patch" | "context">("result");
  const [side, setSide] = useState<"a" | "b">("b");
  useEffect(() => {
    if (target) {
      setTab(target.tab);
      setSide(
        target.side ??
          (target.check.b === "fail" || target.check.b === "unknown"
            ? "b"
            : "a"),
      );
    }
  }, [target]);
  const task = target?.task;
  const check = target?.check;
  async function copy() {
    if (!task || !check) return;
    try {
      await navigator.clipboard.writeText(
        "demo-" + task.id + "-" + side + "-" + check.id,
      );
      notify("Example evidence ID copied");
    } catch {
      notify("Clipboard is unavailable in this preview");
    }
  }
  return (
    <Modal
      drawer
      open={!!target}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Evidence"
      description="The source behind this comparison."
      className="evidence-drawer"
    >
      {task && check && (
        <>
          <div className="evidence-body">
            <div className="evidence-breadcrumb">
              <span className="mono">{task.code}</span>
              <ChevronRight size={12} />
              <span>Acceptance check</span>
            </div>
            <h2>{check.name}</h2>
            <p className="evidence-intro">{check.expectation}</p>
            <div className="evidence-sample">
              <Info size={13} />
              Illustrative evidence · not a real model result
            </div>
            <AnimatedTabs
              id="evidence"
              tabs={[
                { id: "result", label: "Result" },
                { id: "patch", label: "Patch" },
                { id: "context", label: "Context" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <AnimatePresence mode="wait">
              <motion.div
                className="evidence-tab-body"
                role="tabpanel"
                id="evidence-panel"
                aria-labelledby={"evidence-" + tab}
                key={tab}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {tab === "result" && (
                  <>
                    <div className="evidence-outcomes">
                      {(["a", "b"] as const).map((s) => (
                        <button
                          key={s}
                          className={side === s ? "active" : ""}
                          onClick={() => setSide(s)}
                          aria-pressed={side === s}
                        >
                          <ModelMark side={modelSide(task, s)} />
                          <span>{modelLabel(task, s)}</span>
                          <OutcomeBadge value={check[s]} />
                        </button>
                      ))}
                    </div>
                    <div className="output-heading">
                      <span>CAPTURED CHECK OUTPUT</span>
                      <span>{modelLabel(task, side)}</span>
                    </div>
                    <div className={"evidence-output " + check[side]}>
                      <div className="output-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </div>
                      <pre>{side === "a" ? check.outputA : check.outputB}</pre>
                    </div>
                    <div className="source-note">
                      <ShieldCheck size={16} />
                      <p>
                        This result belongs to the selected acceptance check. It
                        is separate from the agent's completion message.
                      </p>
                    </div>
                  </>
                )}
                {tab === "patch" && (
                  <>
                    <div className="patch-header">
                      <FileCode2 size={15} />
                      <span className="mono">{task.file}</span>
                    </div>
                    <p className="quiet-note">
                      Illustrative correction for this case. No edit is applied
                      to your files.
                    </p>
                    <div className="diff-view">
                      {task.patch.map((line, index) => (
                        <div
                          className={
                            line.startsWith("+")
                              ? "added"
                              : line.startsWith("-")
                                ? "removed"
                                : ""
                          }
                          key={index}
                        >
                          <span className="line-number">{index + 18}</span>
                          <code>{line}</code>
                        </div>
                      ))}
                    </div>
                    <div className="source-note">
                      <Info size={16} />
                      <p>
                        A patch shows a code change. The check output is the
                        evidence for its tested behavior.
                      </p>
                    </div>
                  </>
                )}
                {tab === "context" && (
                  <>
                    <dl className="context-list">
                      <div>
                        <dt>Evidence kind</dt>
                        <dd>Acceptance-check output</dd>
                      </div>
                      <div>
                        <dt>Task</dt>
                        <dd>{task.title}</dd>
                      </div>
                      <div>
                        <dt>Repository</dt>
                        <dd>{task.repository}</dd>
                      </div>
                      <div>
                        <dt>Check bundle</dt>
                        <dd className="mono">acceptance-v1 · sample</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>Demonstration fixture</dd>
                      </div>
                    </dl>
                    <div className="source-note">
                      <Info size={16} />
                      <p>
                        This prototype keeps observed results, missing evidence
                        and review decisions separate.
                      </p>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="drawer-footer">
            <span>
              <span className="tiny-dot" />
              Local evidence
            </span>
            <Button variant="ghost" small onClick={copy}>
              <Copy size={13} />
              Copy example ID
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function SetupDialog({
  task,
  open,
  close,
}: {
  task: Task;
  open: boolean;
  close: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title="Comparison setup"
      description="What stayed the same, and what changed."
    >
      <div className="dialog-inner">
        <div className="setup-highlight">
          <GitBranch size={18} />
          <div>
            <strong>One task. The same starting point.</strong>
            <p>Illustrative configuration for these two attempts.</p>
          </div>
        </div>
        <dl className="context-list">
          <div>
            <dt>Repository</dt>
            <dd>{task.repository}</dd>
          </div>
          <div>
            <dt>Starting revision</dt>
            <dd className="mono">7f31a2c · sample</dd>
          </div>
          <div>
            <dt>Task version</dt>
            <dd>v1 · same prompt</dd>
          </div>
          <div>
            <dt>Acceptance checks</dt>
            <dd>{task.checks.length} · same selected check bundle</dd>
          </div>
          <div>
            <dt>Agent tools</dt>
            <dd>Read, edit and terminal · sample</dd>
          </div>
          {task.attemptTimeoutMinutes && (
            <div>
              <dt>Attempt timeout</dt>
              <dd>{task.attemptTimeoutMinutes} minutes · configured only</dd>
            </div>
          )}
          <div>
            <dt>Attempts</dt>
            <dd>1 per illustrative model</dd>
          </div>
        </dl>
        <div className="setup-models">
          <span>
            <ModelMark side={modelSide(task, "a")} />
            {modelLabel(task, "a")} <small>Baseline</small>
          </span>
          <ArrowRight size={16} />
          <span>
            <ModelMark side={modelSide(task, "b")} />
            {modelLabel(task, "b")} <small>Candidate</small>
          </span>
        </div>
        <p className="quiet-note">
          A single pair of attempts cannot establish general model reliability.
          Real comparisons also need recorded provider settings and repeated
          trials.
        </p>
      </div>
      <div className="dialog-footer">
        <Button variant="primary" onClick={close}>
          Back to comparison
        </Button>
      </div>
    </Modal>
  );
}

export type CaseSeed = { task: Task; prefill: boolean };
export function SaveCaseDialog({
  seed,
  close,
  save,
}: {
  seed: CaseSeed | null;
  close: () => void;
  save: (c: SavedCase) => void;
}) {
  const [source, setSource] = useState("session");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [checks, setChecks] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (seed) {
      setSource(seed.task.id);
      setName(seed.prefill ? seed.task.title : "");
      setObjective(seed.prefill ? seed.task.description : "");
      setChecks(seed.task.checks.map((c) => c.id));
      setSubmitted(false);
    }
  }, [seed]);
  const task = tasks.find((t) => t.id === source)!;
  const valid = !!name.trim() && !!objective.trim() && checks.length > 0;
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    save({
      id: crypto.randomUUID(),
      sourceTaskId: source,
      name: name.trim(),
      objective: objective.trim(),
      checkIds: checks,
      savedAt: new Date().toISOString(),
    });
  }
  return (
    <Modal
      open={!!seed}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title={
        seed?.prefill ? "Save as an evaluation case" : "New evaluation case"
      }
      description="Keep the task and its success conditions together."
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-inner case-form">
          <label>
            Source example
            <select
              value={source}
              onChange={(e) => {
                const t = tasks.find((t) => t.id === e.target.value)!;
                setSource(t.id);
                setChecks(t.checks.map((c) => c.id));
              }}
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Case name
            <input
              autoComplete="off"
              maxLength={100}
              placeholder="A task worth repeating"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={submitted && !name.trim()}
            />
          </label>
          <label>
            What should the agent accomplish?
            <textarea
              maxLength={600}
              rows={3}
              placeholder="Describe a clear, testable outcome…"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              aria-invalid={submitted && !objective.trim()}
            />
          </label>
          <fieldset>
            <legend>
              Success conditions <span>Choose at least one</span>
            </legend>
            {task.checks.map((c) => (
              <label className="checkbox-row" key={c.id}>
                <input
                  type="checkbox"
                  checked={checks.includes(c.id)}
                  onChange={(e) =>
                    setChecks((prev) =>
                      e.target.checked
                        ? [...prev, c.id]
                        : prev.filter((id) => id !== c.id),
                    )
                  }
                />
                <span>{c.name}</span>
              </label>
            ))}
          </fieldset>
          {submitted && !valid && (
            <p className="form-error" role="alert">
              Add a name, an objective and at least one success condition.
            </p>
          )}
          <p className="form-hint">
            <Info size={13} />
            Saved in this preview on your device. No agent will run.
          </p>
        </div>
        <div className="dialog-footer">
          <Button onClick={close} variant="ghost">
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            <Bookmark size={14} />
            Save case
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const replayStages = [
  "Prepare the starting state",
  "Replay the baseline attempt",
  "Replay the candidate attempt",
  "Load sample check results",
  "Compare the outcomes",
];
export function ReplayDialog({
  task,
  open,
  close,
  finish,
}: {
  task: Task;
  open: boolean;
  close: () => void;
  finish: () => void;
}) {
  const [step, setStep] = useState(-1);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (open) {
      setStep(-1);
      setStarted(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !started) return;
    if (step >= replayStages.length) return;
    const timer = setTimeout(() => setStep((s) => s + 1), step < 0 ? 150 : 800);
    return () => clearTimeout(timer);
  }, [open, started, step]);
  const complete = step >= replayStages.length;
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title="Replay an example comparison"
      description="A short preview of the evaluation workflow."
    >
      <div className="dialog-inner">
        <div className="replay-task">
          <span className="task-icon">
            <GitCompareArrows size={24} />
          </span>
          <h3>{task.title}</h3>
          <p>
            Model A <span>vs</span> Model B
          </p>
        </div>
        <div className="replay-progress">
          <motion.div
            initial={false}
            animate={{
              width: (Math.max(0, step) / replayStages.length) * 100 + "%",
            }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <div className="replay-steps">
          {replayStages.map((s, i) => (
            <div
              className={i < step ? "done" : i === step ? "current" : ""}
              key={s}
            >
              <span>
                {i < step ? (
                  <Check size={14} />
                ) : i === step ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <span className="step-number">{i + 1}</span>
                )}
              </span>
              {s}
            </div>
          ))}
        </div>
        <p className="form-hint">
          <Info size={13} />
          Demo only. This replays fixed sample data; no model or command is
          executed.
        </p>
      </div>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={close}>
          {started && !complete ? "Cancel replay" : "Close"}
        </Button>
        {complete ? (
          <Button variant="primary" onClick={finish}>
            Review comparison
            <ArrowRight size={15} />
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={started}
            onClick={() => setStarted(true)}
          >
            {started ? (
              <>
                <LoaderCircle size={14} className="spin" />
                Replaying example
              </>
            ) : (
              <>
                <Play size={14} />
                Start demo replay
              </>
            )}
          </Button>
        )}
      </div>
    </Modal>
  );
}

export function CommandPalette({
  open,
  close,
  navigate,
  openTask,
  newCase,
  newComparison,
  preferences,
}: {
  open: boolean;
  close: () => void;
  navigate: (page: "home" | "saved" | "activity") => void;
  openTask: (id: string) => void;
  newCase: () => void;
  newComparison: () => void;
  preferences: () => void;
}) {
  function choose(action: () => void) {
    close();
    setTimeout(action, 80);
  }
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title="Jump to anything"
      description="Find a task or choose a workspace action."
      className="command-modal"
    >
      <Command loop>
        <div className="command-search">
          <Search size={19} />
          <Command.Input
            autoFocus
            placeholder="Search tasks or actions…"
            aria-label="Search tasks or actions"
          />
        </div>
        <Command.List>
          <Command.Empty>No matching tasks or actions.</Command.Empty>
          <Command.Group heading="TASKS">
            {tasks.map((t) => (
              <Command.Item
                key={t.id}
                value={t.title + " " + t.repository}
                onSelect={() => choose(() => openTask(t.id))}
              >
                <GitCompareArrows size={16} />
                <span>
                  {t.title}
                  <small>{t.repository}</small>
                </span>
                <ArrowRight size={14} />
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Separator />
          <Command.Group heading="WORKSPACE">
            <Command.Item onSelect={() => choose(newComparison)}>
              <GitCompareArrows size={16} />
              Start a new comparison
            </Command.Item>
            <Command.Item onSelect={() => choose(() => navigate("home"))}>
              <FolderGit2 size={16} />
              Go to tasks
            </Command.Item>
            <Command.Item onSelect={() => choose(() => navigate("saved"))}>
              <Bookmark size={16} />
              Open saved cases
            </Command.Item>
            <Command.Item onSelect={() => choose(newCase)}>
              <ListChecks size={16} />
              Create an evaluation case
            </Command.Item>
            <Command.Item onSelect={() => choose(preferences)}>
              <Settings2 size={16} />
              Preferences
            </Command.Item>
          </Command.Group>
        </Command.List>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </Command>
    </Modal>
  );
}

export function Preferences({
  open,
  close,
  motionOn,
  setMotionOn,
  compact,
  setCompact,
  systemReduced,
}: {
  open: boolean;
  close: () => void;
  motionOn: boolean;
  setMotionOn: (v: boolean) => void;
  compact: boolean;
  setCompact: (v: boolean) => void;
  systemReduced: boolean;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title="Workspace preferences"
      description="Appearance, local storage, and desktop setup."
    >
      <div className="dialog-inner">
        <div className="preference-row">
          <div>
            <strong>Appearance</strong>
            <p>Graphite with a restrained mint accent.</p>
          </div>
          <span className="theme-swatch">Graphite</span>
        </div>
        <div className="preference-row">
          <div>
            <strong>Compact spacing</strong>
            <p>Fit more of your workspace on screen.</p>
          </div>
          <button
            role="switch"
            aria-label="Compact spacing"
            aria-checked={compact}
            className={"switch " + (compact ? "on" : "")}
            onClick={() => setCompact(!compact)}
          >
            <motion.span layout transition={spring} />
          </button>
        </div>
        <div className="preference-row">
          <div>
            <strong>Interface motion</strong>
            <p>
              {systemReduced
                ? "Your system preference reduces motion."
                : "Smooth navigation and subtle transitions."}
            </p>
          </div>
          <button
            role="switch"
            aria-label="Interface motion"
            aria-checked={motionOn && !systemReduced}
            disabled={systemReduced}
            className={"switch " + (motionOn && !systemReduced ? "on" : "")}
            onClick={() => setMotionOn(!motionOn)}
          >
            <motion.span layout transition={spring} />
          </button>
        </div>
        <p className="form-hint">
          <ShieldCheck size={14} />
          Preferences are saved on this device.
        </p>
        {open && <DesktopEnvironmentPanel />}
      </div>
      <div className="dialog-footer">
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

export function AboutDialog({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title="AgentLens · Prototype 05"
      description="Quiet Lab — controlled model comparisons with inspectable evidence."
    >
      <div className="dialog-inner about-copy">
        <p>
          Choose a task, compare two illustrative attempts, and open the
          evidence behind a difference.
        </p>
        <div className="about-steps">
          <span>
            <Search size={16} />
            Find a task
          </span>
          <ChevronRight size={12} />
          <span>
            <GitCompareArrows size={16} />
            Compare
          </span>
          <ChevronRight size={12} />
          <span>
            <Code2 size={16} />
            Inspect
          </span>
        </div>
        <p>
          Recorded run reads the existing T01-A1 evidence through a local,
          read-only connection. Its events, command output and final Git diff
          are real. The separate sample comparisons still use fictional models
          and results. The Comparison page shows the separately recorded
          Sol/high and Terra/high experiment, with independent checks and
          explicit progress.
        </p>
        <p>
          Desktop insight analysis uses your chosen OpenAI-compatible endpoint
          and model, with a provider key only when required. Review the evidence
          before generating; findings open paired sources. The existing C01
          example notes remain separate. Live analysis quality evaluation is
          still pending.
        </p>
        <p>
          Try <kbd>⌘K</kbd> to jump between tasks, save an evaluation case, or
          replay the sample workflow. Motion respects your system preferences.
        </p>
        <div className="about-references">
          Design references: Linear, Raycast and patterns discovered through
          21st.dev.
          <br />
          Built with React, Motion, Radix, cmdk and Lucide.
        </div>
      </div>
      <div className="dialog-footer">
        <Button variant="primary" onClick={close}>
          Explore the workspace
          <ArrowRight size={15} />
        </Button>
      </div>
    </Modal>
  );
}
