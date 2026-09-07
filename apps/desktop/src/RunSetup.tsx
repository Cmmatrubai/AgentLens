import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileCheck2,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  Info,
  Layers,
  LockKeyhole,
  Play,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { tasks, type Task } from "./data";
import { Button, ModelMark } from "./ui";
import {
  defaultRunConfig,
  modelName,
  validateRunConfig,
  type RunConfig,
} from "./run-model";

export function RunSetup({
  draft,
  setDraft,
  onStart,
  onClose,
}: {
  draft: RunConfig;
  setDraft: (value: RunConfig) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const task = tasks.find((t) => t.id === draft.taskId) ?? tasks[0];
  const errors = validateRunConfig(draft, task);
  const selectedChecks = task.checks.filter((c) =>
    draft.checkIds.includes(c.id),
  );
  function next() {
    if (
      (step === 0 && !draft.checkIds.length) ||
      (step === 1 && draft.baseline === draft.candidate)
    ) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => s + 1);
  }
  const headers = [
    [
      "Give both models the same challenge.",
      "Choose a sample case and the conditions that define success.",
    ],
    [
      "Change the model. Keep the setup.",
      "A baseline you know, and a candidate you want to understand.",
    ],
    [
      "A clear question. A fair starting point.",
      "Review what you’re comparing before the first attempt starts.",
    ],
  ];
  return (
    <div className="page setup-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <GitCompareArrows size={13} />
            NEW COMPARISON
          </div>
          <h1>{headers[step][0]}</h1>
          <p>{headers[step][1]}</p>
        </div>
        <span className="setup-mode">
          <span />
          Interactive preview
        </span>
      </div>
      <ol className="setup-stepper" aria-label="Comparison setup progress">
        {["Choose a case", "Choose models", "Review & start"].map(
          (label, index) => (
            <li
              key={label}
              className={
                step === index ? "current" : step > index ? "complete" : ""
              }
            >
              <button
                aria-current={step === index ? "step" : undefined}
                disabled={index > step}
                onClick={() => {
                  setStep(index);
                  setShowErrors(false);
                }}
              >
                <span className="step-circle">
                  {step > index ? <Check size={12} /> : index + 1}
                </span>
                {label}
              </button>
              {index < 2 && <span className="step-connector" />}
            </li>
          ),
        )}
      </ol>
      <div className="setup-grid">
        <section className="setup-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -7 }}
              transition={{ duration: 0.18 }}
            >
              {step === 0 && (
                <>
                  <div className="setup-section-head">
                    <h2>A task worth repeating</h2>
                    <span>3 sample cases</span>
                  </div>
                  <div
                    className="case-choices"
                    role="radiogroup"
                    aria-label="Sample case"
                  >
                    {tasks.map((t, index) => (
                      <button
                        key={t.id}
                        role="radio"
                        tabIndex={task.id === t.id ? 0 : -1}
                        onKeyDown={(e) => {
                          if (
                            ![
                              "ArrowLeft",
                              "ArrowRight",
                              "ArrowUp",
                              "ArrowDown",
                            ].includes(e.key)
                          )
                            return;
                          e.preventDefault();
                          const direction =
                            e.key === "ArrowRight" || e.key === "ArrowDown"
                              ? 1
                              : -1;
                          const nextIndex =
                            (index + direction + tasks.length) % tasks.length;
                          setDraft({
                            ...defaultRunConfig(tasks[nextIndex]),
                            baseline: draft.baseline,
                            candidate: draft.candidate,
                            timeoutMinutes: draft.timeoutMinutes,
                          });
                          setShowErrors(false);
                          const options =
                            e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                              '[role="radio"]',
                            );
                          options?.[nextIndex]?.focus();
                        }}
                        aria-checked={task.id === t.id}
                        className={
                          "case-choice " + (task.id === t.id ? "selected" : "")
                        }
                        onClick={() => {
                          setDraft({
                            ...defaultRunConfig(t),
                            baseline: draft.baseline,
                            candidate: draft.candidate,
                            timeoutMinutes: draft.timeoutMinutes,
                          });
                          setShowErrors(false);
                        }}
                      >
                        <span className={"task-icon " + t.id}>
                          {t.id === "session" ? (
                            <ShieldCheck size={19} />
                          ) : t.id === "cleanup" ? (
                            <Terminal size={19} />
                          ) : (
                            <Layers size={19} />
                          )}
                        </span>
                        <strong>{t.title}</strong>
                        <small>{t.repository}</small>
                        <span className="choice-radio">
                          {task.id === t.id && <span />}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="task-prompt">
                    <div>
                      <FileCheck2 size={15} />
                      <span>TASK BRIEF</span>
                      <span className="version-label">v1 · sample</span>
                    </div>
                    <p>{task.description}</p>
                  </div>
                  <div className="setup-section-head check-selection-head">
                    <h2>What counts as success?</h2>
                    <span>
                      {selectedChecks.length} of {task.checks.length} selected
                    </span>
                  </div>
                  <div className="setup-checks">
                    {task.checks.map((c) => (
                      <label
                        className={
                          "setup-check " +
                          (draft.checkIds.includes(c.id) ? "selected" : "")
                        }
                        key={c.id}
                      >
                        <input
                          type="checkbox"
                          checked={draft.checkIds.includes(c.id)}
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              checkIds: e.target.checked
                                ? [...draft.checkIds, c.id]
                                : draft.checkIds.filter((id) => id !== c.id),
                            });
                            setShowErrors(false);
                          }}
                        />
                        <span>
                          <strong>{c.name}</strong>
                          <small>{c.expectation}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="setup-help">
                    <LockKeyhole size={12} />
                    The selected conditions are fixed when the comparison
                    starts.
                  </p>
                </>
              )}
              {step === 1 && (
                <>
                  <div className="setup-section-head">
                    <h2>Two models. One question.</h2>
                    <button
                      className="text-action"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          baseline: draft.candidate,
                          candidate: draft.baseline,
                        })
                      }
                    >
                      <ArrowRightLeft size={13} />
                      Swap roles
                    </button>
                  </div>
                  <div className="model-picker-grid">
                    {(["baseline", "candidate"] as const).map((role) => (
                      <div
                        className={"model-picker-card " + draft[role]}
                        key={role}
                      >
                        <div className="model-picker-heading">
                          <ModelMark side={draft[role]} />
                          <span>
                            {role === "baseline" ? "BASELINE" : "CANDIDATE"}
                          </span>
                        </div>
                        <label>
                          {role === "baseline"
                            ? "Baseline model"
                            : "Candidate model"}
                          <select
                            value={draft[role]}
                            onChange={(e) => {
                              setDraft({ ...draft, [role]: e.target.value });
                              setShowErrors(false);
                            }}
                          >
                            <option value="a">Model A</option>
                            <option value="b">Model B</option>
                          </select>
                        </label>
                        <p>
                          {role === "baseline"
                            ? "The reference for this comparison."
                            : "The alternative you want to evaluate."}
                        </p>
                        <span className="fixture-label">
                          <span />
                          Fictional model · local fixture
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="shared-setup">
                    <div className="setup-section-head">
                      <h2>
                        <LockKeyhole size={14} />
                        Matched for both attempts
                      </h2>
                      <span>Fixed in this preview</span>
                    </div>
                    <div className="shared-grid">
                      <span>
                        <GitBranch size={15} />
                        <strong>Same starting code</strong>
                        <small>7f31a2c · sample revision</small>
                      </span>
                      <span>
                        <FileCheck2 size={15} />
                        <strong>Same task & checks</strong>
                        <small>
                          {selectedChecks.length} selected{" "}
                          {selectedChecks.length === 1
                            ? "condition"
                            : "conditions"}{" "}
                          · v1
                        </small>
                      </span>
                      <span>
                        <Terminal size={15} />
                        <strong>Same agent tools</strong>
                        <small>Read, edit and terminal · sample</small>
                      </span>
                      <span>
                        <CheckCheck size={15} />
                        <strong>One attempt each</strong>
                        <small>Repeated trials come later</small>
                      </span>
                    </div>
                  </div>
                  <div className="timeout-setting">
                    <div>
                      <strong>Timeout per attempt</strong>
                      <p>A shared limit for the eventual real-run workflow.</p>
                    </div>
                    <label className="sr-only" htmlFor="run-timeout">
                      Attempt timeout
                    </label>
                    <select
                      id="run-timeout"
                      value={draft.timeoutMinutes}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          timeoutMinutes: Number(e.target.value),
                        })
                      }
                    >
                      {[10, 15, 30].map((minutes) => (
                        <option value={minutes} key={minutes}>
                          {minutes} minutes
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="setup-help">
                    <Info size={13} />
                    This preview plays sample events. It does not connect to a
                    provider or enforce a real execution timeout.
                  </p>
                </>
              )}
              {step === 2 && (
                <>
                  <div className="review-case">
                    <span className={"task-icon " + task.id}>
                      <FileCheck2 size={23} />
                    </span>
                    <div>
                      <span className="eyebrow">YOUR COMPARISON</span>
                      <h2>{task.title}</h2>
                      <p>{task.description}</p>
                    </div>
                  </div>
                  <div className="review-versus">
                    <div>
                      <ModelMark side={draft.baseline} />
                      <span>
                        <small>BASELINE</small>
                        <strong>{modelName(draft.baseline)}</strong>
                      </span>
                    </div>
                    <span className="versus-rule">vs</span>
                    <div>
                      <ModelMark side={draft.candidate} />
                      <span>
                        <small>CANDIDATE</small>
                        <strong>{modelName(draft.candidate)}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="review-checks">
                    <div className="setup-section-head">
                      <h2>Success conditions</h2>
                      <button
                        className="text-action"
                        onClick={() => setStep(0)}
                      >
                        Edit
                        <ChevronRight size={12} />
                      </button>
                    </div>
                    {selectedChecks.map((c) => (
                      <p key={c.id}>
                        <Check size={14} />
                        {c.name}
                      </p>
                    ))}
                  </div>
                  <div className="review-settings">
                    <span>
                      <GitBranch size={13} />
                      7f31a2c · sample
                    </span>
                    <span>
                      <Clock3 size={13} />
                      {draft.timeoutMinutes}m per attempt
                    </span>
                    <span>
                      <Layers size={13} />
                      Same tools
                    </span>
                  </div>
                  <div className="review-expectation">
                    <ShieldCheck size={19} />
                    <div>
                      <strong>The result will follow your selections.</strong>
                      <p>
                        Only the selected checks appear in the final comparison.
                        Model roles stay attached to their own evidence.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
          {showErrors && (
            <p role="alert" className="form-error setup-errors">
              {errors[0]}
            </p>
          )}
          <div className="setup-footer">
            <Button
              variant="ghost"
              onClick={() => {
                if (step === 0) onClose();
                else {
                  setStep((s) => s - 1);
                  setShowErrors(false);
                }
              }}
            >
              <ArrowLeft size={14} />
              {step === 0 ? "Back to workspace" : "Back"}
            </Button>
            {step < 2 ? (
              <Button variant="primary" onClick={next}>
                Continue
                <ArrowRight size={15} />
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  if (errors.length) setShowErrors(true);
                  else onStart();
                }}
              >
                <Play size={14} />
                Start demo comparison
              </Button>
            )}
          </div>
        </section>
        <aside className="setup-summary">
          <div className="summary-kicker">COMPARISON AT A GLANCE</div>
          <div className="summary-repository">
            <FolderGit2 size={17} />
            <span>
              {task.repository}
              <small>Sample workspace</small>
            </span>
          </div>
          <div className="summary-divider" />
          <dl>
            <div>
              <dt>Question</dt>
              <dd>{task.title}</dd>
            </div>
            <div>
              <dt>Success conditions</dt>
              <dd>{selectedChecks.length} selected</dd>
            </div>
            <div>
              <dt>Baseline</dt>
              <dd>{modelName(draft.baseline)}</dd>
            </div>
            <div>
              <dt>Candidate</dt>
              <dd>{modelName(draft.candidate)}</dd>
            </div>
          </dl>
          <div className="summary-bottom">
            <div className="summary-mini-path">
              <span />
              <i />
              <span />
              <i />
              <span />
            </div>
            <strong>A result you can investigate.</strong>
            <p>
              From the outcome to the exact check. Every comparison keeps its
              context close.
            </p>
          </div>
          <div className="preview-boundary">
            <Info size={13} />
            <p>
              Accelerated sample playback. No model calls, repository changes or
              charges.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
