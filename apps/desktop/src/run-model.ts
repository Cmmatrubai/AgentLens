import type { Task } from "./data";

export type RunConfig = {
  taskId: string;
  checkIds: string[];
  baseline: "a" | "b";
  candidate: "a" | "b";
  timeoutMinutes: number;
};
export type DemoRun = {
  version: 1;
  id: string;
  createdAt: string;
  config: RunConfig;
  status: "running" | "interrupted" | "cancelled" | "complete";
  tick: number;
  reason?: "reload" | "connection";
};
export const TOTAL_TICKS = 18;
export const modelName = (id: "a" | "b") => "Model " + id.toUpperCase();
export const defaultRunConfig = (task: Task): RunConfig => ({
  taskId: task.id,
  checkIds: task.checks.map((c) => c.id),
  baseline: "a",
  candidate: "b",
  timeoutMinutes: 10,
});

export function validateRunConfig(config: RunConfig, task: Task): string[] {
  const errors: string[] = [];
  if (config.taskId !== task.id)
    errors.push("Choose an available sample case.");
  if (
    !["a", "b"].includes(config.baseline) ||
    !["a", "b"].includes(config.candidate) ||
    config.baseline === config.candidate
  )
    errors.push("Choose two different models.");
  if (
    !Array.isArray(config.checkIds) ||
    !config.checkIds.length ||
    new Set(config.checkIds).size !== config.checkIds.length ||
    config.checkIds.some((id) => !task.checks.some((c) => c.id === id))
  )
    errors.push("Select at least one success condition from this case.");
  if (![10, 15, 30].includes(config.timeoutMinutes))
    errors.push("Choose an available attempt timeout.");
  return errors;
}
export function createDemoRun(
  config: RunConfig,
  task: Task,
  id: string,
  createdAt: string,
): DemoRun {
  const errors = validateRunConfig(config, task);
  if (errors.length) throw new Error(errors.join(" "));
  return {
    version: 1,
    id,
    createdAt,
    config: { ...config, checkIds: [...config.checkIds] },
    status: "running",
    tick: 0,
  };
}
export function advanceDemoRun(run: DemoRun): DemoRun {
  if (run.status !== "running") return run;
  const tick = Math.min(TOTAL_TICKS, run.tick + 1);
  return {
    ...run,
    tick,
    status: tick === TOTAL_TICKS ? "complete" : "running",
  };
}
export function cancelDemoRun(run: DemoRun): DemoRun {
  return run.status === "running" || run.status === "interrupted"
    ? { ...run, status: "cancelled" }
    : run;
}
export function interruptDemoRun(run: DemoRun): DemoRun {
  return run.status === "running"
    ? { ...run, status: "interrupted", reason: "connection" }
    : run;
}
export function resumeDemoRun(run: DemoRun): DemoRun {
  return run.status === "interrupted"
    ? { ...run, status: "running", reason: undefined }
    : run;
}
export function restoreDemoRun(
  input: unknown,
  fixtures: Task[],
): DemoRun | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Partial<DemoRun>;
  if (
    r.version !== 1 ||
    typeof r.id !== "string" ||
    r.id.length > 100 ||
    typeof r.createdAt !== "string" ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    !r.config ||
    typeof r.config !== "object" ||
    !Number.isInteger(r.tick) ||
    r.tick! < 0 ||
    r.tick! > TOTAL_TICKS ||
    !["running", "interrupted", "cancelled", "complete"].includes(
      r.status ?? "",
    )
  )
    return null;
  const task = fixtures.find((t) => t.id === r.config?.taskId);
  if (
    !task ||
    validateRunConfig(r.config, task).length ||
    (r.status === "complete") !== (r.tick === TOTAL_TICKS)
  )
    return null;
  const config: RunConfig = {
    taskId: r.config.taskId,
    checkIds: [...r.config.checkIds],
    baseline: r.config.baseline,
    candidate: r.config.candidate,
    timeoutMinutes: r.config.timeoutMinutes,
  };
  return {
    version: 1,
    id: r.id,
    createdAt: r.createdAt,
    config,
    tick: r.tick!,
    status: r.status === "running" ? "interrupted" : r.status!,
    reason:
      r.status === "running"
        ? "reload"
        : r.reason === "reload" || r.reason === "connection"
          ? r.reason
          : undefined,
  };
}
export function comparisonFromRun(run: DemoRun, task: Task): Task {
  if (run.status !== "complete" || run.tick !== TOTAL_TICKS)
    throw new Error("This comparison has not finished.");
  const errors = validateRunConfig(run.config, task);
  if (errors.length) throw new Error(errors.join(" "));
  const { baseline, candidate, checkIds } = run.config;
  const checks = task.checks
    .filter((c) => checkIds.includes(c.id))
    .map((c) => ({
      ...c,
      a: c[baseline],
      b: c[candidate],
      outputA: baseline === "a" ? c.outputA : c.outputB,
      outputB: candidate === "a" ? c.outputA : c.outputB,
    }));
  const a = checks.filter((c) => c.a === "pass").length,
    b = checks.filter((c) => c.b === "pass").length;
  const missing = checks.some((c) => c.a === "unknown" || c.b === "unknown");
  const difference = checks.find((c) => c.a !== c.b);
  const status = missing ? "incomplete" : difference ? "difference" : "same";
  const models = { a: modelName(baseline), b: modelName(candidate) };
  return {
    ...task,
    checks,
    models,
    attemptTimeoutMinutes: run.config.timeoutMinutes,
    status,
    headline: missing
      ? "Missing evidence keeps the result open."
      : !difference
        ? "Both attempts reached the same result."
        : `${a > b ? models.a : models.b} met more of the selected conditions.`,
    takeaway: `${models.a} passed ${a} of ${checks.length} selected checks. ${models.b} passed ${b} of ${checks.length}.${missing ? " A missing result stays unknown." : ""}`,
    difference: missing
      ? "A selected check has no captured result"
      : difference
        ? difference.name
        : "No difference in the selected check results",
    timeA: baseline === "a" ? task.timeA : task.timeB,
    timeB: candidate === "a" ? task.timeA : task.timeB,
    secondsA: baseline === "a" ? task.secondsA : task.secondsB,
    secondsB: candidate === "a" ? task.secondsA : task.secondsB,
  };
}
export function attemptProgress(run: DemoRun, role: "baseline" | "candidate") {
  const start = role === "baseline" ? 2 : 9;
  const step = Math.max(0, Math.min(6, run.tick - start));
  return {
    step,
    done: step === 6,
    started: run.tick >= start,
    active: run.status === "running" && run.tick >= start && step < 6,
  };
}
export function runHeading(run: DemoRun) {
  if (run.status === "complete") return "The comparison is ready.";
  if (run.status === "cancelled") return "Stopped. Your progress is kept.";
  if (run.status === "interrupted") return "Let’s pick up where you left off.";
  if (run.tick < 2) return "Setting up a fair comparison.";
  if (run.tick < 9)
    return `${modelName(run.config.baseline)} is working on the task.`;
  if (run.tick < 16)
    return `${modelName(run.config.candidate)} is taking its turn.`;
  return "Bringing the evidence together.";
}
