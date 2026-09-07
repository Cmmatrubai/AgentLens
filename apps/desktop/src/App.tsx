import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  GitCompareArrows,
  HelpCircle,
  PanelLeft,
  Search,
  Settings2,
  Database,
  X,
} from "lucide-react";
import {
  tasks,
  initialCases,
  type SavedCase,
  type Task,
  type Check as TaskCheck,
} from "./data";
import { Home, Comparison, SavedCases, ActivityView } from "./views";
const RecordedRunView = lazy(() =>
  import("./RecordedRunView").then((m) => ({ default: m.RecordedRunView })),
);
const RealComparisonView = lazy(() =>
  import("./RealComparisonView").then((m) => ({
    default: m.RealComparisonView,
  })),
);
import { RunSetup } from "./RunSetup";
import { RunLive } from "./RunLive";
import {
  advanceDemoRun,
  cancelDemoRun,
  comparisonFromRun,
  createDemoRun,
  defaultRunConfig,
  interruptDemoRun,
  restoreDemoRun,
  resumeDemoRun,
  type DemoRun,
  type RunConfig,
} from "./run-model";
import {
  AboutDialog,
  CommandPalette,
  EvidenceDrawer,
  Preferences,
  SaveCaseDialog,
  SetupDialog,
  type CaseSeed,
  type EvidenceTarget,
} from "./dialogs";
import { Button, IconButton, Logo, Modal, spring } from "./ui";

type Route = {
  page:
    | "home"
    | "saved"
    | "activity"
    | "detail"
    | "setup"
    | "run"
    | "result"
    | "recorded"
    | "comparison";
  taskId?: string;
};
const storagePrefix = "agentlens-prototype-01-";
function readStorage<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem(storagePrefix + key) ?? "null") ??
      fallback
    );
  } catch {
    return fallback;
  }
}
function readCases(): SavedCase[] {
  const value = readStorage<unknown>("cases", initialCases);
  if (!Array.isArray(value)) return initialCases;
  return value.filter(
    (c): c is SavedCase =>
      !!c &&
      typeof c === "object" &&
      typeof c.id === "string" &&
      typeof c.name === "string" &&
      typeof c.objective === "string" &&
      typeof c.savedAt === "string" &&
      tasks.some(
        (t) =>
          t.id === c.sourceTaskId &&
          Array.isArray(c.checkIds) &&
          c.checkIds.length > 0 &&
          c.checkIds.every((id: unknown) =>
            t.checks.some((check) => check.id === id),
          ),
      ),
  );
}
function readRoute(): Route {
  const path = location.hash.replace(/^#\/?/, "");
  if (
    path === "comparison" ||
    path === "recorded" ||
    path === "saved" ||
    path === "activity" ||
    path === "setup" ||
    path === "run" ||
    path === "result"
  )
    return { page: path };
  const taskId = path.split("/")[1];
  if (path.startsWith("task/") && tasks.some((t) => t.id === taskId))
    return { page: "detail", taskId };
  return { page: "home" };
}
function routePath(route: Route) {
  return route.page === "detail"
    ? "task/" + route.taskId
    : route.page === "home"
      ? "tasks"
      : route.page;
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [repository, setRepository] = useState("all");
  const [collapsed, setCollapsed] = useState(
    () => readStorage<boolean>("collapsed", false) === true,
  );
  const [compact, setCompact] = useState(
    () => readStorage<boolean>("compact", false) === true,
  );
  const [motionOn, setMotionOn] = useState(
    () => readStorage<boolean>("motion", true) !== false,
  );
  const systemReduced = !!useReducedMotion();
  const [cases, setCases] = useState<SavedCase[]>(readCases);
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [setup, setSetup] = useState(false);
  const [seed, setSeed] = useState<CaseSeed | null>(null);
  const [run, setRun] = useState<DemoRun | null>(() =>
    restoreDemoRun(readStorage("active-run", null), tasks),
  );
  const [draft, setDraft] = useState<RunConfig>(() =>
    defaultRunConfig(tasks[0]),
  );
  const [command, setCommand] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [about, setAbout] = useState(false);
  const [savedDetail, setSavedDetail] = useState<SavedCase | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    action?: () => void;
    label?: string;
    id: number;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const runTask = tasks.find((t) => t.id === run?.config.taskId) ?? tasks[0];
  const currentTask =
    route.page === "result" && run?.status === "complete"
      ? comparisonFromRun(run, runTask)
      : (tasks.find((t) => t.id === route.taskId) ?? tasks[0]);
  const desktop = new URLSearchParams(location.search).has("desktop");
  const navigate = useCallback((next: Route) => {
    location.hash = "/" + routePath(next);
    setRoute(next);
  }, []);
  const openTask = useCallback(
    (id: string) => navigate({ page: "detail", taskId: id }),
    [navigate],
  );
  const notify = useCallback(
    (message: string, action?: () => void, label?: string) =>
      setToast({ message, action, label, id: Date.now() }),
    [],
  );
  const openEvidence = (
    task: Task,
    check: TaskCheck,
    tab: EvidenceTarget["tab"] = "result",
    side?: "a" | "b",
  ) => setEvidence({ task, check, tab, side });
  const newCase = () => setSeed({ task: currentTask, prefill: false });
  const startSetup = (task: Task = tasks[0]) => {
    if (run?.status === "running" || run?.status === "interrupted") {
      navigate({ page: "run" });
      notify("Finish or stop the current demo before starting another.");
      return;
    }
    setDraft(defaultRunConfig(task));
    navigate({ page: "setup" });
  };
  useEffect(() => {
    if (run?.status !== "running") return;
    const id = run.id;
    const timer = setTimeout(
      () =>
        setRun((current) =>
          current?.id === id ? advanceDemoRun(current) : current,
        ),
      1250,
    );
    return () => clearTimeout(timer);
  }, [run?.id, run?.tick, run?.status]);
  useEffect(() => {
    if (!run) return;
    try {
      localStorage.setItem(storagePrefix + "active-run", JSON.stringify(run));
    } catch {
      notify(
        "Run progress cannot be saved on this device. Keep this window open.",
      );
    }
  }, [run, notify]);
  useEffect(() => {
    const handler = () => setRoute(readRoute());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    document.title =
      (route.page === "comparison"
        ? "Controlled comparison"
        : route.page === "recorded"
          ? "Recorded run"
          : route.page === "setup"
            ? "New comparison"
            : route.page === "run"
              ? "Live comparison"
              : route.page === "result"
                ? currentTask.title
                : route.page === "detail"
                  ? currentTask.title
                  : route.page === "saved"
                    ? "Saved cases"
                    : route.page === "activity"
                      ? "Activity"
                      : "Tasks") + " · AgentLens";
  }, [route.page, route.taskId, currentTask.title]);
  useEffect(() => {
    try {
      localStorage.setItem(storagePrefix + "cases", JSON.stringify(cases));
    } catch {
      notify("Storage is unavailable. Cases will last for this session.");
    }
  }, [cases, notify]);
  useEffect(() => {
    try {
      localStorage.setItem(
        storagePrefix + "collapsed",
        JSON.stringify(collapsed),
      );
      localStorage.setItem(storagePrefix + "compact", JSON.stringify(compact));
      localStorage.setItem(storagePrefix + "motion", JSON.stringify(motionOn));
    } catch {}
  }, [collapsed, compact, motionOn]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (
          !evidence &&
          !setup &&
          !seed &&
          !preferences &&
          !about &&
          !savedDetail &&
          (command || !document.querySelector('[role="dialog"]'))
        )
          setCommand((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [evidence, setup, seed, preferences, about, savedDetail, command]);
  const navItems = [
    { id: "comparison" as const, label: "Comparison", icon: GitCompareArrows },
    { id: "recorded" as const, label: "Recorded run", icon: Database },
    { id: "home" as const, label: "Tasks", icon: GitCompareArrows, count: 3 },
    {
      id: "saved" as const,
      label: "Saved cases",
      icon: Bookmark,
      count: cases.length,
    },
    { id: "activity" as const, label: "Activity", icon: Activity },
  ];
  const activePage = ["detail", "setup", "run", "result"].includes(route.page)
    ? "home"
    : route.page;
  return (
    <MotionConfig
      reducedMotion={motionOn ? "user" : "always"}
      transition={spring}
    >
      <Tooltip.Provider delayDuration={350}>
        <div
          className={
            "desktop-shell " +
            (collapsed ? "is-collapsed " : "") +
            (compact ? "is-compact " : "") +
            (!motionOn || systemReduced ? "reduce-motion " : "") +
            (desktop ? "native-desktop" : "")
          }
        >
          <header className="titlebar">
            <div className="traffic-lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="window-title">
              <Logo small />
              <span>AgentLens</span>
              <span className="title-separator">/</span>
              <span>Personal workspace</span>
            </div>
            <div className="titlebar-right">
              <span className="local-indicator" />
              Local preview
            </div>
          </header>
          <div className="workspace-body">
            <motion.aside className="sidebar" layout>
              <button
                className="workspace-picker"
                onClick={() => setAbout(true)}
                aria-label="About this workspace"
              >
                <span className="workspace-avatar">C</span>
                <span className="workspace-name">
                  <strong>My workspace</strong>
                  <span>Personal</span>
                </span>
                <ChevronDown size={13} />
              </button>
              <nav aria-label="Main navigation">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    className={
                      "nav-item " + (activePage === item.id ? "active" : "")
                    }
                    aria-label={
                      item.label +
                      (item.count !== undefined ? " " + item.count : "")
                    }
                    aria-current={activePage === item.id ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={() => {
                      setRepository("all");
                      navigate({ page: item.id });
                    }}
                  >
                    {activePage === item.id && (
                      <motion.span
                        className="nav-active"
                        layoutId="sidebar-active"
                        transition={spring}
                      />
                    )}
                    <item.icon size={17} />
                    <span>{item.label}</span>
                    {item.count !== undefined && <small>{item.count}</small>}
                  </button>
                ))}
              </nav>
              {run && !["recorded", "comparison"].includes(route.page) && (
                <button
                  className={
                    "sidebar-run " + (run.status === "running" ? "active" : "")
                  }
                  onClick={() => navigate({ page: "run" })}
                  aria-label="Open current comparison"
                >
                  <span className="sidebar-run-dot" />
                  <span>
                    <strong>
                      {run.status === "running"
                        ? "Comparison running"
                        : run.status === "complete"
                          ? "Comparison ready"
                          : run.status === "interrupted"
                            ? "Resume comparison"
                            : "Comparison stopped"}
                    </strong>
                    <small>{runTask.title}</small>
                  </span>
                  <ChevronRight size={12} />
                </button>
              )}
              {!["recorded", "comparison"].includes(route.page) && (
                <div className="sidebar-repositories">
                  <div className="sidebar-section-label">
                    REPOSITORIES <span>3</span>
                  </div>
                  {tasks.map((task, index) => (
                    <button
                      key={task.repository}
                      className={
                        "repository-nav " +
                        (repository === task.repository && route.page === "home"
                          ? "selected"
                          : "")
                      }
                      onClick={() => {
                        setRepository(task.repository);
                        navigate({ page: "home" });
                      }}
                    >
                      <span className={"repo-dot repo-" + index} />
                      <span>{task.repository}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="sidebar-bottom">
                <div className="workspace-note">
                  <span className="note-symbol">
                    <Logo small />
                  </span>
                  <strong>Your work is the benchmark.</strong>
                  <p>Keep the tasks that teach you something.</p>
                </div>
                <button
                  className="nav-item"
                  onClick={() => setPreferences(true)}
                  aria-label="Preferences"
                >
                  <Settings2 size={17} />
                  <span>Preferences</span>
                </button>
                <button
                  className="nav-item"
                  onClick={() => setAbout(true)}
                  aria-label="About this prototype"
                >
                  <HelpCircle size={17} />
                  <span>About this prototype</span>
                  <span className="tiny-outline">05</span>
                </button>
              </div>
            </motion.aside>
            <section className="main-workspace" aria-label="Workspace">
              <div className="location-bar">
                <div className="location-left">
                  <IconButton
                    label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    onClick={() => setCollapsed((v) => !v)}
                  >
                    <PanelLeft size={17} />
                  </IconButton>
                  <span className="location-divider" />
                  {route.page === "detail" || route.page === "result" ? (
                    <>
                      <button
                        className="breadcrumb-back"
                        onClick={() => navigate({ page: "home" })}
                      >
                        <ArrowLeft size={13} />
                        Tasks
                      </button>
                      <ChevronRight size={12} />
                      <span className="current-crumb">{currentTask.title}</span>
                    </>
                  ) : (
                    <span className="current-crumb">
                      {route.page === "setup"
                        ? "New comparison"
                        : route.page === "run"
                          ? "Live comparison"
                          : navItems.find((n) => n.id === route.page)?.label}
                    </span>
                  )}
                </div>
                <div className="location-right">
                  <button
                    className="prototype-label"
                    onClick={() => setAbout(true)}
                  >
                    <span />
                    Prototype 05
                  </button>
                  <button
                    className="quick-search"
                    onClick={() => setCommand(true)}
                    aria-label="Search tasks and actions"
                  >
                    <Search size={15} />
                    <span>Search</span>
                    <kbd>⌘ K</kbd>
                  </button>
                </div>
              </div>
              <main
                className="workspace-content"
                ref={contentRef}
                id="main-content"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={routePath(route)}
                    className="page-transition"
                    initial={{ opacity: 0, y: 7 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.18 }}
                  >
                    {route.page === "comparison" && (
                      <Suspense
                        fallback={
                          <div className="recorded-loading">
                            Opening comparison…
                          </div>
                        }
                      >
                        <RealComparisonView />
                      </Suspense>
                    )}
                    {route.page === "recorded" && (
                      <Suspense
                        fallback={
                          <div className="recorded-loading" role="status">
                            Opening recorded evidence…
                          </div>
                        }
                      >
                        <RecordedRunView />
                      </Suspense>
                    )}
                    {route.page === "home" && (
                      <Home
                        openTask={openTask}
                        newComparison={() => startSetup()}
                        openRecorded={() => navigate({ page: "recorded" })}
                        openRealComparison={() =>
                          navigate({ page: "comparison" })
                        }
                        repository={repository}
                        onClearRepository={() => setRepository("all")}
                      />
                    )}
                    {(route.page === "detail" ||
                      (route.page === "result" &&
                        run?.status === "complete")) && (
                      <Comparison
                        key={currentTask.id}
                        task={currentTask}
                        openEvidence={openEvidence}
                        openSetup={() => setSetup(true)}
                        saveCase={() =>
                          setSeed({ task: currentTask, prefill: true })
                        }
                        replay={() => startSetup(currentTask)}
                      />
                    )}
                    {route.page === "setup" && (
                      <RunSetup
                        draft={draft}
                        setDraft={setDraft}
                        onClose={() => navigate({ page: "home" })}
                        onStart={() => {
                          const task = tasks.find(
                            (t) => t.id === draft.taskId,
                          )!;
                          setRun(
                            createDemoRun(
                              draft,
                              task,
                              crypto.randomUUID(),
                              new Date().toISOString(),
                            ),
                          );
                          navigate({ page: "run" });
                        }}
                      />
                    )}
                    {route.page === "run" && run && (
                      <RunLive
                        run={run}
                        task={runTask}
                        onCancel={() =>
                          setRun((current) =>
                            current ? cancelDemoRun(current) : current,
                          )
                        }
                        onResume={() =>
                          setRun((current) =>
                            current ? resumeDemoRun(current) : current,
                          )
                        }
                        onInterrupt={() =>
                          setRun((current) =>
                            current ? interruptDemoRun(current) : current,
                          )
                        }
                        onSetup={() => {
                          setDraft({
                            ...run.config,
                            checkIds: [...run.config.checkIds],
                          });
                          navigate({ page: "setup" });
                        }}
                        onReview={() => navigate({ page: "result" })}
                      />
                    )}
                    {((route.page === "run" && !run) ||
                      (route.page === "result" &&
                        run?.status !== "complete")) && (
                      <div className="page">
                        <div className="empty-state">
                          <GitCompareArrows size={30} />
                          <h1>No completed comparison here yet.</h1>
                          <p>
                            Set up a sample case, or return to the current
                            demonstration.
                          </p>
                          <Button
                            variant="primary"
                            onClick={() =>
                              run ? navigate({ page: "run" }) : startSetup()
                            }
                          >
                            {run ? "Open current demo" : "New comparison"}
                            <ArrowRight size={15} />
                          </Button>
                        </div>
                      </div>
                    )}
                    {route.page === "saved" && (
                      <SavedCases
                        cases={cases}
                        openCase={setSavedDetail}
                        newCase={newCase}
                      />
                    )}
                    {route.page === "activity" && (
                      <ActivityView openTask={openTask} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </main>
            </section>
          </div>
          <footer className="statusbar">
            <button onClick={() => setAbout(true)}>
              <span className="status-light" />
              {["recorded", "comparison"].includes(route.page)
                ? "Recorded evidence"
                : "Demo workspace"}
              <span className="status-divider">·</span>
              {["recorded", "comparison"].includes(route.page)
                ? "Read-only connection"
                : "Sample data"}
            </button>
            <span className="statusbar-center">
              A clearer view of agent work
            </span>
            <button onClick={() => setCommand(true)}>
              <Command size={11} />K<span>Quick navigation</span>
            </button>
          </footer>
        </div>
        <EvidenceDrawer
          target={evidence}
          close={() => setEvidence(null)}
          notify={notify}
        />
        <SetupDialog
          task={currentTask}
          open={setup}
          close={() => setSetup(false)}
        />
        <SaveCaseDialog
          seed={seed}
          close={() => setSeed(null)}
          save={(item) => {
            setCases((previous) => [item, ...previous]);
            setSeed(null);
            notify(
              "Evaluation case saved",
              () => navigate({ page: "saved" }),
              "View cases",
            );
          }}
        />
        <CommandPalette
          open={command}
          close={() => setCommand(false)}
          navigate={(page) => navigate({ page })}
          openTask={openTask}
          newCase={newCase}
          newComparison={() => startSetup()}
          preferences={() => setPreferences(true)}
        />
        <Preferences
          open={preferences}
          close={() => setPreferences(false)}
          motionOn={motionOn}
          setMotionOn={setMotionOn}
          compact={compact}
          setCompact={setCompact}
          systemReduced={systemReduced}
        />
        <Modal
          open={!!savedDetail}
          onOpenChange={(v) => {
            if (!v) setSavedDetail(null);
          }}
          title={savedDetail?.name ?? "Saved case"}
          description="Your saved task and success conditions."
        >
          {savedDetail && (
            <>
              <div className="dialog-inner">
                <p>{savedDetail.objective}</p>
                <div className="saved-detail-checks">
                  <div className="eyebrow">SUCCESS CONDITIONS</div>
                  {tasks
                    .find((t) => t.id === savedDetail.sourceTaskId)!
                    .checks.filter((check) =>
                      savedDetail.checkIds.includes(check.id),
                    )
                    .map((check) => (
                      <p key={check.id}>
                        <Check size={14} />
                        {check.name}
                      </p>
                    ))}
                </div>
                <p className="quiet-note">
                  {savedDetail.savedAt === "Example case"
                    ? "This is a built-in example."
                    : "Saved locally on this device."}{" "}
                  The comparison below uses the source example’s full check
                  bundle.
                </p>
              </div>
              <div className="dialog-footer saved-detail-footer">
                {savedDetail.savedAt !== "Example case" && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const item = savedDetail;
                      setCases((previous) =>
                        previous.filter((c) => c.id !== item.id),
                      );
                      setSavedDetail(null);
                      notify(
                        "Case removed",
                        () => setCases((previous) => [item, ...previous]),
                        "Undo",
                      );
                    }}
                  >
                    Remove case
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => {
                    openTask(savedDetail.sourceTaskId);
                    setSavedDetail(null);
                  }}
                >
                  Open source comparison
                  <ArrowRight size={14} />
                </Button>
              </div>
            </>
          )}
        </Modal>
        <AboutDialog open={about} close={() => setAbout(false)} />
        <div className="toast-region" aria-live="polite" aria-atomic="true">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                className="toast"
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <span className="toast-check">
                  <Check size={14} />
                </span>
                <span>{toast.message}</span>
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action?.();
                      setToast(null);
                    }}
                  >
                    {toast.label}
                    <ArrowRight size={13} />
                  </button>
                )}
                <button
                  className="toast-close"
                  aria-label="Dismiss notification"
                  onClick={() => setToast(null)}
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Tooltip.Provider>
    </MotionConfig>
  );
}
