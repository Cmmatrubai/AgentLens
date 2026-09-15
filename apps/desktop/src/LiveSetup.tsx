import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, GitBranch, Check, Info } from "lucide-react";
import { Button } from "./ui";
import { ModelPicker } from "./ModelPicker";
import type { LiveModelCatalog, LiveProject, LiveSnapshot } from "./live-types";
import { liveError } from "./live-presentation";
import {
  LIVE_SETUP_EFFORTS,
  LIVE_SETUP_TIMEOUTS,
  clearLiveSetupDraft,
  defaultLiveSetupDraft,
  getLiveSetupDraftStorage,
  readLiveSetupDraft,
  startAndClearLiveSetupDraftOnSuccess,
  writeLiveSetupDraft,
  type LiveSetupDraft,
} from "./live-setup-draft";

export function LiveSetup({ onStarted }: { onStarted: (id: string) => void }) {
  const api = typeof window === "undefined" ? undefined : window.agentlens;
  const [project, setProject] = useState<LiveProject | null>(null);
  const [draftStorage] = useState(getLiveSetupDraftStorage);
  const [draft, setDraft] = useState(
    () => readLiveSetupDraft(draftStorage) ?? defaultLiveSetupDraft(),
  );
  const { task, models, timeoutMinutes: minutes } = draft;
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prerequisites, setPrerequisites] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<LiveModelCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setCatalogLoading(true);
    setCatalogUnavailable(false);
    async function load() {
      try {
        const result = await api?.liveModels?.();
        if (!result?.ok) throw Error("unavailable");
        if (current) setCatalog(result.catalog);
      } catch {
        if (current) {
          setCatalog(null);
          setCatalogUnavailable(true);
        }
      } finally {
        if (current) setCatalogLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [api, catalogRevision]);
  const [saved, setSaved] = useState<LiveSnapshot | null>(null);
  useEffect(() => {
    writeLiveSetupDraft(draftStorage, draft);
  }, [draft, draftStorage]);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      if (!api?.liveRead) return;
      try {
        const r = await api.liveRead();
        if (mounted && r.ok) setSaved(r);
      } catch {
        /* A later poll can recover without clearing the form. */
      }
      if (mounted) timer = setTimeout(() => void read(), 1500);
    }
    void read();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [api]);
  async function choose() {
    if (!api || busy) return;
    setBusy("project");
    setError(null);
    try {
      const r = await api.liveChooseProject();
      if (!r.ok) setError(r.error);
      else if (r.project) {
        setProject(r.project);
        setAcknowledged(false);
      }
    } catch {
      setError("live_operation_failed");
    } finally {
      setBusy(null);
    }
  }
  async function check() {
    if (!api || busy) return;
    setBusy("check");
    setError(null);
    setPrerequisites(null);
    try {
      const r = await api.livePrerequisites();
      if (r.ok) setPrerequisites(r.prerequisites.version);
      else setError(r.error);
    } catch {
      setError("live_operation_failed");
    } finally {
      setBusy(null);
    }
  }
  async function start() {
    if (!api || !project || busy) return;
    setBusy("start");
    setError(null);
    try {
      const r = await startAndClearLiveSetupDraftOnSuccess(
        () =>
          api.liveStart({
            projectId: project.id,
            baseCommit: project.commit,
            task,
            models,
            timeoutMinutes: minutes,
            acknowledged,
          }),
        draftStorage,
      );
      if (r.ok) {
        setDraft(defaultLiveSetupDraft());
        setAcknowledged(false);
        onStarted(r.job.id);
      } else setError(r.error);
    } catch {
      setError("live_operation_failed");
    } finally {
      setBusy(null);
    }
  }
  const valid =
    project &&
    !project.dirty &&
    !project.submodules &&
    task.trim() &&
    models.every(
      (m) =>
        m.model.trim() &&
        (
          catalog?.models.find((option) => option.id === m.model)?.efforts ??
          LIVE_SETUP_EFFORTS
        ).includes(m.effort),
    ) &&
    !(
      models[0].model === models[1].model &&
      models[0].effort === models[1].effort
    ) &&
    acknowledged;
  return (
    <div className="live-setup">
      {!!saved?.unresolvedCleanup?.length && (
        <div className="live-resume">
          <div>
            <strong>An interrupted workspace needs attention</strong>
            <span>
              Check that its agent processes have stopped before starting again.
            </span>
          </div>
          <Button
            small
            onClick={() => onStarted(saved.unresolvedCleanup![0].id)}
          >
            Review workspace <ArrowRight size={14} />
          </Button>
        </div>
      )}
      {saved?.job && (
        <div className="live-resume">
          <div>
            <strong>
              {saved.activeId
                ? "A comparison is recording"
                : "Your latest workspace"}
            </strong>
            <span>{saved.job.task.slice(0, 100)}</span>
          </div>
          <Button
            small
            onClick={() => onStarted(saved.activeId ?? saved.job!.id)}
          >
            Open workspace <ArrowRight size={14} />
          </Button>
        </div>
      )}
      {!api?.liveStart && (
        <p className="first-use-notice">
          <Info size={17} /> Live recording is available in the AgentLens
          desktop app. Explore the recorded example here without setup.
        </p>
      )}
      <div className="live-setup-form" aria-busy={!!busy}>
        <fieldset disabled={!!busy || !api?.liveStart}>
          <legend className="sr-only">Set up a recorded comparison</legend>
          <div className="live-field-heading">
            <span className="live-step">1</span>
            <h3>Choose your project</h3>
          </div>
          <button
            type="button"
            className="live-project-picker"
            onClick={() => void choose()}
          >
            <FolderOpen size={21} />
            <span>
              <strong>{project?.name ?? "Choose a Git project"}</strong>
              <small>
                {project?.path ?? "Both agents get separate working copies."}
              </small>
            </span>
            <span className="live-picker-action">
              {project ? "Change" : "Browse"}
            </span>
          </button>
          {project && (
            <p className="live-revision">
              <GitBranch size={13} /> {project.commit.slice(0, 8)} ·{" "}
              {project.dirty
                ? "Uncommitted changes"
                : "Committed starting point"}
            </p>
          )}
          {project?.dirty && (
            <p className="first-use-error">{liveError("project_dirty")}</p>
          )}
          {project?.submodules && (
            <p className="first-use-error">{liveError("project_submodules")}</p>
          )}
          <div className="live-field-heading">
            <span className="live-step">2</span>
            <label htmlFor="live-task">Give them the same task</label>
          </div>
          <textarea
            id="live-task"
            rows={4}
            maxLength={20000}
            value={task}
            onChange={(e) =>
              setDraft((current) => ({ ...current, task: e.target.value }))
            }
            placeholder="For example: fix the search bug, add tests for the edge cases, and explain your changes."
            aria-describedby="live-task-hint"
          />
          <p id="live-task-hint" className="live-field-hint">
            Both agents receive this exact task. Your draft stays here until you
            clear it, close the app, or reload.
          </p>
          <div className="live-field-heading">
            <span className="live-step">3</span>
            <h3>Choose two models</h3>
          </div>
          <div className="live-model-fields">
            {models.map((m, i) => (
              <div
                className={`live-model-field side-${i === 0 ? "a" : "b"}`}
                key={i}
              >
                <label htmlFor={`live-model-${i}`}>
                  Agent {i === 0 ? "A" : "B"}
                </label>
                <ModelPicker
                  id={`live-model-${i}`}
                  label={`Agent ${i === 0 ? "A" : "B"}`}
                  value={m.model}
                  options={catalog?.models ?? []}
                  loading={catalogLoading}
                  unavailable={catalogUnavailable}
                  disabled={!!busy || !api?.liveStart}
                  onRetry={() => setCatalogRevision((v) => v + 1)}
                  onChange={(option) => {
                    setDraft((current) => ({
                      ...current,
                      models: current.models.map((choice, index) =>
                        index === i
                          ? {
                              model: option.id,
                              effort: option.efforts.includes(choice.effort)
                                ? choice.effort
                                : option.efforts.includes("high")
                                  ? "high"
                                  : option.efforts[0],
                            }
                          : choice,
                      ) as LiveSetupDraft["models"],
                    }));
                    setAcknowledged(false);
                  }}
                />
                <label
                  className="live-effort-label"
                  htmlFor={`live-effort-${i}`}
                >
                  Reasoning effort
                </label>
                <select
                  id={`live-effort-${i}`}
                  value={m.effort}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      models: current.models.map((v, j) =>
                        j === i
                          ? {
                              ...v,
                              effort: e.target.value as typeof v.effort,
                            }
                          : v,
                      ) as LiveSetupDraft["models"],
                    }))
                  }
                >
                  {!(
                    (catalog?.models.find((option) => option.id === m.model)
                      ?.efforts ?? LIVE_SETUP_EFFORTS) as readonly string[]
                  ).includes(m.effort) && (
                    <option value={m.effort} disabled>
                      {m.effort} — choose a supported level
                    </option>
                  )}
                  {(
                    catalog?.models.find((option) => option.id === m.model)
                      ?.efforts ?? LIVE_SETUP_EFFORTS
                  ).map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="live-field-hint">
            {catalog
              ? `Models from your local Codex catalog${catalog.fetchedAt ? ` · updated ${new Date(catalog.fetchedAt).toLocaleDateString()}` : ""}. Access is checked when the run starts.`
              : "The model list comes from your local Codex catalog. Open a picker to reload it."}{" "}
            AI analysis is configured separately.
          </p>
          {models[0].model === models[1].model &&
            models[0].effort === models[1].effort && (
              <p className="live-field-hint" role="status">
                Choose a different model or reasoning level for the second agent
                to compare two approaches.
              </p>
            )}
          <details className="live-options">
            <summary>Run settings and what gets recorded</summary>
            <label htmlFor="live-deadline">
              Time limit per agent
              <select
                id="live-deadline"
                value={minutes}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    timeoutMinutes: Number(
                      e.target.value,
                    ) as LiveSetupDraft["timeoutMinutes"],
                  }))
                }
              >
                {LIVE_SETUP_TIMEOUTS.map((n) => (
                  <option key={n} value={n}>
                    {n} minutes
                  </option>
                ))}
              </select>
            </label>
            <p>
              AgentLens records redacted agent activity and final Git changes
              locally. Each agent runs in its own workspace-write sandbox.
              Uncommitted files and installed dependencies are not copied. No
              independent test suite is scheduled automatically.
            </p>
            <p>
              This development release needs Node and a signed-in Codex CLI.
              Existing user MCP settings are not loaded into these runs.
            </p>
          </details>
          <label className="live-launch-consent">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              Start two Codex runs using my account and record their output
              locally. Model usage applies.
            </span>
          </label>
        </fieldset>
        {error && (
          <p className="first-use-error" role="alert">
            {liveError(error)}
          </p>
        )}
        <div className="live-launch-actions">
          <Button
            variant="primary"
            disabled={!valid || !!busy || !api?.liveStart || !!saved?.activeId}
            onClick={() => void start()}
          >
            {busy === "start"
              ? "Preparing your workspace…"
              : "Start recorded comparison"}
            <ArrowRight size={16} />
          </Button>
          <Button
            variant="ghost"
            disabled={!!busy || !api?.liveStart}
            onClick={() => void check()}
          >
            {busy === "check" ? "Checking setup…" : "Check setup"}
          </Button>
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={() => {
              clearLiveSetupDraft(draftStorage);
              setDraft(defaultLiveSetupDraft());
              setAcknowledged(false);
              setError(null);
            }}
          >
            Clear draft
          </Button>
        </div>
        {prerequisites && (
          <p className="live-setup-ready" role="status">
            <Check size={14} /> Recorder and Codex are available. Model access
            is checked when each run starts.
          </p>
        )}
      </div>
      {!!saved?.recent.length && (
        <details className="live-options live-history">
          <summary>Recent workspaces</summary>
          {saved.recent.map((job) => (
            <button key={job.id} onClick={() => onStarted(job.id)}>
              <span>{job.title}</span>
              <small>
                {new Date(job.startedAt).toLocaleDateString()} · {job.state}
              </small>
              <ArrowRight size={14} />
            </button>
          ))}
        </details>
      )}
    </div>
  );
}
