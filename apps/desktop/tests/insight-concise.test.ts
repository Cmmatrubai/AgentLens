import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInsightBundle } from "../server/insights/evidence.mjs";
import { validateInsightOutput } from "../server/insights/schema.mjs";
import { createInsightService } from "../server/insights/service.mjs";
import { makePair, makeFinding } from "./fixtures/insight-comparisons.mjs";

const bundle = buildInsightBundle(makePair());
const concise = { profile: "concise" };

test("new concise validation bounds each text field while legacy output stays valid", () => {
  for (const [field, maximum] of [
    ["title", 80], ["category", 40], ["summary", 280],
    ["interpretation", 600], ["limitations", 400],
    ["observation", 500], ["abstentionReason", 400],
  ]) {
    const output = makeFinding(bundle);
    const holder = field === "abstentionReason" ? output
      : field === "observation" ? output.findings[0].sides[0] : output.findings[0];
    holder[field] = "x".repeat(maximum + 1);
    assert.doesNotThrow(() => validateInsightOutput(bundle, output));
    assert.throws(() => validateInsightOutput(bundle, output, concise), /text length bound/, field);
    holder[field] = "x".repeat(maximum);
    assert.doesNotThrow(() => validateInsightOutput(bundle, output, concise));
  }
});

test("concise findings retain server-resolved sources and reject foreign ownership", () => {
  const output = makeFinding(bundle);
  assert.throws(() => validateInsightOutput(bundle, output, { profile: "unknown" }), /Unknown insight validation profile/);
  const result = validateInsightOutput(bundle, output, concise);
  assert.equal(result.findings.length, 1);
  for (const side of result.findings[0].sides) {
    assert.ok(side.sources.length > 0);
    assert.ok(side.sources.every((source) => source.attemptKey === side.attemptKey));
  }
  const foreign = structuredClone(output);
  foreign.findings[0].sides[0].sourceIds = ["foreign-source"];
  assert.throws(() => validateInsightOutput(bundle, foreign, concise), /foreign source/);
  const crossed = structuredClone(output);
  crossed.findings[0].sides[0].sourceIds = [...crossed.findings[0].sides[1].sourceIds];
  assert.throws(() => validateInsightOutput(bundle, crossed, concise), /another attempt/);
});

async function fixture(analyze) {
  const root = await mkdtemp(join(tmpdir(), "insight-concise-"));
  const options = {
    root,
    readComparison: async () => ({ ok: true, comparison: makePair() }),
    credentialStore: { get: async () => "fixture-key", set: async () => {}, remove: async () => {} },
    analyze,
  };
  const service = createInsightService(options);
  const state = await service.configure({ model: "chosen", enabled: true });
  return {
    root, service, options, state,
    request: { inputHash: state.input.hash, settingsHash: state.settingsHash, requestId: randomUUID() },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function waitFor(service, state) {
  for (let i = 0; i < 200; i++) {
    const current = await service.read();
    if (current.state === state) return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error(`Did not reach ${state}`);
}

test("saved long-form findings remain readable without applying the new generation profile", async () => {
  const f = await fixture(async () => { throw Error("unexpected provider call"); });
  try {
    const output = makeFinding(bundle);
    output.findings[0].summary = "s".repeat(1000);
    output.findings[0].interpretation = "i".repeat(1500);
    output.findings[0].sides[0].observation = "o".repeat(1100);
    assert.doesNotThrow(() => validateInsightOutput(bundle, output));
    const key = createHash("sha256").update(JSON.stringify([f.state.input.hash, f.state.settingsHash])).digest("hex");
    const job = {
      id: f.request.requestId, comparisonId: f.state.input.comparisonId,
      inputHash: f.state.input.hash, key, model: "chosen", state: "complete",
      createdAt: 1, endedAt: 2, output,
    };
    await writeFile(join(f.root, `job-${job.id}.json`), JSON.stringify(job), { mode: 0o600 });
    const restored = await createInsightService(f.options).read();
    assert.equal(restored.state, "available");
    assert.equal(restored.analysis.findings[0].summary.length, 1000);
    assert.equal(restored.analysis.findings[0].interpretation.length, 1500);
    const longSide = restored.analysis.findings[0].sides.find(
      (side) => side.attemptKey === output.findings[0].sides[0].attemptKey,
    );
    assert.equal(longSide.observation.length, 1100);
  } finally { await f.cleanup(); }
});

test("prompt-v2 findings become stale under v3 while original history and bytes remain intact", async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return { output: makeFinding(bundle) }; });
  try {
    const oldConnection = {
      baseUrl: "https://api.openai.com/v1",
      apiFormat: "responses",
      outputFormat: "json_schema",
      authMode: "bearer",
    };
    const oldSettingsHash = createHash("sha256").update(JSON.stringify([
      "chosen", oldConnection, "insights-v1", "comparison-rubric-v2",
    ])).digest("hex");
    const oldKey = createHash("sha256").update(JSON.stringify([
      f.state.input.hash, oldSettingsHash,
    ])).digest("hex");
    const output = makeFinding(bundle);
    output.findings[0].summary = "s".repeat(1000);
    output.findings[0].interpretation = "i".repeat(1500);
    const oldJob = {
      id: f.request.requestId, comparisonId: f.state.input.comparisonId,
      inputHash: f.state.input.hash, key: oldKey, model: "chosen", ...oldConnection,
      analyzerVersion: "insights-v1", promptVersion: "comparison-rubric-v2",
      createdAt: 1, endedAt: 2, state: "complete", output,
    };
    const file = join(f.root, `job-${oldJob.id}.json`);
    const original = JSON.stringify(oldJob, null, 2);
    await writeFile(file, original, { mode: 0o600 });
    const current = await f.service.read();
    assert.equal(current.state, "stale");
    assert.equal(current.analysis, null);
    assert.equal(current.history[0].id, oldJob.id);
    assert.equal(current.history[0].state, "complete");
    const refused = await f.service.generate({
      ...f.request, requestId: randomUUID(), settingsHash: oldSettingsHash,
    });
    assert.equal(refused.error, "settings_changed");
    assert.equal(calls, 0);
    assert.equal(await readFile(file, "utf8"), original);
  } finally { await f.cleanup(); }
});

test("new overlong findings fail completion safely without retrying or publishing output", async () => {
  let calls = 0;
  const f = await fixture(async ({ bundle: input }) => {
    calls++;
    const output = makeFinding(input);
    output.findings[0].summary = "s".repeat(281);
    return { output, diagnostics: { finishReason: "stop", outputTokens: 700 } };
  });
  try {
    await f.service.generate(f.request);
    const failed = await waitFor(f.service, "failed");
    assert.equal(failed.error, "analysis_validation_failed");
    assert.equal(failed.analysis, null);
    assert.deepEqual(failed.diagnostics, { finishReason: "stop", outputTokens: 700 });
    const saved = JSON.parse(await readFile(join(f.root, `job-${f.request.requestId}.json`), "utf8"));
    assert.equal(saved.output, undefined);
    await createInsightService(f.options).read();
    await f.service.generate(f.request);
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("new concise findings complete and preserve source attribution", async () => {
  const f = await fixture(async ({ bundle: input }) => ({ output: makeFinding(input) }));
  try {
    await f.service.generate(f.request);
    const result = await waitFor(f.service, "available");
    assert.equal(result.analysis.findings.length, 1);
    for (const side of result.analysis.findings[0].sides) {
      assert.ok(side.sources.every((source) => source.attemptKey === side.attemptKey));
    }
  } finally { await f.cleanup(); }
});
