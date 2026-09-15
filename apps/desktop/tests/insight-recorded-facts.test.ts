import test from "node:test";
import assert from "node:assert/strict";
import { buildInsightBundle } from "../server/insights/evidence.mjs";
import { makePair, makeInsightComparisonWithoutChecks } from "./fixtures/insight-comparisons.mjs";

const check = (bundle, key, id = "independent-regression") => bundle.recordedFacts?.facts.find(f => f.kind === "independent_check" && f.attemptKey === key && f.checkId === id);

test("recorded outcomes belong to their own attempts and resolve selected check evidence", () => {
  const bundle = buildInsightBundle(makePair());
  assert.equal(check(bundle, "north")?.outcome, "pass");
  assert.equal(check(bundle, "south")?.outcome, "fail");
  for (const fact of bundle.recordedFacts.facts) {
    assert.equal(fact.inputHash, bundle.inputHash);
    assert.ok(fact.id);
    for (const id of fact.sourceIds) assert.equal(bundle.sources.find(s => s.id === id)?.attemptKey, fact.attemptKey);
  }
  const north = check(bundle, "north");
  assert.equal(north.evidenceState, "selected");
  assert.equal(north.artifactSha256, "north-independent-artifact");
  assert.equal(north.sourceIds.length, 1);
});

test("a planned check absent from both attempts remains explicitly unknown", () => {
  const pair = makePair();
  pair.checks.push({id:"missing-check", title:"Missing boundary check"});
  const bundle = buildInsightBundle(pair);
  for (const key of ["north", "south"]) {
    const fact = check(bundle, key, "missing-check");
    assert.equal(fact?.outcome, "unknown");
    assert.equal(fact.evidenceState, "missing");
    assert.equal(fact.artifactSha256, null);
    assert.deepEqual(fact.sourceIds, []);
  }
});

test("absent output or artifact identity cannot become a passed fact", () => {
  for (const field of ["output", "artifactSha256"]) {
    const pair = makePair();
    pair.attempts[0].checks[0][field] = "";
    const fact = check(buildInsightBundle(pair), "north");
    assert.equal(fact?.outcome, "unknown");
  }
});

test("omitted check output retains the saved outcome with its omission disclosed", () => {
  const bundle = buildInsightBundle(makePair(), {maxSources:1});
  const fact = check(bundle, "south");
  assert.equal(fact?.outcome, "fail");
  assert.equal(fact.evidenceState, "omitted");
  assert.deepEqual(fact.sourceIds, []);
});

test("grouped check artifacts map every included check without duplicate command facts", () => {
  const pair = makePair();
  const first = pair.attempts[0].checks[0];
  pair.attempts[0].checks.push({...first, id:"second-check", title:"Second condition"});
  const bundle = buildInsightBundle(pair);
  assert.equal(check(bundle, "north", "second-check")?.outcome, "pass");
  assert.deepEqual(check(bundle, "north", "second-check").sourceIds, check(bundle, "north").sourceIds);
  assert.equal(check(bundle, "north").sourceIds.length, 1);
});

test("command exits preserve failure and unavailable status without becoming check outcomes", () => {
  const pair = makePair();
  pair.attempts[0].run.events.find(e => e.id === "north-passed").exitCode = null;
  const bundle = buildInsightBundle(pair);
  const commands = bundle.recordedFacts?.facts.filter(f => f.kind === "command_exit" && f.attemptKey === "north");
  assert.equal(commands?.length, 2);
  assert.deepEqual(commands.map(f => f.exitCode).sort(), [1, null]);
  assert.ok(commands.every(f => f.outcome === undefined));
  assert.ok(commands.every(f => !f.command.includes("IGNORE")));
});

test("facts are stable across ordering and report when no check plan exists", () => {
  const pair = makePair();
  const first = buildInsightBundle(pair);
  pair.attempts.reverse();
  assert.deepEqual(buildInsightBundle(pair).recordedFacts, first.recordedFacts);
  const empty = buildInsightBundle(makeInsightComparisonWithoutChecks());
  assert.equal(empty.recordedFacts?.facts.filter(f => f.kind === "independent_check").length, 0);
  assert.ok(empty.recordedFacts.limits.some(s => /No independent checks/.test(s)));
});

test("an unknown recorded result with omitted output is not missing evidence", () => {
  const pair = makePair();
  pair.attempts[1].checks[0].outcome = "unknown";
  const fact = check(buildInsightBundle(pair, {maxSources:1}), "south");
  assert.equal(fact.outcome, "unknown");
  assert.equal(fact.evidenceState, "omitted");
  assert.match(fact.reason, /outside the selected evidence/);
});

test("unevaluated projector placeholders do not become saved check evidence", async () => {
  const {projectComparison} = await import("../server/comparison-projector.mjs");
  const pair = makePair();
  const manifest = {id:pair.id, title:pair.title, manifestHash:pair.manifestHash, baseCommit:pair.baseCommit,
    checks:["independent-regression"], inputs:{"experiments/C01/prompt.md":pair.promptHash},
    attempts:pair.attempts.map(a => ({key:a.key,model:a.model,reasoningEffort:a.reasoningEffort}))};
  const sources = pair.attempts.map(a => ({key:a.key,run:a.run,launch:{manifestHash:pair.manifestHash,model:a.model,reasoningEffort:a.reasoningEffort},result:{result:{runId:a.run.id}}}));
  const projected = projectComparison(manifest, sources);
  const bundle = buildInsightBundle(projected);
  for (const key of ["north", "south"]) {
    const fact = check(bundle, key);
    assert.equal(fact.outcome, "unknown");
    assert.equal(fact.evidenceState, "missing");
    assert.deepEqual(fact.sourceIds, []);
    assert.doesNotMatch(fact.reason, /saved result/i);
  }
});

test("a projector result with artifact metadata but no output cannot turn placeholder text into evidence", async () => {
  const {projectComparison} = await import("../server/comparison-projector.mjs");
  const pair = makePair();
  const manifest = {id:pair.id,title:pair.title,manifestHash:pair.manifestHash,baseCommit:pair.baseCommit,checks:["independent-regression"],inputs:{},attempts:pair.attempts.map(a=>({key:a.key,model:a.model,reasoningEffort:a.reasoningEffort}))};
  const sources=pair.attempts.map(a=>({key:a.key,run:a.run,launch:{manifestHash:pair.manifestHash,model:a.model,reasoningEffort:a.reasoningEffort},result:{result:{runId:a.run.id}},evaluation:{manifestHash:pair.manifestHash,runId:a.run.id,snapshotHash:"saved",checks:[{id:"independent-regression",outcome:"unknown",artifactSha256:"artifact-with-no-output"}]}}));
  const bundle = buildInsightBundle(projectComparison(manifest,sources));
  assert.equal(check(bundle,"north").evidenceState,"missing");
  assert.deepEqual(check(bundle,"north").sourceIds,[]);
});

test("equivalent optional availability metadata cannot share a hash but change outcomes", () => {
  const pair=makePair();
  const baseline=buildInsightBundle(pair);
  for (const value of [null, "false", 0, {}]) {
    const modified=structuredClone(pair);
    modified.attempts[0].checks[0].outputAvailable=value;
    const candidate=buildInsightBundle(modified);
    if (candidate.inputHash === baseline.inputHash) assert.deepEqual(candidate.recordedFacts, baseline.recordedFacts);
  }
  pair.attempts[0].checks[0].outputAvailable=false;
  const disabled=buildInsightBundle(pair);
  assert.notEqual(disabled.inputHash,baseline.inputHash);
  assert.equal(check(disabled,"north").outcome,"unknown");
});
