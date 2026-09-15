import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInsightService } from "../server/insights/service.mjs";
import { buildSupportUnits, buildSupportEvidence } from "../server/insights/support-schema.mjs";
import { makePair, makeFinding } from "./fixtures/insight-comparisons.mjs";
import { buildInsightBundle } from "../server/insights/evidence.mjs";

test("support consent exposes exact selected attempt facts without starting a review", async () => {
  const f = await fixture();
  try {
    const state = await f.service.read();
    const bundle = buildInsightBundle(makePair());
    assert.deepEqual(state.input.attemptFacts.map(({ attemptKey, text }) => ({ attemptKey, text })),
      bundle.attempts.map(attempt => ({ attemptKey: attempt.key, text: JSON.stringify(attempt, null, 2) })));
    assert.deepEqual(state.input.sourceDetails,
      buildSupportEvidence(bundle).filter(record => record.sourceId !== null).map(record => ({ sourceId: record.sourceId, label: record.label, text: record.metadataText })));
    assert.equal(typeof state.input.sourceDetails[0].text, "string");
    assert.equal(JSON.parse(state.input.sourceDetails[0].text).provenance, bundle.sources[0].provenance);
    assert.equal(state.input.taskContext, JSON.stringify(bundle.task, null, 2));
    assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});

const supported = (draft, bundle = buildInsightBundle(makePair())) => ({
  assessments: buildSupportUnits(draft).map(unit => ({
    unitId: unit.id,
    claims: [{ text: unit.text, verdict: "supported",
      reason: "Offline fixture for persistence; no semantic validation is claimed.",
      passages: ["S1:t1"],
    }],
  })),
});
async function until(service, predicate) {
  for (let i = 0; i < 200; i++) {
    const state = await service.read();
    if (predicate(state)) return state;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Expected service state was not reached");
}
async function fixture(
  review = async ({ draft }) => ({ output: supported(draft) }),
  makeDraft = makeFinding,
) {
  const root = await mkdtemp(join(tmpdir(), "insight-support-"));
  let calls = 0;
  const options = {
    root,
    readComparison: async () => ({ ok: true, comparison: makePair() }),
    credentialStore: {
      has: async () => true,
      get: async () => "fixture-key",
      set: async () => {},
      remove: async () => {},
    },
    analyze: async ({ bundle }) => ({ output: makeDraft(bundle) }),
    review: async (args) => {
      calls++;
      return review(args);
    },
  };
  const service = createInsightService(options);
  const ready = await service.configure({ model: "chosen", enabled: true });
  const draftId = randomUUID();
  await service.generate({
    inputHash: ready.input.hash,
    settingsHash: ready.settingsHash,
    requestId: draftId,
  });
  const state = await until(service, (s) => s.state === "available");
  return {
    root,
    service,
    options,
    state,
    draftId,
    calls: () => calls,
    request: () => ({
      analysisId: state.analysis.id,
      inputHash: state.input.hash,
      settingsHash: state.settingsHash,
      reviewKey: state.support?.reviewKey,
      requestId: randomUUID(),
    }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("support review is explicit, preserves the draft and survives a pure reload", async () => {
  const f = await fixture();
  try {
    assert.equal(f.state.support?.state, "not_reviewed");
    const file = join(f.root, `job-${f.draftId}.json`),
      original = await readFile(file, "utf8");
    await f.service.read();
    assert.equal(f.calls(), 0);
    const request = f.request();
    await f.service.reviewSupport(request);
    const done = await until(
      f.service,
      (s) => s.support?.state === "available",
    );
    assert.equal(done.support.review.findings[0].verdict, "supported");
    assert.equal(done.history.length, 1);
    assert.equal(await readFile(file, "utf8"), original);
    const reloaded = await createInsightService(f.options).read();
    assert.equal(reloaded.support.review.id, request.requestId);
    assert.equal(f.calls(), 1);
  } finally {
    await f.cleanup();
  }
});

test("changed review consent and renderer-supplied evidence never reach the provider", async () => {
  const f = await fixture();
  try {
    assert.equal(typeof f.service.reviewSupport, "function");
    for (const change of [
      { reviewKey: "wrong" },
      { analysisId: randomUUID() },
      { inputHash: "wrong" },
      { settingsHash: "wrong" },
      { draft: {} },
      { bundle: {} },
    ]) {
      const result = await f.service.reviewSupport({
        ...f.request(),
        ...change,
      });
      assert.equal(result.ok, false);
    }
    assert.equal(f.calls(), 0);
  } finally {
    await f.cleanup();
  }
});

test("review requests are deduplicated and failures do not publish verdicts or retry", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(async () => {
    await gate;
    throw Object.assign(Error("provider_incomplete"), {
      diagnostics: {
        finishReason: "length",
        answerCharacters: 0,
        outputTokens: 6000,
        private: "do not save",
      },
    });
  });
  try {
    assert.equal(typeof f.service.reviewSupport, "function");
    const request = f.request();
    await Promise.all([
      f.service.reviewSupport(request),
      f.service.reviewSupport({
        ...request,
        requestId: request.requestId.toUpperCase(),
      }),
    ]);
    await f.service.reviewSupport({ ...request, requestId: randomUUID() });
    assert.equal(f.calls(), 1);
    release();
    const failed = await until(f.service, (s) => s.support?.state === "failed");
    assert.equal(failed.support.review, null);
    assert.equal(failed.support.error, "provider_incomplete");
    assert.deepEqual(failed.support.diagnostics, {
      finishReason: "length",
      outputTokens: 6000,
      answerCharacters: 0,
    });
    await createInsightService(f.options).read();
    await f.service.reviewSupport(request);
    assert.equal(f.calls(), 1);
    const saved = JSON.parse(
      await readFile(join(f.root, `support-${request.requestId}.json`), "utf8"),
    );
    assert.equal(saved.output, undefined);
    assert.equal(saved.diagnostics.private, undefined);
  } finally {
    release();
    await f.cleanup();
  }
});

test("late support results become stale after a new draft replaces the reviewed one", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(async ({ draft }) => {
    await gate;
    return { output: supported(draft) };
  });
  try {
    assert.equal(typeof f.service.reviewSupport, "function");
    const request = f.request();
    await f.service.reviewSupport(request);
    await f.service.generate({
      inputHash: f.state.input.hash,
      settingsHash: f.state.settingsHash,
      requestId: randomUUID(),
      regenerate: true,
    });
    const newer = await until(
      f.service,
      (s) => s.state === "available" && s.analysis.id !== f.draftId,
    );
    release();
    for (let i = 0; i < 200; i++) {
      const saved = JSON.parse(
        await readFile(
          join(f.root, `support-${request.requestId}.json`),
          "utf8",
        ),
      );
      if (saved.state !== "running") {
        assert.equal(saved.state, "stale");
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
      if (i === 199) assert.fail("Support stayed running");
    }
    const current = await f.service.read();
    assert.equal(current.analysis.id, newer.analysis.id);
    assert.equal(current.support.state, "not_reviewed");
    assert.equal(current.support.review, null);
  } finally {
    release();
    await f.cleanup();
  }
});

test("invalid or incomplete verdict sets fail closed without exposing a reviewed finding", async () => {
  const f = await fixture(async () => ({ output: { findings: [] } }));
  try {
    assert.equal(typeof f.service.reviewSupport, "function");
    await f.service.reviewSupport(f.request());
    const failed = await until(f.service, (s) => s.support?.state === "failed");
    assert.equal(failed.support.error, "support_validation_failed");
    assert.equal(failed.support.review, null);
    assert.equal(failed.analysis.findings.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("changed raw draft output invalidates cached support and old consent without mutating files on read", async () => {
  const f = await fixture();
  try {
    const request = f.request();
    await f.service.reviewSupport(request);
    await until(f.service, (s) => s.support?.state === "available");
    const path = join(f.root, `job-${f.draftId}.json`),
      job = JSON.parse(await readFile(path, "utf8"));
    job.output.findings[0].summary =
      "A revised claim requires its own support review.";
    await writeFile(path, JSON.stringify(job), { mode: 0o600 });
    const snapshot = async () =>
      Promise.all(
        (await readdir(f.root))
          .sort()
          .map(async (name) => ({
            name,
            text: await readFile(join(f.root, name), "utf8"),
            mtime: (await stat(join(f.root, name))).mtimeMs,
          })),
      );
    const before = await snapshot();
    const current = await f.service.read();
    assert.equal(current.state, "available");
    assert.equal(current.support.state, "stale");
    assert.equal(current.support.review, null);
    assert.notEqual(current.support.reviewKey, request.reviewKey);
    await createInsightService(f.options).read();
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      (await f.service.reviewSupport({ ...request, requestId: randomUUID() }))
        .ok,
      false,
    );
    assert.equal(f.calls(), 1);
  } finally {
    await f.cleanup();
  }
});

test("settings changed during review make late verdicts stale and browser runtimes cannot start reviews", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(async ({ draft }) => {
    await gate;
    return { output: supported(draft) };
  });
  try {
    const request = f.request();
    const browser = createInsightService({
      ...f.options,
      desktopRequired: true,
    });
    assert.equal((await browser.reviewSupport(request)).ok, false);
    assert.equal(f.calls(), 0);
    await f.service.reviewSupport(request);
    await f.service.configure({ model: "changed-model", enabled: true });
    release();
    for (let i = 0; i < 200; i++) {
      const saved = JSON.parse(
        await readFile(
          join(f.root, `support-${request.requestId}.json`),
          "utf8",
        ),
      );
      if (saved.state !== "running") {
        assert.equal(saved.state, "stale");
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
      if (i === 199) assert.fail("Support stayed running");
    }
    const current = await f.service.read();
    assert.equal(current.state, "stale");
    assert.equal(current.support, null);
    assert.equal(f.calls(), 1);
  } finally {
    release();
    await f.cleanup();
  }
});

test("malformed saved support is withheld while the original draft stays available", async () => {
  const f = await fixture();
  try {
    const request = f.request();
    await f.service.reviewSupport(request);
    await until(f.service, (s) => s.support?.state === "available");
    const path = join(f.root, `support-${request.requestId}.json`),
      job = JSON.parse(await readFile(path, "utf8"));
    job.output.findings = [];
    await writeFile(path, JSON.stringify(job), { mode: 0o600 });
    const current = await createInsightService(f.options).read();
    assert.equal(current.state, "available");
    assert.equal(current.support.state, "failed");
    assert.equal(current.support.review, null);
    assert.equal(f.calls(), 1);
  } finally {
    await f.cleanup();
  }
});


test("older support versions stay immutable and cannot promote findings", async () => {
  const f = await fixture();
  try {
    const request = f.request();
    await f.service.reviewSupport(request);
    await until(f.service, s => s.support?.state === "available");
    const file = join(f.root, `support-${request.requestId}.json`);
    const old = JSON.parse(await readFile(file, "utf8"));
    old.version = "support-v2";
    old.promptVersion = "evidence-support-v2";
    // Even a forged current key cannot promote an older wire format.
    old.output = { assessments: [] };
    await writeFile(file, JSON.stringify(old), { mode: 0o600 });
    const before = await readFile(file, "utf8"), timestamp = (await stat(file)).mtimeMs;
    const state = await createInsightService(f.options).read();
    assert.equal(state.support.state, "stale");
    assert.equal(state.support.review, null);
    assert.equal(state.analysis.id, f.draftId);
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal((await stat(file)).mtimeMs, timestamp);
    assert.equal(f.calls(), 1);
  } finally { await f.cleanup(); }
});

test("invented saved passage ID is withheld on reload without altering the original draft", async () => {
  const f = await fixture();
  try {
    const draftFile = join(f.root, `job-${f.draftId}.json`);
    const original = await readFile(draftFile, "utf8");
    const request = f.request();
    await f.service.reviewSupport(request);
    const done = await until(f.service, s => s.support?.state === "available");
    assert.equal(done.support.review.findings[0].claims.length, 7);
    const file = join(f.root, `support-${request.requestId}.json`);
    const record = JSON.parse(await readFile(file, "utf8"));
    record.output.assessments[0].claims[0].passages[0] = "S1:t999999";
    await writeFile(file, JSON.stringify(record), { mode: 0o600 });
    const state = await createInsightService(f.options).read();
    assert.equal(state.support.state, "failed");
    assert.equal(state.support.review, null);
    assert.equal(await readFile(draftFile, "utf8"), original);
    assert.equal(f.calls(), 1);
  } finally { await f.cleanup(); }
});

// Regression: a structurally valid AI verdict must not promote an ungrounded import relationship.
test("local import gate withholds an AI-supported relationship and preserves its original review", async () => {
  const f = await fixture(undefined, bundle => {
    const draft = makeFinding(bundle);
    draft.findings[0].sides[0].observation = "South imports both QUEUE_LIMIT and warnOverflow from \"./policy\" into src/entry.ts.";
    return draft;
  });
  try {
    const request = f.request();
    await f.service.reviewSupport(request);
    const done = await until(f.service, s => s.support?.state === "available");
    const finding = done.support.review.findings[0];
    assert.equal(finding.verdict, "needs_review");
    const claim = finding.claims.find(c => c.field === "sides[0].observation");
    assert.equal(claim.attemptKey, "south");
    assert.equal(claim.providerAssessment.verdict, "supported");
    assert.equal(claim.localCheck.status, "unknown");
    const savedPath = join(f.root, `support-${request.requestId}.json`);
    const original = await readFile(savedPath, "utf8");
    const saved = JSON.parse(original);
    assert.equal(saved.output.assessments.find(a => a.unitId === claim.unitId).claims[0].verdict, "supported");
    const reload = await createInsightService(f.options).read();
    assert.deepEqual(reload.support.review.findings, done.support.review.findings);
    assert.equal(await readFile(savedPath, "utf8"), original);
  } finally { await f.cleanup(); }
});

test("provider partitions inside import words cannot bypass the local policy", async () => {
  const f = await fixture(async ({draft}) => {
    const output = supported(draft);
    const unit = output.assessments.find(a => a.unitId === "f0:observation:0");
    const template = unit.claims[0];
    unit.claims = ["South imp", 'orts both QUEUE_LIMIT and warnOverflow from "./policy" into src/entry.ts.'].map(text => ({...template, text}));
    return {output};
  }, bundle => {
    const draft = makeFinding(bundle);
    draft.findings[0].sides[0].observation = 'South imports both QUEUE_LIMIT and warnOverflow from "./policy" into src/entry.ts.';
    return draft;
  });
  try {
    await f.service.reviewSupport(f.request());
    const done = await until(f.service, s => s.support?.state === "available");
    assert.equal(done.support.review.findings[0].verdict, "needs_review");
    const split = done.support.review.findings[0].claims.filter(c => c.unitId === "f0:observation:0");
    assert.equal(split.length, 2);
    assert.ok(split.every(c => c.localCheck?.status === "unknown"));
  } finally { await f.cleanup(); }
});
