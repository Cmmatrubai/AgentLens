import test from "node:test";
import assert from "node:assert/strict";
import { tasks } from "../src/data.ts";
import {
  advanceDemoRun,
  cancelDemoRun,
  comparisonFromRun,
  createDemoRun,
  interruptDemoRun,
  restoreDemoRun,
  resumeDemoRun,
  TOTAL_TICKS,
  validateRunConfig,
  type RunConfig,
} from "../src/run-model.ts";
const config = (): RunConfig => ({
  taskId: "session",
  checkIds: ["valid", "missing", "expired"],
  baseline: "a",
  candidate: "b",
  timeoutMinutes: 10,
});
const fresh = () =>
  createDemoRun(config(), tasks[0], "demo-test", "2026-09-06T20:00:00Z");
function finish(run = fresh()) {
  for (let i = 0; i < TOTAL_TICKS; i++) run = advanceDemoRun(run);
  return run;
}
test("freezes a run configuration against later draft changes", () => {
  const draft = config();
  const run = createDemoRun(draft, tasks[0], "test", "2026-09-06T20:00:00Z");
  draft.checkIds.pop();
  draft.baseline = "b";
  assert.deepEqual(run.config, config());
});
test("rejects identical models and missing or foreign success conditions", () => {
  assert.ok(
    validateRunConfig({ ...config(), candidate: "a" }, tasks[0]).length,
  );
  assert.ok(validateRunConfig({ ...config(), checkIds: [] }, tasks[0]).length);
  assert.ok(
    validateRunConfig({ ...config(), checkIds: ["not-a-check"] }, tasks[0])
      .length,
  );
});
test("cancelled work never turns into a completed comparison after late ticks", () => {
  const cancelled = cancelDemoRun(advanceDemoRun(fresh()));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(finish(cancelled).status, "cancelled");
  assert.throws(() => comparisonFromRun(cancelled, tasks[0]));
});
test("interruption preserves progress until explicitly resumed", () => {
  let run = fresh();
  for (let i = 0; i < 10; i++) run = advanceDemoRun(run);
  run = interruptDemoRun(run);
  assert.equal(run.status, "interrupted");
  assert.equal(advanceDemoRun(run).tick, 10);
  assert.equal(resumeDemoRun(run).tick, 10);
  assert.equal(finish(resumeDemoRun(run)).status, "complete");
});
test("reload turns active work into interrupted work without discarding its record", () => {
  const run = advanceDemoRun(fresh());
  const restored = restoreDemoRun(JSON.parse(JSON.stringify(run)), tasks);
  assert.equal(restored?.status, "interrupted");
  assert.equal(restored?.reason, "reload");
  assert.equal(restored?.tick, 1);
  assert.equal(restoreDemoRun({ version: 1, config: {} }, tasks), null);
  assert.equal(restoreDemoRun({ ...run, tick: -4 }, tasks), null);
});
test("completed comparisons follow selected models and selected checks", () => {
  const run = finish(
    createDemoRun(
      { ...config(), baseline: "b", candidate: "a", checkIds: ["expired"] },
      tasks[0],
      "swapped",
      "2026-09-06T20:00:00Z",
    ),
  );
  const result = comparisonFromRun(run, tasks[0]);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].a, "fail");
  assert.equal(result.checks[0].b, "pass");
  assert.equal(result.models?.a, "Model B");
  assert.equal(result.models?.b, "Model A");
  assert.equal(result.timeA, "4m 48s");
  assert.match(result.takeaway, /Model B passed 0 of 1/);
});
test("an excluded failure does not appear in the comparison headline", () => {
  const result = comparisonFromRun(
    finish(
      createDemoRun(
        { ...config(), checkIds: ["valid"] },
        tasks[0],
        "subset",
        "2026-09-06T20:00:00Z",
      ),
    ),
    tasks[0],
  );
  assert.equal(result.status, "same");
  assert.match(result.headline, /same result/);
  assert.doesNotMatch(result.takeaway, /expired/);
});
test("completed records stay complete after reload and cannot be cancelled", () => {
  const run = finish();
  assert.equal(run.status, "complete");
  assert.equal(cancelDemoRun(run).status, "complete");
  assert.equal(restoreDemoRun(run, tasks)?.status, "complete");
  assert.equal(restoreDemoRun({ ...run, tick: 2 }, tasks), null);
});
