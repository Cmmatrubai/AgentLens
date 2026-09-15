import test from "node:test";
import assert from "node:assert/strict";
import * as support from "../server/insights/support-schema.mjs";
import { buildInsightBundle } from "../server/insights/evidence.mjs";
import { makePair, makeFinding } from "./fixtures/insight-comparisons.mjs";

const bundle = buildInsightBundle(makePair());
const draft = makeFinding(bundle);
const output = (passage = "S1:t1") => ({ assessments: support.buildSupportUnits(draft).map(unit => ({
  unitId: unit.id, claims: [{ text: unit.text, verdict: "supported", reason: "Offline structural fixture only.", passages: [passage] }],
})) });

test("the catalog covers selected source text exactly without exposing unselected data", () => {
  assert.equal(typeof support.buildSupportPassages, "function");
  const input = structuredClone(bundle);
  input.sources[0].excerpt = "+new\r\n-previous\n\n" + "long".repeat(1600) + "\ntail";
  input.sources[0].fullSource = input.sources[0].excerpt + "UNSELECTED_SECRET";
  input.authoredNotes = "EVALUATOR_ONLY";
  const passages = support.buildSupportPassages(input);
  const chunks = passages.filter(p => p.ref === "S1" && p.part === "text");
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map(p => p.quote).join(""), input.sources[0].excerpt);
  assert.ok(chunks.every(p => p.quote.length <= 6000));
  assert.equal(new Set(passages.map(p => p.id)).size, passages.length);
  assert.deepEqual(support.buildSupportPassages(input), passages);
  assert.ok(!JSON.stringify(passages).includes("UNSELECTED_SECRET"));
  assert.ok(!JSON.stringify(passages).includes("EVALUATOR_ONLY"));
});

test("all returned evidence choices come from the current catalog; ranges and invented choices are rejected", () => {
  const passages = support.buildSupportPassages(bundle);
  const schema = support.supportSchemaFor(bundle, draft);
  assert.deepEqual(schema.properties.assessments.items.properties.claims.items.properties.passages.items.enum,
    passages.filter(p => p.quote.trim()).map(p => p.id));
  assert.deepEqual(schema.properties.assessments.items.properties.unitId.enum, support.buildSupportUnits(draft).map(u => u.id));
  assert.equal(support.validateSupportOutput(bundle, draft, output()).findings[0].claims[0].passages[0].quote, bundle.sources[0].excerpt);
  for (const bad of ["S999:t1", "S1:t999", {ref:"S1",part:"text",startLine:1,endLine:1}, null]) {
    assert.throws(() => support.validateSupportOutput(bundle, draft, output(bad)));
  }
  const duplicate = output(); duplicate.assessments[0].claims[0].passages.push("S1:t1");
  assert.throws(() => support.validateSupportOutput(bundle, draft, duplicate));
});

test("task requirements are citable without being presented as attempt or implementation evidence", () => {
  const task = support.buildSupportPassages(bundle).find(p => p.id === "T1:t1");
  assert.equal(task.kind, "task_context");
  assert.equal(task.sourceId, null);
  assert.equal(task.attemptKey, "");
  assert.equal(task.quote, JSON.stringify(bundle.task, null, 2));
  const checked = support.validateSupportOutput(bundle, draft, output(task.id));
  assert.equal(checked.findings[0].claims[0].passages[0].kind, "task_context");
});

test("blank selections cannot validate a claim; long fact records retain all check outcomes", () => {
  const input = structuredClone(bundle);
  input.sources[0].excerpt = " \n\t";
  assert.throws(() => support.validateSupportOutput(input, draft, output()));
  const facts = support.buildSupportPassages(bundle).filter(p => p.ref === "A1");
  assert.equal(facts.map(p => p.quote).join(""), JSON.stringify(bundle.attempts[0], null, 2));
  assert.ok(facts.every(p => p.sourceId === null && p.kind === "attempt_facts"));
});
