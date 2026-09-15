import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { analyzeOpenAI } from "../server/insights/provider.mjs";
import { createInsightService } from "../server/insights/service.mjs";
import { makePair } from "./fixtures/insight-comparisons.mjs";
import { INSIGHT_VERSION } from "../server/insights/schema.mjs";
import { PROMPT_VERSION } from "../server/insights/provider.mjs";

const output = { findings: [], abstentionReason: "No supported difference." };
const bundle = { attempts: [], sources: [], coverage: {}, task: {} };
const reply = (apiFormat, overrides = {}) => new Response(JSON.stringify({
  ...(apiFormat === "responses" ? {
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
  } : {
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
  }),
  ...overrides,
}));

test("completion controls reach the selected API without adding default reasoning fields", async () => {
  for (const apiFormat of ["responses", "chat_completions"]) {
    for (const reasoningEffort of ["default", "none", "low", "medium", "high", "max"]) {
      let body;
      await analyzeOpenAI({
        bundle, model: "chosen", apiFormat, reasoningEffort,
        maxOutputTokens: 16000, timeoutSeconds: 150,
        fetchImpl: async (_url, options) => {
          body = JSON.parse(options.body);
          return reply(apiFormat);
        },
      });
      assert.equal(body[apiFormat === "responses" ? "max_output_tokens" : "max_tokens"], 16000);
      if (apiFormat === "responses") {
        assert.deepEqual(body.reasoning, reasoningEffort === "default" ? undefined : { effort: reasoningEffort });
        assert.equal(body.reasoning_effort, undefined);
      } else {
        assert.equal(body.reasoning_effort, reasoningEffort === "default" ? undefined : reasoningEffort);
        assert.equal(body.reasoning, undefined);
      }
    }
  }
});

test("an unsupported explicit reasoning-off request fails without retrying with another effort", async () => {
  for (const apiFormat of ["responses", "chat_completions"]) {
    const bodies = [];
    await assert.rejects(analyzeOpenAI({
      bundle, model: "chosen", apiFormat, reasoningEffort: "none",
      fetchImpl: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return new Response(null, { status: 400 });
      },
    }), /provider_unsupported_request/);
    assert.equal(bodies.length, 1);
    assert.equal(apiFormat === "responses" ? bodies[0].reasoning.effort : bodies[0].reasoning_effort, "none");
  }
});

test("invalid completion limits fail before contacting the provider", async () => {
  for (const controls of [
    { maxOutputTokens: 999 }, { maxOutputTokens: 32001 }, { maxOutputTokens: 6000.5 },
    { maxOutputTokens: "6000" }, { maxOutputTokens: NaN }, { maxOutputTokens: null },
    { timeoutSeconds: 29 }, { timeoutSeconds: 301 }, { timeoutSeconds: Infinity },
    { timeoutSeconds: null }, { reasoningEffort: null }, { reasoningEffort: "auto-disable-thinking" },
  ]) {
    let calls = 0;
    await assert.rejects(analyzeOpenAI({
      bundle, model: "chosen", ...controls,
      fetchImpl: async () => { calls++; return reply("responses"); },
    }), /invalid_settings/);
    assert.equal(calls, 0);
  }
});

test("incomplete answers retain bounded usage while withholding provider text", async () => {
  for (const apiFormat of ["responses", "chat_completions"]) {
    const raw = apiFormat === "responses" ? {
      status: "incomplete", output: [],
      usage: { input_tokens: 80, output_tokens: 6000, total_tokens: 6080, output_tokens_details: { reasoning_tokens: 5999 } },
    } : {
      choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "private reasoning" } }],
      usage: { prompt_tokens: 80, completion_tokens: 6000, total_tokens: 6080, completion_tokens_details: { reasoning_tokens: 5999 } },
    };
    await assert.rejects(analyzeOpenAI({
      bundle, model: "chosen", apiFormat,
      fetchImpl: async () => reply(apiFormat, raw),
    }), (error) => {
      assert.equal(error.message, "provider_incomplete");
      assert.deepEqual(error.diagnostics, {
        ...(apiFormat === "responses" ? { status: "incomplete" } : { finishReason: "length" }),
        inputTokens: 80, outputTokens: 6000, totalTokens: 6080, reasoningTokens: 5999, answerCharacters: 0,
      });
      assert.ok(!JSON.stringify(error).includes("private reasoning"));
      return true;
    });
  }
});

test("malformed provider diagnostics cannot carry arbitrary text or invalid counts", async () => {
  await assert.rejects(analyzeOpenAI({
    bundle, model: "chosen", apiFormat: "chat_completions",
    fetchImpl: async () => reply("chat_completions", {
      status: "private status", id: "private response",
      choices: [{ finish_reason: "private finish reason", message: { content: "private output" } }],
      usage: { prompt_tokens: -1, completion_tokens: "private count", total_tokens: 2 ** 54, completion_tokens_details: { reasoning_tokens: 1.5 } },
    }),
  }), (error) => {
    assert.deepEqual(error.diagnostics, { answerCharacters: 14 });
    assert.ok(!JSON.stringify(error).includes("private"));
    return true;
  });
});

test("Responses output-token exhaustion has the same bounded finish reason as Chat truncation", async () => {
  await assert.rejects(analyzeOpenAI({
    bundle, model: "chosen",
    fetchImpl: async () => reply("responses", {
      status: "incomplete", incomplete_details: { reason: "max_output_tokens", private: "provider text" }, output: [],
    }),
  }), (error) => {
    assert.deepEqual(error.diagnostics, { status: "incomplete", finishReason: "length", answerCharacters: 0 });
    return true;
  });
});

async function fixture(analyze) {
  const root = await mkdtemp(join(tmpdir(), "insight-completion-"));
  const options = {
    root,
    readComparison: async () => ({ ok: true, comparison: makePair() }),
    credentialStore: { get: async () => "fixture-key", set: async () => {}, remove: async () => {} },
    analyze,
  };
  return { root, options, service: createInsightService(options), cleanup: () => rm(root, { recursive: true, force: true }) };
}
const configured = (controls = {}) => ({ model: "chosen", enabled: true, ...controls });
const request = (state) => ({ inputHash: state.input.hash, settingsHash: state.settingsHash, requestId: randomUUID() });
async function waitFor(service, state) {
  for (let i = 0; i < 200; i++) {
    const value = await service.read();
    if (value.state === state) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error(`Did not reach ${state}`);
}

test("historical default settings retain saved findings, consent and failure history", async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return { output }; });
  try {
    const state = await f.service.configure(configured());
    const oldConnection = {
      baseUrl: "https://api.openai.com/v1",
      apiFormat: "responses",
      outputFormat: "json_schema",
      authMode: "bearer",
    };
    // This is the pre-controls serialization used by already-saved revisions.
    const legacySettingsHash = createHash("sha256").update(JSON.stringify([
      "chosen", oldConnection, INSIGHT_VERSION, PROMPT_VERSION,
    ])).digest("hex");
    const key = createHash("sha256").update(JSON.stringify([
      state.input.hash, legacySettingsHash,
    ])).digest("hex");
    const oldJob = {
      id: randomUUID(), comparisonId: state.input.comparisonId,
      inputHash: state.input.hash, key, model: "chosen", ...oldConnection,
      analyzerVersion: INSIGHT_VERSION, promptVersion: PROMPT_VERSION,
      createdAt: 1, endedAt: 2, state: "complete", output,
    };
    await writeFile(join(f.root, `job-${oldJob.id}.json`), JSON.stringify(oldJob), { mode: 0o600 });
    const restored = await f.service.read();
    assert.equal(restored.state, "no_findings");
    assert.equal(restored.settingsHash, legacySettingsHash);
    assert.equal(restored.analysis.id, oldJob.id);
    assert.equal(restored.analysis.reasoningEffort, "default");
    assert.equal(restored.analysis.maxOutputTokens, 6000);
    assert.equal(restored.analysis.timeoutSeconds, 90);
    const cached = await f.service.generate({ ...request(restored), settingsHash: legacySettingsHash });
    assert.equal(cached.state, "no_findings");
    assert.equal(calls, 0);

    const failedJob = { ...oldJob, id: randomUUID(), createdAt: 3, endedAt: 4, state: "failed", output: undefined, error: "provider_incomplete" };
    await writeFile(join(f.root, `job-${failedJob.id}.json`), JSON.stringify(failedJob), { mode: 0o600 });
    const failed = await createInsightService(f.options).read();
    assert.equal(failed.state, "failed");
    assert.equal(failed.error, "provider_incomplete");
    assert.equal(failed.diagnostics, null);
    assert.equal(failed.history[0].id, failedJob.id);
    assert.equal(failed.history[0].error, "provider_incomplete");
    assert.equal(failed.history[0].diagnostics, undefined);
    assert.equal(failed.history[1].id, oldJob.id);
    assert.equal(calls, 0);

    const changed = await f.service.configure(configured({ maxOutputTokens: 24000, timeoutSeconds: 300, reasoningEffort: "low" }));
    const currentConnection = { ...oldConnection, reasoningEffort: "low", maxOutputTokens: 24000, timeoutSeconds: 300 };
    const currentHash = createHash("sha256").update(JSON.stringify([
      "chosen", currentConnection, INSIGHT_VERSION, PROMPT_VERSION,
    ])).digest("hex");
    assert.equal(changed.settingsHash, currentHash);
    assert.equal(changed.state, "stale");
    assert.equal((await f.service.generate({ ...request(changed), settingsHash: legacySettingsHash })).error, "settings_changed");
  } finally { await f.cleanup(); }
});

test("completion settings bind consent, the saved request and cache identity", async () => {
  let calls = 0;
  let sent;
  const f = await fixture(async (args) => { calls++; sent = args; return { output }; });
  try {
    const first = await f.service.configure(configured());
    const oldRequest = request(first);
    await f.service.generate(oldRequest);
    await waitFor(f.service, "no_findings");
    let previous = await f.service.read();
    for (const controls of [
      { maxOutputTokens: 12000 },
      { maxOutputTokens: 12000, reasoningEffort: "low" },
      { maxOutputTokens: 12000, reasoningEffort: "low", timeoutSeconds: 150 },
      { maxOutputTokens: 12000, reasoningEffort: "none", timeoutSeconds: 150 },
    ]) {
      const changed = await f.service.configure(configured(controls));
      assert.equal(changed.ok, true);
      assert.equal(changed.state, "stale");
      assert.notEqual(changed.settingsHash, previous.settingsHash);
      assert.equal((await f.service.generate(request(previous))).error, "settings_changed");
      const freshRequest = request(changed);
      const expectedCalls = calls + 1;
      await f.service.generate(freshRequest);
      const done = await waitFor(f.service, "no_findings");
      assert.equal(calls, expectedCalls);
      assert.equal(sent.maxOutputTokens, 12000);
      assert.equal(done.analysis.maxOutputTokens, 12000);
      assert.equal(sent.reasoningEffort, controls.reasoningEffort ?? "default");
      assert.equal(done.analysis.reasoningEffort, controls.reasoningEffort ?? "default");
      const saved = JSON.parse(await readFile(join(f.root, `job-${freshRequest.requestId}.json`), "utf8"));
      assert.equal(saved.maxOutputTokens, 12000);
      assert.equal(saved.reasoningEffort, controls.reasoningEffort ?? "default");
      await f.service.generate(request(done));
      assert.equal(calls, expectedCalls);
      previous = done;
    }
    assert.equal(sent.reasoningEffort, "none");
    assert.equal(sent.timeoutSeconds, 150);
  } finally { await f.cleanup(); }
});

test("changing completion settings while a request runs cannot publish that result", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = await fixture(async () => { await gate; return { output }; });
  try {
    const first = await f.service.configure(configured());
    const start = request(first);
    await f.service.generate(start);
    const changed = await f.service.configure(configured({ reasoningEffort: "low" }));
    assert.equal(changed.ok, true);
    release();
    for (let i = 0; i < 200; i++) {
      const saved = JSON.parse(await readFile(join(f.root, `job-${start.requestId}.json`), "utf8"));
      if (saved.state === "stale") break;
      assert.notEqual(saved.state, "complete");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const saved = JSON.parse(await readFile(join(f.root, `job-${start.requestId}.json`), "utf8"));
    assert.equal(saved.state, "stale");
    assert.equal((await f.service.read()).analysis, null);
  } finally { release?.(); await f.cleanup(); }
});

test("incomplete diagnostics survive restart without retrying or exposing findings", async () => {
  let calls = 0;
  const f = await fixture((args) => analyzeOpenAI({
    ...args,
    fetchImpl: async () => {
      calls++;
      return reply("responses", { status: "incomplete", output: [], usage: { output_tokens: 6000, output_tokens_details: { reasoning_tokens: 6000 } } });
    },
  }));
  try {
    const state = await f.service.configure(configured());
    const start = request(state);
    await f.service.generate(start);
    const failed = await waitFor(f.service, "failed");
    assert.deepEqual(failed.diagnostics, { status: "incomplete", outputTokens: 6000, reasoningTokens: 6000, answerCharacters: 0 });
    assert.equal(failed.analysis, null);
    assert.equal(failed.history[0].error, "provider_incomplete");
    assert.deepEqual(failed.history[0].diagnostics, failed.diagnostics);
    const restarted = createInsightService(f.options);
    assert.deepEqual((await restarted.read()).diagnostics, failed.diagnostics);
    await restarted.generate(start);
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("service sanitizes diagnostic objects both before persistence and before exposing saved state", async () => {
  const malicious = { status: "private status", finishReason: "length", outputTokens: 6000, reasoningTokens: -1, answerCharacters: 0, body: "private payload" };
  const f = await fixture(async () => { throw Object.assign(Error("provider_incomplete"), { diagnostics: malicious }); });
  try {
    const start = request(await f.service.configure(configured()));
    await f.service.generate(start);
    const failed = await waitFor(f.service, "failed");
    const expected = { finishReason: "length", outputTokens: 6000, answerCharacters: 0 };
    assert.deepEqual(failed.diagnostics, expected);
    const file = join(f.root, `job-${start.requestId}.json`);
    const text = await readFile(file, "utf8");
    assert.ok(!text.includes("private payload"));
    const saved = JSON.parse(text);
    saved.diagnostics = malicious;
    saved.error = "private error";
    await writeFile(file, JSON.stringify(saved));
    const reread = await f.service.read();
    assert.deepEqual(reread.diagnostics, expected);
    assert.deepEqual(reread.history[0].diagnostics, expected);
    assert.ok(!JSON.stringify(reread).includes("private"));
  } finally { await f.cleanup(); }
});

test("schema-rejected answers retain sanitized completion diagnostics without publishing output", async () => {
  const f = await fixture(async () => ({
    output: { findings: [{ fabricated: true }], abstentionReason: "" },
    diagnostics: { finishReason: "stop", outputTokens: 80, reasoningTokens: 40, body: "private provider body" },
  }));
  try {
    const start = request(await f.service.configure(configured()));
    await f.service.generate(start);
    const failed = await waitFor(f.service, "failed");
    assert.equal(failed.error, "analysis_validation_failed");
    assert.deepEqual(failed.diagnostics, { finishReason: "stop", outputTokens: 80, reasoningTokens: 40 });
    assert.equal(failed.analysis, null);
    const saved = JSON.parse(await readFile(join(f.root, `job-${start.requestId}.json`), "utf8"));
    assert.equal(saved.output, undefined);
    assert.ok(!JSON.stringify(saved).includes("private provider body"));
  } finally { await f.cleanup(); }
});

test("the configured timeout aborts the request and sets the matching job deadline", async (context) => {
  let aborted = false;
  const f = await fixture(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(Error("analysis_timeout")); }, { once: true });
  }));
  try {
    const state = await f.service.configure(configured({ timeoutSeconds: 30 }));
    assert.equal(state.ok, true);
    const start = request(state);
    context.mock.timers.enable({ apis: ["setTimeout"] });
    await f.service.generate(start);
    const saved = JSON.parse(await readFile(join(f.root, `job-${start.requestId}.json`), "utf8"));
    assert.equal(saved.deadlineAt - saved.createdAt, 35000);
    context.mock.timers.tick(29999);
    assert.equal(aborted, false);
    context.mock.timers.tick(1);
    assert.equal(aborted, true);
    context.mock.timers.reset();
    assert.equal((await waitFor(f.service, "failed")).error, "analysis_timeout");
  } finally { context.mock.timers.reset(); await f.cleanup(); }
});
