import test from "node:test";
import assert from "node:assert/strict";
import { buildInsightBundle } from "../server/insights/evidence.mjs";
import { makePair, makeFinding } from "./fixtures/insight-comparisons.mjs";
import * as support from "../server/insights/support-schema.mjs";
import { reviewOpenAI } from "../server/insights/support-provider.mjs";

const bundle = buildInsightBundle(makePair());
const draft = makeFinding(bundle);
draft.findings.push({ ...structuredClone(draft.findings[0]), id: "second-finding", title: "A separate difference", summary: "A distinct draft claim needing independent review." });
const unitFields = ["category", "title", "summary", "interpretation", "limitations", "observation:0", "observation:1"];
const firstPassage = () => "S1:t1";
const assessments = (original = draft) => ({ assessments: original.findings.flatMap((finding, index) => unitFields.map((field) => ({
  unitId: `f${index}:${field}`,
  claims: [{
    text: field.startsWith("observation:") ? finding.sides[Number(field.split(":")[1])].observation : finding[field],
    verdict: "supported", reason: "This text stays within the cited excerpts.", passages: [firstPassage()],
  }],
}))) });

test("support evidence binds selected excerpts and attempt facts to separate canonical records", () => {
  assert.equal(typeof support.buildSupportEvidence, "function");
  const input = { ...bundle, authoredNotes: "private review notes", sources: bundle.sources.map((source) => ({ ...source, fullSource: "unselected remainder", privateNote: "private source note" })) };
  const records = support.buildSupportEvidence(input);
  assert.equal(records.length, bundle.sources.length + 2);
  assert.equal(records[0].ref, "S1");
  assert.equal(records[0].text, bundle.sources[0].excerpt);
  assert.equal(records[0].sourceId, bundle.sources[0].id);
  assert.equal(records[0].provenance, "Independent check");
  assert.equal(JSON.parse(records[0].metadataText).provenance, "Independent check");
  assert.equal(JSON.parse(records[0].metadataText).truncated, false);
  assert.deepEqual(Object.keys(JSON.parse(records[0].metadataText)), ["provenance", "path", "identity", "command", "exitCode", "truncated", "sha256", "fromLine", "toLine"]);
  const facts = records.find((record) => record.ref === "A1");
  assert.equal(facts.sourceId, null);
  assert.equal(facts.attemptKey, "north");
  assert.equal(facts.kind, "attempt_facts");
  assert.equal(facts.label, "Attempt facts · orion-code");
  assert.equal(facts.text, JSON.stringify(bundle.attempts[0], null, 2));
  assert.equal(facts.metadataText, undefined);
  for (const excluded of ["private review notes", "unselected remainder", "private source note"])
    assert.ok(!JSON.stringify(records).includes(excluded));
});

test("support units cover each original text section without borrowing or rewriting its text", () => {
  assert.equal(typeof support.buildSupportUnits, "function");
  const units = support.buildSupportUnits(draft);
  assert.equal(units.length, 14);
  assert.deepEqual(units.slice(0, 7).map((unit) => unit.id), ["f0:category", "f0:title", "f0:summary", "f0:interpretation", "f0:limitations", "f0:observation:0", "f0:observation:1"]);
  assert.equal(units[2].findingId, draft.findings[0].id);
  assert.equal(units[2].field, "summary");
  assert.equal(units[2].text, draft.findings[0].summary);
  assert.equal(units[5].field, "sides[0].observation");
  assert.equal(units[5].text, draft.findings[0].sides[0].observation);
  assert.equal(units[9].text, draft.findings[1].summary);
  assert.deepEqual(units[2].sourceIds, [...new Set(draft.findings[0].sides.flatMap((side) => side.sourceIds))]);
  assert.deepEqual(support.buildSupportUnits(structuredClone(draft)), units);
});

test("one unsupported summary prevents support even when its limitations and every other section pass", () => {
  const output = assessments();
  const summary = output.assessments.find((assessment) => assessment.unitId === "f0:summary");
  summary.claims[0].verdict = "unsupported";
  summary.claims[0].reason = "The summary asserts implementation scope that is not shown.";
  output.assessments.reverse();
  const result = support.validateSupportOutput(bundle, draft, output);
  assert.deepEqual(result.findings.map((finding) => finding.findingId), draft.findings.map((finding) => finding.id));
  assert.equal(result.findings[0].verdict, "unsupported");
  assert.equal(result.findings[0].reason, "1 of 7 claims need review.");
  assert.deepEqual(result.findings[0].issues, [{
    claim: draft.findings[0].summary, explanation: "The summary asserts implementation scope that is not shown.", sourceIds: [bundle.sources[0].id],
    passages: [{ sourceId: bundle.sources[0].id, attemptKey: "north", kind: "check", label: "Independent regression", quote: bundle.sources[0].excerpt }],
  }]);
  assert.equal(result.findings[0].claims.length, 7);
  assert.equal(result.findings[0].claims[2].field, "summary");
  assert.equal(result.findings[1].verdict, "supported");
  assert.deepEqual(result.findings[1].issues, []);
});

test("claim review requires complete unique unit coverage and closed bounded shapes", () => {
  for (const mutate of [
    (o) => { o.assessments.pop(); },
    (o) => { o.assessments.push(structuredClone(o.assessments[0])); },
    (o) => { o.assessments[1].unitId = o.assessments[0].unitId; },
    (o) => { o.assessments[0].unitId = "foreign-unit"; },
    (o) => { o.assessments[0].claims = []; },
    (o) => { o.assessments[0].claims = Array.from({ length: 7 }, () => structuredClone(o.assessments[0].claims[0])); },
    (o) => { o.assessments[0].claims[0].verdict = "verified_correct"; },
    (o) => { o.assessments[0].claims[0].reason = " "; },
    (o) => { o.assessments[0].claims[0].reason = "x".repeat(501); },
    (o) => { o.assessments[0].claims[0].passages = []; },
    (o) => { o.assessments[0].claims[0].passages = Array.from({ length: 7 }, firstPassage); },
    (o) => { o.notes = "replacement output"; },
    (o) => { o.assessments[0].claim = "invented quote"; },
    (o) => { o.assessments[0].rewrite = "corrected text"; },
    (o) => { o.assessments[0].claims[0].rewrite = "corrected text"; },
    (o) => { o.assessments[0].claims[0].passages[0] = "invented"; },
  ]) {
    const output = assessments();
    mutate(output);
    assert.throws(() => support.validateSupportOutput(bundle, draft, output));
  }
  assert.throws(() => support.validateSupportOutput(bundle, draft, { findings: [] }));
});

test("claims must partition each unit in order without gaps, overlap, reordering or foreign text", () => {
  const original = structuredClone(draft);
  original.findings[0].summary = "First claim.  Second claim.\nThird claim.";
  const output = assessments(original);
  const summary = output.assessments.find((assessment) => assessment.unitId === "f0:summary");
  const claim = (text) => ({ text, verdict: "supported", reason: "A supplied passage is relevant.", passages: [firstPassage()] });
  summary.claims = [claim("First claim."), claim("Second claim."), claim("Third claim.")];
  const result = support.validateSupportOutput(bundle, original, output);
  assert.deepEqual(result.findings[0].claims.filter((entry) => entry.field === "summary").map((entry) => entry.text), ["First claim.", "Second claim.", "Third claim."]);
  for (const texts of [
    ["First claim.", "Third claim."],
    ["First claim."],
    ["Second claim.", "First claim.", "Third claim."],
    ["First claim.  Second", "Second claim.", "Third claim."],
    ["First claim.", "Invented claim.", "Third claim."],
    [draft.findings[1].summary],
  ]) {
    const invalid = structuredClone(output);
    invalid.assessments.find((assessment) => assessment.unitId === "f0:summary").claims = texts.map(claim);
    assert.throws(() => support.validateSupportOutput(bundle, original, invalid));
  }
});

test("claim partitioning handles repeated text while preserving punctuation and negation", () => {
  const original = structuredClone(draft);
  original.findings[0].summary = "Not ready; ready, ready.";
  const output = assessments(original);
  const claim = (text) => ({ text, verdict: "supported", reason: "A passage was supplied.", passages: [firstPassage()] });
  const summary = output.assessments.find((assessment) => assessment.unitId === "f0:summary");
  summary.claims = [claim("Not ready;"), claim("ready,"), claim("ready.")];
  assert.equal(support.validateSupportOutput(bundle, original, output).findings[0].claims.length, 9);
  for (const texts of [
    ["ready;", "ready,", "ready."],
    ["Not ready", "ready,", "ready."],
    ["Not ready;", "ready.", "ready,"],
    ["Not ready; ready,", "ready, ready."],
  ]) {
    summary.claims = texts.map(claim);
    assert.throws(() => support.validateSupportOutput(bundle, original, output));
  }
});

test("exact passage validation is lexical and does not certify semantic support", () => {
  const original = structuredClone(draft);
  original.findings[0].summary = "The implementation eliminates all memory allocations.";
  const result = support.validateSupportOutput(bundle, original, assessments(original));
  assert.equal(result.findings[0].verdict, "supported");
  assert.equal(result.findings[0].claims[2].passages[0].quote, "north independent result: pass");
});

test("passage IDs reject legacy ranges, invented values, empty and duplicate selections", () => {
  for (const passages of [["S999:t1"], ["A1:m1"], [""], [null], [123],
    [{ref:"S1",part:"text",startLine:1,endLine:1}], ["S1:t1", "S1:t1"]]) {
    const output = assessments(); output.assessments[0].claims[0].passages = passages;
    assert.throws(() => support.validateSupportOutput(bundle, draft, output));
  }
});

test("source metadata is selected separately and resolves with explicit provenance", () => {
  const input = structuredClone(bundle);
  input.sources[0].truncated = true;
  const record = support.buildSupportEvidence(input)[0];
  const lines = support.supportEvidenceLines(record.metadataText);
  const truncatedLine = lines.findIndex((line) => line.includes('"truncated"')) + 1;
  assert.ok(truncatedLine > 1);
  const output = assessments();
  output.assessments[0].claims[0].verdict = "needs_review";
  output.assessments[0].claims[0].passages = ["S1:m1"];
  assert.deepEqual(support.validateSupportOutput(input, draft, output).findings[0].issues[0].passages, [{
    sourceId: input.sources[0].id, attemptKey: "north", kind: "source_metadata", label: "Source details · Independent regression", quote: record.metadataText,
  }]);
  output.assessments[0].claims[0].passages[0] = "S1:m999";
  assert.throws(() => support.validateSupportOutput(input, draft, output));
});

test("attempt facts and selected sources outside original citations retain explicit provenance", () => {
  const output = assessments();
  output.assessments[0].claims[0].verdict = "needs_review";
  const lines = support.supportEvidenceLines(JSON.stringify(bundle.attempts[0], null, 2));
  const outcomeLine = lines.findIndex((line) => line.includes('"outcome": "pass"')) + 1;
  output.assessments[0].claims[0].passages = ["A1:t1"];
  const result = support.validateSupportOutput(bundle, draft, output);
  const passage = result.findings[0].issues[0].passages[0];
  assert.deepEqual(passage, { sourceId: null, attemptKey: "north", kind: "attempt_facts", label: "Attempt facts · orion-code", quote: JSON.stringify(bundle.attempts[0], null, 2) });
  assert.deepEqual(result.findings[0].issues[0].sourceIds, []);
  const cited = new Set(draft.findings[0].sides.flatMap((side) => side.sourceIds));
  const otherIndex = bundle.sources.findIndex((source) => !cited.has(source.id));
  assert.ok(otherIndex >= 0);
  output.assessments[0].claims[0].passages = [`S${otherIndex + 1}:t1`];
  assert.deepEqual(support.validateSupportOutput(bundle, draft, output).findings[0].issues[0].sourceIds, [bundle.sources[otherIndex].id]);
});

test("server aggregation preserves long legacy text and the worst unit verdict", () => {
  const original = structuredClone(draft);
  original.findings[0].interpretation = "x".repeat(1500);
  const output = assessments(original);
  for (const assessment of output.assessments.filter((entry) => entry.unitId.startsWith("f0:"))) assessment.claims[0].verdict = "needs_review";
  const result = support.validateSupportOutput(bundle, original, output);
  assert.equal(result.findings[0].verdict, "needs_review");
  assert.equal(result.findings[0].issues.length, 7);
  assert.equal(result.findings[0].issues[3].claim, original.findings[0].interpretation);
  output.assessments[0].claims[0].verdict = "unsupported";
  assert.equal(support.validateSupportOutput(bundle, original, output).findings[0].verdict, "unsupported");
  const invalid = structuredClone(original);
  invalid.findings[0].sides[0].sourceIds = ["foreign-source"];
  assert.throws(() => support.validateSupportOutput(bundle, invalid, output), /foreign source/);
  assert.deepEqual(support.validateSupportOutput(bundle, { findings: [], abstentionReason: "No material difference." }, { assessments: [] }), { findings: [] });
});

const response = (apiFormat, output, overrides = {}) => new Response(JSON.stringify({
  ...(apiFormat === "responses" ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } }
    : { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }), ...overrides,
}));

test("all six provider modes send only the selected evidence and standalone text units", async () => {
  const input = { ...bundle, authoredNotes: "private human review notes", sources: bundle.sources.map((source) => ({ ...source, fullSource: "unselected private remainder" })) };
  for (const apiFormat of ["responses", "chat_completions"]) {
    for (const outputFormat of ["json_schema", "json_object", "prompted_json"]) {
      let calls = 0;
      let sentBody;
      const result = await reviewOpenAI({
        bundle: input, draft, model: "chosen", apiKey: "fixture-key", baseUrl: "https://provider.example/v1", apiFormat, outputFormat,
        reasoningEffort: "low", maxOutputTokens: 12000, timeoutSeconds: 150, authoredNotes: "private manual assessment",
        fetchImpl: async (url, options) => {
          calls++;
          sentBody = JSON.parse(options.body);
          assert.equal(url, `https://provider.example/v1/${apiFormat === "chat_completions" ? "chat/completions" : "responses"}`);
          assert.equal(options.headers.Authorization, "Bearer fixture-key");
          assert.equal(options.redirect, "error");
          return response(apiFormat, assessments());
        },
      });
      const isChat = apiFormat === "chat_completions";
      assert.equal(sentBody[isChat ? "max_tokens" : "max_output_tokens"], 12000);
      assert.equal(isChat ? sentBody.reasoning_effort : sentBody.reasoning.effort, "low");
      const payload = JSON.parse(isChat ? sentBody.messages[1].content : sentBody.input[0].content);
      assert.deepEqual(Object.keys(payload), ["coverage", "passages", "units"]);
      assert.deepEqual(payload.coverage, bundle.coverage);
      assert.deepEqual(payload.passages, support.buildSupportPassages(input).filter(p => p.quote.trim()));
      assert.equal(payload.attempts, undefined);
      assert.equal(payload.units[2].text, draft.findings[0].summary);
      assert.deepEqual(payload.units[2].originalCitationRefs, ["S2", "S1"]);
      assert.equal(payload.units[2].sourceIds, undefined);
      for (const excluded of ["private human review notes", "private manual assessment", "unselected private remainder"]) assert.ok(!JSON.stringify(sentBody).includes(excluded));
      if (!isChat) { assert.equal(sentBody.store, false); assert.deepEqual(sentBody.tools, []); }
      else assert.equal(sentBody.tools, undefined);
      const rubric = isChat ? sentBody.messages[0].content : sentBody.instructions;
      const schema = outputFormat === "json_schema" ? isChat ? sentBody.response_format.json_schema.schema : sentBody.text.format.schema : JSON.parse(rubric.slice(rubric.indexOf('{"type":"object"')));
      assert.equal(schema.properties.assessments.maxItems, 21);
      const unitSchema = schema.properties.assessments.items;
      assert.deepEqual(unitSchema.properties.claims.items.properties.verdict.enum, ["supported", "needs_review", "unsupported"]);
      assert.equal(unitSchema.additionalProperties, false);
      assert.equal(unitSchema.properties.claims.items.properties.passages.minItems, 1);
      assert.deepEqual(unitSchema.properties.claims.items.properties.passages.items.enum, payload.passages.map(p => p.id));
      assert.equal(calls, 1);
      assert.deepEqual(result.output, assessments());
      assert.equal(result.usage.total_tokens, 130);
    }
  }
});

test("support transport preserves refusal and truncation failures with sanitized diagnostics and no retries", async () => {
  for (const [apiFormat, overrides, code] of [
    ["responses", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }, "provider_incomplete"],
    ["chat_completions", { choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "private reasoning" } }] }, "provider_incomplete"],
    ["chat_completions", { choices: [{ finish_reason: "stop", message: { refusal: "private refusal", content: null } }] }, "provider_refused"],
  ]) {
    let calls = 0;
    await assert.rejects(reviewOpenAI({ bundle, draft, model: "chosen", apiFormat, fetchImpl: async () => { calls++; return response(apiFormat, assessments(), overrides); } }), (error) => {
      assert.equal(error.message, code);
      assert.equal(error.diagnostics.outputTokens, 30);
      assert.ok(!JSON.stringify(error).includes("private"));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("support requests reject malformed drafts and oversized input before any network call", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response("responses", assessments()); };
  const invalid = structuredClone(draft);
  invalid.findings[0].sides[0].sourceIds = ["foreign-source"];
  await assert.rejects(reviewOpenAI({ bundle, draft: invalid, model: "chosen", fetchImpl }), /foreign source/);
  await assert.rejects(reviewOpenAI({ bundle: { ...bundle, task: { prompt: "x".repeat(220000) } }, draft, model: "chosen", fetchImpl }), /analysis_input_too_large/);
  assert.equal(calls, 0);
});
