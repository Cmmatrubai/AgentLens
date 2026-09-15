import test from "node:test";
import assert from "node:assert/strict";
import { parseComparisonBundle } from "../server/insights/import-pair.mjs";
import { makePair } from "./fixtures/insight-comparisons.mjs";
import { buildInsightBundle } from "../server/insights/evidence.mjs";
test("imports another saved pair with explicit provenance and recomputed summary counts", () => {
  const p = makePair();
  p.id = "another-comparison";
  p.title = "A different real task";
  p.taskPrompt = "Compare these changes.";
  p.attempts[0].passed = 999;
  const r = parseComparisonBundle(JSON.stringify(p));
  assert.equal(r.id, "another-comparison");
  assert.equal(r.imported, true);
  assert.notEqual(r.attempts[0].passed, 999);
  assert.equal(r.review.state, "unavailable");
});
test("rejects invalid and oversized imported bundles", () => {
  assert.throws(() => parseComparisonBundle("{}"));
  assert.throws(() => parseComparisonBundle("x".repeat(16 * 1024 * 1024 + 1)));
  const p = makePair();
  p.taskPrompt = "A task";
  p.attempts[1].run.git.initialHead = "foreign";
  assert.throws(() => parseComparisonBundle(JSON.stringify(p)));
});
test("duplicate check IDs cannot inflate imported results", () => {
  const p = makePair();
  p.taskPrompt = "Task";
  p.attempts[0].checks.push({ ...p.attempts[0].checks[0] });
  assert.throws(() => parseComparisonBundle(JSON.stringify(p)));
});

test("import preserves control and coverage disclosures across repeated reads", () => {
  const p = makePair();
  p.attempts[0].controlNotes = ["Network disabled for this attempt."];
  p.attempts[0].coverageLimits = ["Recorder omitted validation output."];
  const imported = parseComparisonBundle(JSON.stringify(p));
  assert.ok(
    imported.attempts[0].controlNotes.includes(p.attempts[0].controlNotes[0]),
  );
  assert.ok(
    imported.attempts[0].coverageLimits.includes(
      p.attempts[0].coverageLimits[0],
    ),
  );
  const again = parseComparisonBundle(JSON.stringify(imported));
  assert.deepEqual(
    again.attempts[0].controlNotes,
    imported.attempts[0].controlNotes,
  );
  assert.equal(
    buildInsightBundle(again).inputHash,
    buildInsightBundle(imported).inputHash,
  );
  p.attempts[0].coverageLimits = ["Different missing evidence."];
  assert.notEqual(
    buildInsightBundle(parseComparisonBundle(JSON.stringify(p))).inputHash,
    buildInsightBundle(imported).inputHash,
  );
});

test("duplicate event identities are rejected before analysis", () => {
  const p = makePair();
  p.attempts[0].run.events.push({ ...p.attempts[0].run.events[0] });
  assert.equal(buildInsightBundle(p).eligible, false);
  assert.throws(() => parseComparisonBundle(JSON.stringify(p)));
});

test("import keeps unrun planned checks visible instead of discarding the plan", () => {
  const pair = makePair();
  pair.checks.push({id:"unrun", title:"Unrun boundary"});
  const imported = parseComparisonBundle(JSON.stringify(pair));
  assert.equal(imported.checks.find(c => c.id === "unrun")?.title, "Unrun boundary");
  assert.equal(imported.ready, false);
  assert.deepEqual(imported.attempts.map(a => a.unknown), [1, 1]);
  const facts = buildInsightBundle(imported).recordedFacts.facts.filter(f => f.kind === "independent_check" && f.checkId === "unrun");
  assert.deepEqual(facts.map(f => f.outcome), ["unknown", "unknown"]);
  assert.deepEqual(parseComparisonBundle(JSON.stringify(imported)).checks, imported.checks);
});

test("invalid or duplicated planned check identities are rejected on import", () => {
  for (const checks of [{}, [{id:"",title:"blank"}], [{id:"planned",title:42}], [{id:"planned",title:"one"},{id:"planned",title:"two"}]]) {
    const pair = makePair();
    pair.checks = checks;
    assert.throws(() => parseComparisonBundle(JSON.stringify(pair)));
  }
});

test("import rejects malformed output availability metadata", () => {
  for (const value of [null, "false", 0, {}]) {
    const pair=makePair();
    pair.attempts[0].checks[0].outputAvailable=value;
    assert.throws(()=>parseComparisonBundle(JSON.stringify(pair)));
  }
});
