import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, realpath } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { privateRead, privateWrite } from "../insights/private-files.mjs";
import { createCheckService } from "./check-service.mjs";
import {
  inspectDependencies,
  prepareDependencies,
  dependencyTools,
} from "./dependencies.mjs";

const exec = promisify(execFile);
const terminal = new Set([
  "completed",
  "failed",
  "stopped",
  "timed_out",
  "interrupted",
]);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const copy = (value) => structuredClone(value);
const clean = (value) =>
  typeof value === "string"
    ? value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, 4000)
    : "";
const boundedText = (value, limit = 4000) =>
  typeof value === "string" && value.length <= limit;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const optionalTime = (value) =>
  value === undefined || (Number.isFinite(value) && value >= 0);
function validPreparation(p) {
  return (
    p === undefined ||
    (p &&
      typeof p === "object" &&
      [
        "running",
        "completed",
        "failed",
        "cancelled",
        "timed_out",
        "unavailable",
        "interrupted",
      ].includes(p.state) &&
      Number.isFinite(p.startedAt) &&
      optionalTime(p.endedAt) &&
      optionalTime(p.durationMs) &&
      boundedText(p.output, 24000) &&
      (!p.outputSha256 ||
        (typeof p.outputSha256 === "string" &&
          p.outputSha256 === sha(p.output))) &&
      ["command", "nodeVersion", "pnpmVersion", "error"].every(
        (k) => p[k] === undefined || boundedText(p[k]),
      ))
  );
}
function validSavedDetails(job) {
  return (
    (job.dependencyPlan === undefined ||
      (job.dependencyPlan?.status === "supported" &&
        job.dependencyPlan.manager === "pnpm" &&
        typeof job.dependencyPlan.fingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(job.dependencyPlan.fingerprint) &&
        (job.dependencyPlan.requestedVersion === null ||
          (typeof job.dependencyPlan.requestedVersion === "string" &&
            /^11\.\d+\.\d+$/.test(job.dependencyPlan.requestedVersion))) &&
        count(job.dependencyPlan.inputCount) &&
        job.dependencyPlan.inputCount <= 1000)) &&
    (job.dependencyTools === undefined ||
      (job.dependencyTools &&
        boundedText(job.dependencyTools.nodeVersion, 80) &&
        boundedText(job.dependencyTools.pnpmVersion, 80))) &&
    boundedText(job.task, 20000) &&
    boundedText(job.project.name) &&
    Number.isFinite(job.timeoutMs) &&
    job.timeoutMs >= 60000 &&
    job.timeoutMs <= 3600000 &&
    optionalTime(job.endedAt) &&
    optionalTime(job.cleanupAcknowledgedAt) &&
    ["persistenceError", "cleanupUnconfirmed"].every(
      (key) => job[key] === undefined || typeof job[key] === "boolean",
    ) &&
    job.attempts.every(
      (a) =>
        boundedText(a.model, 120) &&
        ["low", "medium", "high", "xhigh"].includes(a.effort) &&
        count(a.eventCount) &&
        count(a.omittedEvents) &&
        optionalTime(a.startedAt) &&
        optionalTime(a.endedAt) &&
        optionalTime(a.lastActivityAt) &&
        validPreparation(a.preparation) &&
        (a.stopReason === undefined ||
          ["stopped", "timed_out", "failed"].includes(a.stopReason)) &&
        ["runId", "recordedStatus", "error", "recordingPath"].every(
          (key) => a[key] === undefined || boundedText(a[key]),
        ) &&
        a.events.length <= 80 &&
        a.events.length <= a.eventCount &&
        a.events.every(
          (e) =>
            [
              "id",
              "kind",
              "status",
              "summary",
              "command",
              "output",
              "message",
            ].every((key) => boundedText(e[key])) &&
            Number.isFinite(e.receivedAt) &&
            e.receivedAt >= 0 &&
            typeof e.truncated === "boolean" &&
            Array.isArray(e.files) &&
            e.files.length <= 30 &&
            e.files.every((path) => boundedText(path)),
        ),
    )
  );
}
const git = async (cwd, args) =>
  (
    await exec("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout.trim();

export async function inspectProject(path) {
  if (typeof path !== "string" || !path || path.length > 4000)
    throw Error("invalid_project");
  let root, commit;
  try {
    root = await realpath(await git(path, ["rev-parse", "--show-toplevel"]));
    commit = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch {
    throw Error("invalid_git_project");
  }
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw Error("invalid_git_project");
  const dirty = !!(await git(root, [
    "status",
    "--porcelain",
    "--untracked-files=normal",
  ]));
  const modules = await git(root, ["ls-files", "--stage"]);
  return {
    path: root,
    name: basename(root),
    commit,
    dirty,
    submodules: /^160000 /m.test(modules),
  };
}

function validate(input) {
  if (
    !input ||
    typeof input.projectId !== "string" ||
    typeof input.baseCommit !== "string" ||
    input.acknowledged !== true
  )
    throw Error("invalid_launch");
  if (
    typeof input.task !== "string" ||
    !input.task.trim() ||
    input.task.length > 20000 ||
    input.task.includes("\0")
  )
    throw Error("invalid_task");
  if (
    !Number.isInteger(input.timeoutMinutes) ||
    input.timeoutMinutes < 1 ||
    input.timeoutMinutes > 60
  )
    throw Error("invalid_timeout");
  if (
    !Array.isArray(input.models) ||
    input.models.length !== 2 ||
    input.models.some(
      (m) =>
        !m ||
        typeof m.model !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(m.model) ||
        !["low", "medium", "high", "xhigh"].includes(m.effort),
    )
  )
    throw Error("invalid_models");
  if (
    input.models[0].model === input.models[1].model &&
    input.models[0].effort === input.models[1].effort
  )
    throw Error("invalid_identical_models");
}

export function createLiveController({
  root,
  launchAttempt,
  preflight,
  write = privateWrite,
  prepareProject = prepareDependencies,
  inspectTools = dependencyTools,
}) {
  const projects = new Map(),
    jobs = new Map(),
    handles = new Map();
  let initialized,
    starting = false,
    startupDone,
    active = null,
    task = null,
    selected = null,
    closing = false;
  const recoveryWarnings = [];
  let writes = Promise.resolve();
  const directory = (id) => join(root, id);
  const storageFailed = (job) => {
    job.persistenceError = true;
    for (const a of job.attempts)
      if (!terminal.has(a.state)) {
        a.stopReason ??= "failed";
        a.error = "workspace_storage_failed";
        a.state = "stopping";
        handles.get(a.key)?.abort();
      }
  };
  const persist = (job) => {
    const snapshot = copy(job);
    const pending = writes
      .then(() => write(directory(job.id), "job.json", snapshot))
      .catch((error) => {
        storageFailed(job);
        throw Object.assign(Error("workspace_storage_failed"), {
          cause: error,
          cleanupConfirmed: true,
        });
      });
    writes = pending.catch(() => {});
    return pending;
  };
  const init = () =>
    (initialized ??= (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      // Codex rejects writable roots containing symlink components.
      root = await realpath(root);
      for (const id of await readdir(root)) {
        if (!/^[a-f0-9-]{36}$/.test(id)) continue;
        let job;
        try {
          job = await privateRead(directory(id), "job.json");
        } catch {
          recoveryWarnings.push(id);
          continue;
        }
        if (
          !job ||
          job.id !== id ||
          job.schemaVersion !== 1 ||
          typeof job.task !== "string" ||
          !Number.isFinite(job.startedAt) ||
          typeof job.project?.path !== "string" ||
          !/^[a-f0-9]{40,64}$/.test(job.baseCommit) ||
          ![
            "preparing",
            "running",
            "finished",
            "failed",
            "interrupted",
          ].includes(job.state) ||
          !Array.isArray(job.attempts) ||
          job.attempts.length !== 2 ||
          job.attempts.some(
            (a, i) =>
              !a ||
              a.key !== (i === 0 ? "a" : "b") ||
              typeof a.model !== "string" ||
              !Array.isArray(a.events) ||
              a.events.some((e) => !e || typeof e.id !== "string") ||
              typeof a.workspace !== "string" ||
              !["preparing", "running", "stopping", ...terminal].includes(
                a.state,
              ),
          ) ||
          !validSavedDetails(job)
        ) {
          recoveryWarnings.push(id);
          continue;
        }
        if (job.state === "running" || job.state === "preparing") {
          job.state = "interrupted";
          job.endedAt = Date.now();
          for (const a of job.attempts)
            if (!terminal.has(a.state)) {
              // The worker saves this projection only after the recorder has
              // finalized. A journal can lag behind that durable result.
              let recorded;
              try {
                recorded = await privateRead(
                  join(directory(id), a.key),
                  "run.json",
                );
              } catch {
                // Missing or damaged results cannot establish process cleanup.
              }
              if (
                recorded &&
                typeof recorded.id === "string" &&
                (!a.runId || recorded.id === a.runId) &&
                recorded.git?.initialHead === job.baseCommit &&
                ["completed", "failed", "interrupted"].includes(recorded.status)
              ) {
                a.runId = recorded.id;
                a.recordedStatus = recorded.status;
                a.state = a.stopReason ?? recorded.status;
                a.endedAt = job.endedAt;
                if (a.state === "failed") a.error ??= "agent_failed";
                continue;
              }
              if (a.state === "running" || a.state === "stopping")
                job.cleanupUnconfirmed = true;
              if (a.preparation?.state === "running") {
                job.cleanupUnconfirmed = true;
                a.preparation.state = "interrupted";
                a.preparation.endedAt = job.endedAt;
              }
              a.state = "interrupted";
              a.endedAt = job.endedAt;
              a.error = "app_interrupted";
            }
          if (job.attempts.every((a) => a.state !== "interrupted"))
            job.state = "finished";
          await persist(job);
        }
        jobs.set(id, job);
      }
      selected =
        [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt)[0]?.id ??
        null;
    })());
  const requireJob = (id) => {
    if (typeof id !== "string" || !jobs.has(id)) throw Error("invalid_job");
    return jobs.get(id);
  };
  const checks = createCheckService({
    getRoot: async () => {
      await init();
      return root;
    },
    getContext: async (id, { prepare = false } = {}) => {
      await init();
      const job = requireJob(id);
      if (
        !job.attempts.every((a) => a.state === "completed") ||
        job.persistenceError ||
        job.cleanupUnconfirmed
      )
        throw Error("comparison_incomplete");
      const attempts = [];
      for (const a of job.attempts) {
        const expected = join(directory(id), "worktrees", a.key);
        if (prepare) {
          try {
            if (
              a.workspace !== expected ||
              (await realpath(a.workspace)) !== expected
            )
              throw Error("invalid");
          } catch {
            throw Error("check_workspace_unavailable");
          }
        }
        const run = await privateRead(join(directory(id), a.key), "run.json");
        if (
          !run ||
          run.id !== a.runId ||
          run.git?.initialHead !== job.baseCommit ||
          run.status !== "completed"
        )
          throw Error("recording_invalid");
        attempts.push({ key: a.key, runId: a.runId, workspace: expected });
      }
      return { baseCommit: job.baseCommit, attempts };
    },
  });

  async function runSide(job, a) {
    let timer;
    let enteredRunner = false;
    let runnerSettled = false;
    const stop = new AbortController();
    handles.set(a.key, stop);
    try {
      if (a.stopReason) {
        a.state = a.stopReason;
        return;
      }
      a.state = "running";
      a.startedAt = Date.now();
      await persist(job);
      timer = setTimeout(() => {
        a.stopReason ??= "timed_out";
        a.state = "stopping";
        stop.abort();
      }, job.timeoutMs);
      stop.signal.addEventListener("abort", () => clearTimeout(timer), {
        once: true,
      });
      if (a.stopReason) stop.abort();
      const runner =
        launchAttempt ?? (await import("./transport.mjs")).launchAttempt;
      if (stop.signal.aborted) throw Error("attempt_cancelled");
      enteredRunner = true;
      const run = await runner({
        key: a.key,
        workspace: a.workspace,
        root: join(directory(job.id), a.key),
        baseCommit: job.baseCommit,
        task: job.task,
        model: a.model,
        effort: a.effort,
        signal: stop.signal,
        async onEvent(event) {
          if (terminal.has(a.state)) return;
          if (!event?.id || a.events.some((e) => e.id === event.id)) return;
          a.eventCount++;
          a.lastActivityAt = Date.now();
          // Only redacted, persisted observations arrive here. Keep IPC/UI bounded.
          const visible = {
            id: clean(event.id),
            kind: clean(event.kind),
            status: clean(event.status),
            summary: clean(event.summary),
            command: clean(event.command),
            output: clean(event.output),
            message: clean(event.message),
            files: Array.isArray(event.files)
              ? event.files.slice(0, 30).map(clean)
              : [],
            truncated:
              !!event.truncated ||
              (Array.isArray(event.files) &&
                (event.files.length > 30 ||
                  event.files.some(
                    (v) => typeof v === "string" && v.length > 4000,
                  ))) ||
              [event.output, event.message, event.command].some(
                (v) => typeof v === "string" && v.length > 4000,
              ),
            receivedAt: a.lastActivityAt,
          };
          if (visible.id && !a.events.some((e) => e.id === visible.id)) {
            a.events.push(visible);
            if (a.events.length > 80) {
              a.events.shift();
              a.omittedEvents++;
            }
          }
          await persist(job);
        },
        async onRunId(id) {
          a.runId = id;
          await persist(job);
        },
      });
      runnerSettled = true;
      if (
        !run ||
        typeof run.id !== "string" ||
        run.git?.initialHead !== job.baseCommit
      )
        throw Error("recording_invalid");
      try {
        await write(join(directory(job.id), a.key), "run.json", run);
      } catch (error) {
        storageFailed(job);
        throw error;
      }
      a.runId = run.id;
      a.recordedStatus = run.status;
      a.state =
        a.stopReason ?? (run.status === "completed" ? "completed" : "failed");
      if (a.state === "failed") a.error ??= "agent_failed";
    } catch (error) {
      stop.abort();
      const unconfirmed =
        enteredRunner && !runnerSettled && error?.cleanupConfirmed !== true;
      if (unconfirmed) job.cleanupUnconfirmed = true;
      a.state = !enteredRunner && a.stopReason ? a.stopReason : "failed";
      // Raw subprocess/provider errors can contain credentials or prompt text.
      a.error ??= unconfirmed
        ? "cleanup_unconfirmed"
        : error?.message === "recording_invalid"
          ? "recording_invalid"
          : "recording_failed";
    } finally {
      clearTimeout(timer);
      handles.delete(a.key);
      a.endedAt = Date.now();
      try {
        await persist(job);
      } catch {
        job.persistenceError = true;
      }
    }
  }

  async function run(job) {
    const preparationStop = new AbortController();
    for (const a of job.attempts) handles.set(a.key, preparationStop);
    try {
      // Prepare both before either agent starts. Retain worktrees on every exit.
      for (const a of job.attempts) {
        await git(job.project.path, [
          "worktree",
          "add",
          "--detach",
          a.workspace,
          job.baseCommit,
        ]);
        if ((await git(a.workspace, ["rev-parse", "HEAD"])) !== job.baseCommit)
          throw Error("worktree_mismatch");
      }
      if (job.dependencyPlan) {
        for (const a of job.attempts) {
          if (
            preparationStop.signal.aborted ||
            job.attempts.some((a) => a.stopReason)
          )
            throw Error("dependency_cancelled");
          a.preparation = {
            state: "running",
            startedAt: Date.now(),
            output: "",
            ...job.dependencyTools,
          };
          await persist(job);
          let result;
          try {
            result = await prepareProject({
              workspace: a.workspace,
              root: join(directory(job.id), "preparation", a.key),
              plan: job.dependencyPlan,
              tools: job.dependencyTools,
              signal: preparationStop.signal,
            });
          } catch (error) {
            a.preparation.state = preparationStop.signal.aborted
              ? "cancelled"
              : "failed";
            a.preparation.error = [
              "dependency_inputs_changed",
              "dependency_version_mismatch",
              "dependency_tools_unavailable",
              "dependency_platform_unavailable",
            ].includes(error.message)
              ? error.message
              : "dependency_install_failed";
            a.preparation.endedAt = Date.now();
            throw error;
          }
          a.preparation = { ...a.preparation, ...result, endedAt: Date.now() };
          if (result.cleanupConfirmed !== true) job.cleanupUnconfirmed = true;
          await persist(job);
          if (
            result.state !== "completed" ||
            result.exitCode !== 0 ||
            result.cleanupConfirmed !== true
          )
            throw Error("dependency_install_failed");
        }
      }
      for (const a of job.attempts) handles.delete(a.key);
      if (
        job.dependencyPlan &&
        (preparationStop.signal.aborted ||
          job.attempts.some((a) => a.stopReason))
      )
        throw Error("dependency_cancelled");
      job.state = "running";
      await persist(job);
      await Promise.all(job.attempts.map((a) => runSide(job, a)));
      job.state = "finished";
    } catch (error) {
      preparationStop.abort();
      job.state = "failed";
      job.error = job.dependencyPlan
        ? job.attempts.some((a) => a.stopReason)
          ? "dependency_cancelled"
          : "dependency_install_failed"
        : "workspace_setup_failed";
      for (const a of job.attempts)
        if (!terminal.has(a.state)) {
          a.state = a.stopReason ?? "failed";
          a.error = job.error;
        }
    } finally {
      for (const a of job.attempts) handles.delete(a.key);
      job.endedAt = Date.now();
      try {
        await persist(job);
      } catch {
        job.persistenceError = true;
      }
      active = null;
    }
  }

  return {
    readChecks: (id) => checks.read(id),
    startChecks: (id, input) => checks.start(id, input),
    stopChecks: (id) => checks.stop(id),
    acknowledgeChecks: (id, confirmed) => checks.acknowledge(id, confirmed),
    async chooseProject(path) {
      await init();
      const inspected = await inspectProject(path);
      const project = {
        ...inspected,
        dependencies: await inspectDependencies(inspected.path),
        id: randomUUID(),
      };
      projects.set(project.id, project);
      return copy(project);
    },
    async prerequisites() {
      return preflight
        ? preflight()
        : (await import("./transport.mjs")).preflight();
    },
    async start(input) {
      if (starting || active || closing) throw Error("comparison_busy");
      starting = true;
      let finishStartup;
      startupDone = new Promise((resolve) => {
        finishStartup = resolve;
      });
      try {
        await init();
        if (
          [...jobs.values()].some(
            (job) => job.cleanupUnconfirmed && !job.cleanupAcknowledgedAt,
          )
        )
          throw Error("cleanup_unconfirmed");
        validate(input);
        const chosen = projects.get(input.projectId);
        if (!chosen) throw Error("invalid_project_selection");
        const project = await inspectProject(chosen.path);
        if (project.dirty) throw Error("project_dirty");
        if (project.submodules) throw Error("project_submodules");
        if (
          project.commit !== input.baseCommit ||
          project.commit !== chosen.commit
        )
          throw Error("project_changed");
        if (
          input.prepareDependencies !== undefined &&
          typeof input.prepareDependencies !== "boolean"
        )
          throw Error("invalid_launch");
        let dependencyPlan, tools;
        if (input.prepareDependencies) {
          dependencyPlan = await inspectDependencies(project.path);
          if (dependencyPlan.status !== "supported")
            throw Error("dependency_setup_unsupported");
          if (dependencyPlan.fingerprint !== chosen.dependencies?.fingerprint)
            throw Error("dependency_inputs_changed");
          tools = await inspectTools(dependencyPlan);
        }
        await this.prerequisites();
        if (closing) throw Error("comparison_closing");
        const id = randomUUID();
        const job = {
          schemaVersion: 1,
          id,
          state: "preparing",
          task: input.task.trim(),
          project,
          baseCommit: project.commit,
          startedAt: Date.now(),
          timeoutMs: input.timeoutMinutes * 60000,
          ...(dependencyPlan ? { dependencyPlan, dependencyTools: tools } : {}),
          attempts: input.models.map((m, i) => ({
            key: i === 0 ? "a" : "b",
            model: m.model,
            effort: m.effort,
            state: "preparing",
            workspace: join(directory(id), "worktrees", i === 0 ? "a" : "b"),
            recordingPath: join(
              directory(id),
              i === 0 ? "a" : "b",
              "recording",
            ),
            events: [],
            eventCount: 0,
            omittedEvents: 0,
          })),
        };
        await persist(job);
        if (closing) {
          job.state = "interrupted";
          job.endedAt = Date.now();
          for (const a of job.attempts) {
            a.state = "interrupted";
            a.error = "app_interrupted";
          }
          await persist(job);
          jobs.set(id, job);
          selected = id;
          throw Error("comparison_closing");
        }
        jobs.set(id, job);
        active = id;
        selected = id;
        task = run(job);
        return copy(job);
      } finally {
        starting = false;
        finishStartup();
      }
    },
    async read(id) {
      await init();
      const job = id ? requireJob(id) : jobs.get(selected);
      return {
        job: job ? copy(job) : null,
        activeId: active,
        recoveryWarnings: [...recoveryWarnings],
        unresolvedCleanup: [...jobs.values()]
          .filter((j) => j.cleanupUnconfirmed && !j.cleanupAcknowledgedAt)
          .map((j) => ({ id: j.id, title: j.task.slice(0, 90) })),
        recent: [...jobs.values()]
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, 20)
          .map((j) => ({
            id: j.id,
            title: j.task.slice(0, 90),
            state: j.state,
            startedAt: j.startedAt,
          })),
      };
    },
    async stop(id, key) {
      await init();
      const job = requireJob(id);
      if (id !== active || !["a", "b", "all"].includes(key))
        throw Error("invalid_stop");
      for (const a of job.attempts)
        if ((key === "all" || a.key === key) && !terminal.has(a.state)) {
          a.stopReason ??= "stopped";
          a.state = "stopping";
          handles.get(a.key)?.abort();
        }
      try {
        await persist(job);
      } catch {
        job.persistenceError = true;
      }
      return this.read(id);
    },
    async comparison(id) {
      await init();
      const job = requireJob(id);
      if (
        !job.attempts.every((a) => a.state === "completed") ||
        job.persistenceError
      )
        throw Error("comparison_incomplete");
      const attempts = [];
      for (const a of job.attempts) {
        const run = await privateRead(join(directory(id), a.key), "run.json");
        if (
          !run ||
          run.id !== a.runId ||
          run.status !== "completed" ||
          run.git?.initialHead !== job.baseCommit
        )
          throw Error("recording_invalid");
        attempts.push({
          key: a.key,
          model: a.model,
          reasoningEffort: a.effort,
          state: "recorded",
          run,
          elapsedMs: run.elapsedMs,
          checks: [],
          passed: 0,
          failed: 0,
          unknown: 0,
          snapshotHash: null,
          evaluatedAt: null,
          eventCount: run.eventCount,
          controlNotes: [
            "Recorded by AgentLens in separate worktrees at the same committed revision.",
            "Same task, sandbox, and deadline; model and reasoning settings may differ.",
            a.preparation?.state === "completed"
              ? `Dependencies installed before recording with Node ${a.preparation.nodeVersion}, pnpm ${a.preparation.pnpmVersion}; frozen lockfile, install scripts disabled. Setup duration: ${a.preparation.durationMs} ms. Dependency input fingerprint: ${job.dependencyPlan.fingerprint}.`
              : "Dependency installation was not performed by AgentLens before this recording.",
          ],
          coverageLimits: [
            "No independent evaluator was run. Agent-reported success and command exit codes do not prove correctness.",
          ],
        });
      }
      const comparison = {
        schemaVersion: 1,
        id,
        title: job.task.slice(0, 160),
        taskPrompt: job.task,
        manifestHash: sha(
          JSON.stringify({
            id,
            task: job.task,
            baseCommit: job.baseCommit,
            models: job.attempts.map((a) => [a.model, a.effort]),
          }),
        ),
        baseCommit: job.baseCommit,
        timeoutMs: job.timeoutMs,
        promptHash: sha(job.task),
        attempts,
        ready: false,
        checks: [],
        startupFailures: [],
        fetchedAt: Date.now(),
        review: { state: "unavailable", findings: [] },
      };
      return checks.project(id, comparison);
    },
    async acknowledgeCleanup(id, acknowledged) {
      await init();
      const job = requireJob(id);
      if (
        acknowledged !== true ||
        !job.cleanupUnconfirmed ||
        id === active ||
        job.attempts.some((a) => !terminal.has(a.state))
      )
        throw Error("invalid_cleanup_acknowledgement");
      const acknowledgedJob = { ...job, cleanupAcknowledgedAt: Date.now() };
      // Keep the live gate closed until the acknowledgment is durable.
      await persist(acknowledgedJob);
      job.cleanupAcknowledgedAt = acknowledgedJob.cleanupAcknowledgedAt;
      // This is a user assertion, not recorder proof. Preserve failed states and
      // cleanupUnconfirmed so future analysis cannot promote the earlier result.
      if (!active && !starting) closing = false;
      return this.read(id);
    },
    async shutdown() {
      closing = true;
      let checkShutdownError;
      try {
        await checks.shutdown();
      } catch (error) {
        checkShutdownError = error;
      }
      await startupDone;
      if (active) await this.stop(active, "all");
      await task;
      await writes;
      if (checkShutdownError) throw checkShutdownError;
      if (
        [...jobs.values()].some(
          (job) => job.cleanupUnconfirmed && !job.cleanupAcknowledgedAt,
        )
      )
        throw Error("cleanup_unconfirmed");
    },
  };
}
