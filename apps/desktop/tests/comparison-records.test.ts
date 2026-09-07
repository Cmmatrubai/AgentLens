import test from "node:test";
import assert from "node:assert/strict";
import { projectComparison } from "../server/comparison-projector.mjs";
const manifest = {
  id: "C01",
  manifestHash: "frozen",
  title: "Bound output",
  baseCommit: "base",
  timeoutMs: 900000,
  inputs: {
    "experiments/C01/prompt.md": "prompt",
    "experiments/C01/independent.test.ts": "checks",
  },
  checks: ["size", "types"],
  attempts: [
    { key: "sol", model: "gpt-5.6-sol", reasoningEffort: "high" },
    { key: "terra", model: "gpt-5.6-terra", reasoningEffort: "high" },
  ],
};
function attempt(key = "sol") {
  return {
    key,
    state: "recorded",
    launch: {
      manifestHash: "frozen",
      model: "gpt-5.6-" + key,
      reasoningEffort: "high",
    },
    result: { result: { runId: key, status: "completed" } },
    run: {
      id: key,
      status: "completed",
      elapsedMs: 1000,
      eventCount: 4,
      commandCount: 1,
      failedCommandCount: 0,
      events: [],
      git: { initialHead: "base", files: [] },
    },
    evaluation: {
      manifestHash: "frozen",
      runId: key,
      snapshotHash: "snapshot",
      endedAt: 2000,
      checks: [
        {
          id: "size",
          title: "Size",
          outcome: "pass",
          output: "verified",
          artifactSha256: "hash",
        },
        {
          id: "types",
          title: "Types",
          outcome: "pass",
          output: "checked",
          artifactSha256: "hash",
        },
      ],
    },
  };
}
test("completion without independent checks remains unknown", () => {
  const a = attempt();
  a.evaluation = null as any;
  const r = projectComparison(manifest, [a, attempt("terra")]);
  assert.equal(r.attempts[0].passed, 0);
  assert.equal(r.attempts[0].unknown, 2);
  assert.equal(r.ready, false);
});
test("different frozen manifests cannot be presented as a matched comparison", () => {
  const a = attempt();
  a.launch.manifestHash = "changed";
  assert.throws(
    () => projectComparison(manifest, [a, attempt("terra")]),
    /manifest/i,
  );
});
test("foreign evaluator output is rejected", () => {
  const a = attempt();
  a.evaluation.runId = "terra";
  assert.throws(
    () => projectComparison(manifest, [a, attempt("terra")]),
    /identity/i,
  );
});
test("duplicate or foreign checks cannot inflate the denominator", () => {
  const a = attempt();
  a.evaluation.checks[1].id = "size";
  assert.throws(
    () => projectComparison(manifest, [a, attempt("terra")]),
    /check/i,
  );
});
test("both selected model identities and high settings stay attached to the evidence", () => {
  const r = projectComparison(manifest, [attempt("terra"), attempt()]);
  assert.equal(r.attempts[0].key, "sol");
  assert.equal(r.attempts[0].model, "gpt-5.6-sol");
  assert.equal(r.attempts[1].run.id, "terra");
  assert.equal(r.attempts[1].reasoningEffort, "high");
  assert.equal(r.ready, true);
  assert.equal(r.attempts[0].passed, 2);
});
test("missing check output cannot become a pass", () => {
  const a = attempt();
  a.evaluation.checks[0].artifactSha256 = "";
  assert.throws(
    () => projectComparison(manifest, [a, attempt("terra")]),
    /evidence/i,
  );
});
test("an unstarted model stays pending without borrowed fixture results", () => {
  const r = projectComparison(manifest, [attempt()]);
  assert.equal(r.attempts[1].state, "pending");
  assert.equal(r.attempts[1].run, null);
  assert.equal(r.attempts[1].unknown, 2);
  assert.equal(r.ready, false);
});
test("finished inconclusive evaluation is complete without claiming a pass", () => {
  const a = attempt();
  a.evaluation.checks[0].outcome = "unknown";
  const r = projectComparison(manifest, [a, attempt("terra")]);
  assert.equal(r.ready, true);
  assert.equal(r.attempts[0].unknown, 1);
  assert.equal(r.attempts[0].passed, 1);
});
test("recorded run cannot be detached from its launch", () => {
  const a = attempt();
  a.launch = null as any;
  assert.throws(
    () => projectComparison(manifest, [a, attempt("terra")]),
    /identity/i,
  );
});
