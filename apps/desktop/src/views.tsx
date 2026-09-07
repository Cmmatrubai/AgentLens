import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  Info,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
  CircleHelp,
  Layers,
  ListChecks,
  ScanLine,
} from "lucide-react";
import {
  tasks,
  passCount,
  importantCheck,
  modelLabel,
  modelSide,
  type Task,
  type Check as TaskCheck,
  type SavedCase,
} from "./data";
import {
  AnimatedTabs,
  Button,
  IconButton,
  ModelMark,
  OutcomeBadge,
  StateBadge,
  spring,
} from "./ui";

type OpenEvidence = (
  task: Task,
  check: TaskCheck,
  tab?: "result" | "patch" | "context",
  side?: "a" | "b",
) => void;
export function MiniComparison({ task }: { task: Task }) {
  const max = Math.max(task.secondsA, task.secondsB);
  return (
    <div
      className="mini-comparison"
      aria-label="Illustrative attempt comparison"
    >
      <div className="chart-caption">
        ELAPSED TIME <span>Shorter is faster</span>
      </div>
      {(["a", "b"] as const).map((side) => (
        <div className="mini-model" key={side}>
          <div className="mini-model-head">
            <span>{modelLabel(task, side)}</span>
            <span
              className={
                passCount(task, side) === task.checks.length
                  ? "mint"
                  : "amber-text"
              }
            >
              {passCount(task, side)} / {task.checks.length} checks
            </span>
          </div>
          <div className="mini-bar-track">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ ...spring, delay: side === "a" ? 0.1 : 0.18 }}
              style={{
                width:
                  ((side === "a" ? task.secondsA : task.secondsB) / max) * 100 +
                  "%",
              }}
              className={"mini-bar " + side}
            />
          </div>
          <span className="mini-time">
            {side === "a" ? task.timeA : task.timeB}
          </span>
        </div>
      ))}
    </div>
  );
}
export function Home({
  openTask,
  newComparison,
  openRecorded,
  openRealComparison,
  repository,
  onClearRepository,
}: {
  openTask: (id: string) => void;
  newComparison: () => void;
  openRecorded: () => void;
  openRealComparison: () => void;
  repository: string;
  onClearRepository: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "difference" | "incomplete">(
    "all",
  );
  const [query, setQuery] = useState("");
  const filtered = tasks.filter(
    (t) =>
      (repository === "all" || t.repository === repository) &&
      (filter === "all" || t.status === filter) &&
      (t.title + " " + t.repository + " " + t.category)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="page home-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR EVALUATION WORKSPACE</div>
          <h1>Real tasks. Clearer choices.</h1>
          <p>Compare models on the work that matters to you.</p>
        </div>
        <Button variant="primary" onClick={newComparison}>
          <Plus size={16} />
          New comparison
        </Button>
      </div>
      <button
        className="recorded-home-card real-comparison-entry"
        onClick={openRealComparison}
      >
        <GitCompareArrows size={20} />
        <span>
          <strong>Sol vs Terra · a real controlled comparison</strong>
          <span>Same task, high reasoning, independent evaluation</span>
        </span>
        <ArrowRight size={16} />
      </button>
      <button className="recorded-home-card" onClick={openRecorded}>
        <ShieldCheck size={19} />
        <span>
          <strong>Open a real AgentLens recording</strong>
          <small>
            T01 · A1 — recorded actions, check output and final Git evidence
          </small>
        </span>
        <span className="recorded-home-label">REAL EVIDENCE</span>
        <ChevronRight size={15} />
      </button>
      <motion.section
        className="featured-comparison"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="featured-copy">
          <div className="section-kicker">
            <span className="status-light" />
            READY TO REVIEW
            <span className="kicker-spacer">Latest comparison</span>
          </div>
          <h2>Speed is only half the story.</h2>
          <p>
            The quicker attempt missed an expired-session check.
            <br className="wide-only" /> See the difference, then inspect what
            happened.
          </p>
          <Button
            onClick={() => openTask("session")}
            className="feature-action"
          >
            Review comparison
            <ArrowUpRight size={15} />
          </Button>
        </div>
        <MiniComparison task={tasks[0]} />
      </motion.section>
      <div className="library-heading">
        <h2>
          Task library <span>{tasks.length}</span>
        </h2>
        {repository !== "all" && (
          <button className="repository-filter" onClick={onClearRepository}>
            <FolderGit2 size={13} />
            {repository}
            <X size={12} />
          </button>
        )}
      </div>
      <div className="library-controls">
        <AnimatedTabs
          id="task-filter"
          tabs={[
            { id: "all", label: "All tasks" },
            { id: "difference", label: "Differences", count: 2 },
            { id: "incomplete", label: "Needs evidence", count: 1 },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label="Search tasks"
            placeholder="Find a task…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear task search" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div
        id="task-filter-panel"
        role="tabpanel"
        aria-labelledby={"task-filter-" + filter}
        className="task-list"
      >
        <div className="task-list-header" aria-hidden="true">
          <span>Task</span>
          <span>Attempts</span>
          <span>Latest result</span>
          <span />
        </div>
        <AnimatePresence mode="popLayout">
          {filtered.map((task, index) => (
            <motion.button
              layout="position"
              key={task.id}
              className="task-row"
              onClick={() => openTask(task.id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, delay: index * 0.035 }}
            >
              <span className="task-identity">
                <span className={"task-icon " + task.id}>
                  {task.id === "session" ? (
                    <ShieldCheck size={20} />
                  ) : task.id === "cleanup" ? (
                    <Terminal size={20} />
                  ) : (
                    <ScanLine size={20} />
                  )}
                </span>
                <span>
                  <span className="task-title">{task.title}</span>
                  <span className="task-meta">
                    <span className="mono">{task.code}</span>
                    <span className="meta-dot">·</span>
                    {task.repository}
                  </span>
                </span>
              </span>
              <span className="attempt-pair">
                <span className="stacked-models">
                  <ModelMark side="a" />
                  <ModelMark side="b" />
                </span>
                <span>2 attempts</span>
              </span>
              <StateBadge
                incomplete={task.status === "incomplete"}
                same={task.status === "same"}
              />
              <ChevronRight size={16} className="row-arrow" />
            </motion.button>
          ))}
        </AnimatePresence>
        {!filtered.length && (
          <div className="empty-state compact-empty">
            <Search size={26} />
            <h3>No matching tasks</h3>
            <p>Try a different search or clear the filters.</p>
            <Button
              small
              onClick={() => {
                setQuery("");
                setFilter("all");
                onClearRepository();
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>
      <div className="home-footnote">
        <Info size={14} />
        <p>
          Every result has a source. Open a comparison to follow it back to the
          evidence.
        </p>
      </div>
    </div>
  );
}

function AttemptCard({
  task,
  side,
  openEvidence,
}: {
  task: Task;
  side: "a" | "b";
  openEvidence: OpenEvidence;
}) {
  const count = passCount(task, side);
  const missing = task.checks.some((c) => c[side] === "unknown");
  return (
    <article className={"attempt-card " + side}>
      <div className="attempt-card-head">
        <span className="model-identity">
          <ModelMark side={modelSide(task, side)} />
          <span>
            <strong>{modelLabel(task, side)}</strong>
            <span>
              {side === "a" ? "Baseline" : "Candidate"} · Attempt 0
              {side === "a" ? "1" : "2"}
            </span>
          </span>
        </span>
        <span
          className={
            "attempt-verdict " +
            (count === task.checks.length
              ? "success"
              : missing
                ? "unknown"
                : "warning")
          }
        >
          {count === task.checks.length ? (
            <Check size={13} />
          ) : missing ? (
            <CircleHelp size={13} />
          ) : (
            <Info size={13} />
          )}{" "}
          {count === task.checks.length
            ? "All checks passed"
            : missing
              ? "Evidence missing"
              : "Check failed"}
        </span>
      </div>
      <div className="attempt-result">
        <strong>
          {count}
          <span> / {task.checks.length}</span>
        </strong>
        <span>acceptance checks passed</span>
      </div>
      <div className="check-segments">
        {task.checks.map((check, index) => (
          <button
            aria-label={
              "Inspect " + check.name + " for " + modelLabel(task, side)
            }
            key={check.id}
            className={"check-segment " + check[side]}
            onClick={() => openEvidence(task, check, "result", side)}
            title={check.name}
          >
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.35, delay: 0.08 + index * 0.055 }}
            />
          </button>
        ))}
      </div>
      <div className="attempt-card-bottom">
        <span>
          <Clock3 size={13} />
          Elapsed time
        </span>
        <strong>{side === "a" ? task.timeA : task.timeB}</strong>
      </div>
    </article>
  );
}
export function Comparison({
  task,
  openEvidence,
  openSetup,
  saveCase,
  replay,
}: {
  task: Task;
  openEvidence: OpenEvidence;
  openSetup: () => void;
  saveCase: () => void;
  replay: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "checks" | "execution">(
    "overview",
  );
  const [side, setSide] = useState<"a" | "b">("b");
  const check = importantCheck(task);
  const elapsed = side === "a" ? task.secondsA : task.secondsB;
  const times = [0, 0.11, 0.48, 0.86, 1].map((fraction) => {
    if (!elapsed) return "—";
    const seconds = Math.floor(elapsed * fraction);
    return (
      String(Math.floor(seconds / 60)).padStart(2, "0") +
      ":" +
      String(seconds % 60).padStart(2, "0")
    );
  });
  return (
    <div className="page comparison-page">
      <div className="page-heading comparison-heading">
        <div>
          <div className="eyebrow">
            <span className="mono">{task.code}</span>
            <span> / </span>
            {task.category}
          </div>
          <h1>{task.title}</h1>
          <p>{task.description}</p>
        </div>
        <div className="heading-actions">
          <IconButton label="Compare this task again" onClick={replay}>
            <Play size={16} />
          </IconButton>
          <Button onClick={saveCase}>
            <Bookmark size={15} />
            Save as case
          </Button>
        </div>
      </div>
      {task.models && (
        <div className="demo-result-context">
          <Check size={13} />
          <span>
            From your demo comparison · {task.checks.length} selected{" "}
            {task.checks.length === 1 ? "condition" : "conditions"}
          </span>
          <span>Times describe the full sample attempts.</span>
        </div>
      )}
      <div className="comparison-context">
        <span>
          <FolderGit2 size={14} />
          {task.repository}
        </span>
        <span className="meta-dot">·</span>
        <span>1 attempt per model</span>
        <button onClick={openSetup}>
          <GitBranch size={13} />
          Compare setup
          <ChevronRight size={12} />
        </button>
      </div>
      <AnimatedTabs
        id="comparison-view"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "checks", label: "Checks", count: task.checks.length },
          { id: "execution", label: "Execution" },
        ]}
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          id="comparison-view-panel"
          role="tabpanel"
          aria-labelledby={"comparison-view-" + tab}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.16 }}
        >
          {tab === "overview" && (
            <>
              <section className="comparison-summary">
                <StateBadge
                  incomplete={task.status === "incomplete"}
                  same={task.status === "same"}
                />
                <h2>{task.headline}</h2>
                <p>{task.takeaway}</p>
              </section>
              <div className="attempt-grid">
                <AttemptCard task={task} side="a" openEvidence={openEvidence} />
                <AttemptCard task={task} side="b" openEvidence={openEvidence} />
              </div>
              <div className="section-heading">
                <h3>
                  {task.status === "incomplete"
                    ? "What we still need"
                    : task.status === "same"
                      ? "What the selected checks show"
                      : "What made the difference"}
                </h3>
                <span>Acceptance-check evidence</span>
              </div>
              <button
                className="difference-card"
                onClick={() =>
                  task.status === "same"
                    ? setTab("checks")
                    : openEvidence(task, check)
                }
              >
                <span
                  className={
                    "difference-icon " +
                    (task.status === "incomplete" ? "unknown" : "")
                  }
                >
                  {task.status === "incomplete" ? (
                    <CircleHelp size={20} />
                  ) : (
                    <GitCompareArrows size={20} />
                  )}
                </span>
                <span className="difference-text">
                  <strong>{task.difference}</strong>
                  <span>
                    {task.status === "incomplete"
                      ? "Inspect the missing result before making a comparison."
                      : task.status === "same"
                        ? "Review both outputs and the scope of the selected conditions."
                        : `This check ${check.a === "pass" ? "passed" : "failed"} for ${modelLabel(task, "a")} and ${check.b === "pass" ? "passed" : "failed"} for ${modelLabel(task, "b")}.`}
                  </span>
                </span>
                <span className="evidence-link">
                  {task.status === "same"
                    ? "Review checks"
                    : "Inspect evidence"}
                  <ArrowUpRight size={15} />
                </span>
              </button>
              <div className="comparison-note">
                <Info size={14} />
                <span>
                  These results describe the two attempts shown. They are not a
                  general model ranking.
                </span>
              </div>
            </>
          )}
          {tab === "checks" && (
            <section className="checks-view">
              <div className="section-heading">
                <div>
                  <h2>Did the task meet its requirements?</h2>
                  <p>
                    The same {task.checks.length} selected acceptance{" "}
                    {task.checks.length === 1 ? "check" : "checks"}, applied to
                    both attempts.
                  </p>
                </div>
              </div>
              <div className="checks-table">
                <div className="checks-table-heading">
                  <span>Acceptance check</span>
                  <span>{modelLabel(task, "a")}</span>
                  <span>{modelLabel(task, "b")}</span>
                  <span />
                </div>
                {task.checks.map((c) => (
                  <button
                    className="check-row"
                    key={c.id}
                    onClick={() => openEvidence(task, c)}
                  >
                    <span>
                      <strong>{c.name}</strong>
                      <span>{c.expectation}</span>
                    </span>
                    <OutcomeBadge value={c.a} />
                    <OutcomeBadge value={c.b} />
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
              <p className="quiet-note">
                A missing result stays unknown. Passing these checks still
                leaves room for human review.
              </p>
            </section>
          )}
          {tab === "execution" && (
            <section className="execution-view">
              <div className="section-heading">
                <div>
                  <h2>The important moments</h2>
                  <p>A short path through the illustrative execution record.</p>
                </div>
                <div className="segmented" aria-label="Select attempt">
                  {(["a", "b"] as const).map((s) => (
                    <button
                      key={s}
                      aria-pressed={side === s}
                      className={side === s ? "selected" : ""}
                      onClick={() => setSide(s)}
                    >
                      {side === s && (
                        <motion.span
                          layoutId="execution-side"
                          transition={spring}
                        />
                      )}
                      <span>{modelLabel(task, s)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="timeline">
                {[
                  {
                    title: "Started from the saved task",
                    note: "Same prompt, starting code and check bundle",
                    icon: GitBranch,
                    action: openSetup,
                  },
                  {
                    title: task.change,
                    note: task.file,
                    icon: FileCode2,
                    action: () => openEvidence(task, check, "patch", side),
                  },
                  {
                    title: "Ran the acceptance checks",
                    note:
                      passCount(task, side) +
                      " passed · " +
                      (task.checks.some((c) => c[side] === "unknown")
                        ? "1 result not captured"
                        : task.checks.length -
                          passCount(task, side) +
                          " failed"),
                    icon: ListChecks,
                    action: () => openEvidence(task, check, "result", side),
                  },
                  {
                    title: "Recorded the final change",
                    note: "Repository evidence is available for inspection",
                    icon: Layers,
                    action: () => openEvidence(task, check, "patch", side),
                  },
                  {
                    title: elapsed ? "Attempt finished" : "Capture ended",
                    note: elapsed
                      ? "Process completion is separate from task correctness"
                      : "Completion time was not captured for this attempt",
                    icon: Check,
                    action: () => openEvidence(task, check, "context", side),
                  },
                ].map((event, index) => (
                  <motion.button
                    key={side + event.title}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.035 }}
                    className="timeline-event"
                    onClick={event.action}
                  >
                    <span className="timeline-time mono">{times[index]}</span>
                    <span className="timeline-dot">
                      <event.icon size={15} />
                    </span>
                    <span className="timeline-event-copy">
                      <strong>{event.title}</strong>
                      <span>{event.note}</span>
                    </span>
                    <ChevronRight size={15} />
                  </motion.button>
                ))}
              </div>
              <div className="comparison-note">
                <Info size={14} />
                <span>
                  Chronological order shows what happened next, without
                  inferring why.
                </span>
              </div>
            </section>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function SavedCases({
  cases,
  openCase,
  newCase,
}: {
  cases: SavedCase[];
  openCase: (item: SavedCase) => void;
  newCase: () => void;
}) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LIBRARY THAT GETS MORE USEFUL</div>
          <h1>Keep the work. Repeat the question.</h1>
          <p>
            Save real tasks so your next model has something meaningful to
            prove.
          </p>
        </div>
        <Button variant="primary" onClick={newCase}>
          <Plus size={16} />
          New case
        </Button>
      </div>
      <div className="saved-banner">
        <Bookmark size={20} />
        <span>
          Each case keeps its task, starting point and success conditions
          together.
        </span>
      </div>
      <div className="saved-case-grid">
        {cases.map((item) => {
          const task = tasks.find((t) => t.id === item.sourceTaskId)!;
          return (
            <motion.button
              layout
              key={item.id}
              className="saved-case-card"
              onClick={() => openCase(item)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="saved-card-top">
                <span className={"task-icon " + task.id}>
                  <Bookmark size={20} />
                </span>
                <ArrowUpRight size={16} />
              </div>
              <h2>{item.name}</h2>
              <p>{item.objective}</p>
              <div className="saved-check-count">
                <ListChecks size={14} />
                {item.checkIds.length} success condition
                {item.checkIds.length === 1 ? "" : "s"}
              </div>
              <div className="saved-card-footer">
                <span>{task.repository}</span>
                <span>
                  {item.savedAt === "Example case"
                    ? "Example case"
                    : "Saved locally"}
                </span>
              </div>
            </motion.button>
          );
        })}
        <button className="new-case-card" onClick={newCase}>
          <span>
            <Plus size={22} />
          </span>
          <strong>Turn a task into a case</strong>
          <p>Keep a useful challenge for your next comparison.</p>
        </button>
      </div>
    </div>
  );
}
export function ActivityView({ openTask }: { openTask: (id: string) => void }) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE, IN ORDER</div>
          <h1>Recent activity</h1>
          <p>Pick up a comparison or revisit an earlier result.</p>
        </div>
      </div>
      <div className="activity-date">ILLUSTRATIVE SESSION</div>
      <div className="activity-list">
        {tasks
          .flatMap((task) => [
            {
              task,
              kind: "comparison",
              title: "Comparison ready to review",
              note: task.title,
            },
            {
              task,
              kind: "capture",
              title: "Two attempts added",
              note: "Recorded check evidence is available",
            },
          ])
          .map((entry, index) => (
            <motion.button
              key={entry.task.id + entry.kind}
              className="activity-item"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.025 }}
              onClick={() => openTask(entry.task.id)}
            >
              <span className="activity-node">
                {entry.kind === "comparison" ? (
                  <GitCompareArrows size={17} />
                ) : (
                  <Terminal size={16} />
                )}
              </span>
              <span>
                <strong>{entry.title}</strong>
                <span>{entry.note}</span>
              </span>
              <span className="activity-code mono">{entry.task.code}</span>
              <ChevronRight size={15} />
            </motion.button>
          ))}
      </div>
    </div>
  );
}
