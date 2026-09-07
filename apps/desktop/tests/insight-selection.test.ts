import test from "node:test";
import assert from "node:assert/strict";
import { buildInsightBundle } from "../server/insights/evidence.mjs";
import { makePair } from "./fixtures/insight-comparisons.mjs";
test("repeated check artifacts cannot crowd out implementation and final reports", () => {
  const p = makePair();
  for (const a of p.attempts) {
    a.checks = Array.from({ length: 20 }, (_, i) => ({
      ...a.checks[0],
      id: "check-" + i,
      title: "Check " + i,
    }));
  }
  const b = buildInsightBundle(p);
  assert.equal(b.sources.filter((s) => s.kind === "check").length, 2);
  for (const a of p.attempts) {
    assert.equal(
      b.attempts.find((x) => x.key === a.key).facts.checks.length,
      20,
    );
    assert.ok(
      b.sources.some((s) => s.attemptKey === a.key && s.kind === "file"),
    );
    assert.ok(
      b.sources.some(
        (s) => s.attemptKey === a.key && s.provenance === "Agent report",
      ),
    );
  }
});
test("paired lifecycle starts do not become missing-output warnings", () => {
  const p = makePair();
  const a = p.attempts[0];
  const terminal = a.run.events.find((e) => e.kind === "command");
  a.run.events.unshift({
    ...terminal,
    id: "start-event",
    sequence: 1,
    status: "in_progress",
    exitCode: null,
    output: "",
    outputState: "unavailable",
  });
  const b = buildInsightBundle(p);
  assert.ok(!b.coverage.limits.some((l) => l.includes("start-event")));
  assert.ok(!b.coverage.limits.some((l) => l.includes("unmatched")));
});
test("many commands cannot crowd out both implementations and final reports", () => {
  const p = makePair();
  for (const a of p.attempts) {
    const command = a.run.events.find((e) => e.kind === "command");
    for (let i = 10; i < 50; i++)
      a.run.events.push({
        ...command,
        id: a.key + "-extra-" + i,
        sequence: i,
        output: "Recorded output " + i,
      });
  }
  const b = buildInsightBundle(p);
  assert.equal(b.sources.length, 24);
  for (const a of p.attempts) {
    assert.ok(
      b.sources.some((s) => s.attemptKey === a.key && s.kind === "file"),
    );
    assert.ok(
      b.sources.some(
        (s) => s.attemptKey === a.key && s.provenance === "Agent report",
      ),
    );
  }
});
test("selection limits are part of saved analysis identity", () => {
  const p = makePair();
  assert.notEqual(
    buildInsightBundle(p, { maxSources: 10 }).inputHash,
    buildInsightBundle(p, { maxSources: 24 }).inputHash,
  );
});
test("a declared check pass without output or artifact stays unknown", () => {
  const p = makePair();
  p.attempts[0].checks[0].output = "";
  p.attempts[0].checks[0].artifactSha256 = null;
  p.attempts[0].checks[0].outcome = "pass";
  assert.equal(
    buildInsightBundle(p).attempts.find((a) => a.key === p.attempts[0].key)
      .facts.checks[0].outcome,
    "unknown",
  );
});
test("missing model identities cannot produce attributed insights", () => {
  const p = makePair();
  p.attempts[0].model = "";
  assert.equal(buildInsightBundle(p).eligible, false);
});

test("provider bundle includes declared controls and shared task checks", () => {
  const p = makePair();
  p.attempts[0].controlNotes = ["Network was disabled for this attempt."];
  const b = buildInsightBundle(p);
  assert.deepEqual(
    b.attempts.find((a) => a.key === p.attempts[0].key).controlNotes,
    p.attempts[0].controlNotes,
  );
  assert.equal(b.task.timeoutMs, p.timeoutMs);
  assert.equal(b.task.promptHash, p.promptHash);
  assert.equal(b.task.checkBundleHash, p.checkBundleHash);
});
