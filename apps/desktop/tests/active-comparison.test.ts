import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSelectedComparison } from "../server/insights/runtime.mjs";
import { privateWrite } from "../server/insights/private-files.mjs";
import { makePair } from "./fixtures/insight-comparisons.mjs";

async function root(t: any) {
  const path = await mkdtemp(join(tmpdir(), "agentlens-selection-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
test("a new workspace returns no selection instead of the development case", async (t) => {
  assert.deepEqual(await readSelectedComparison(await root(t)), {
    ok: false,
    error: "comparison_not_selected",
  });
});
test("damaged saved evidence is preserved and never replaced with example results", async (t) => {
  const path = await root(t);
  await writeFile(join(path, "selected-pair.json"), "{damaged");
  assert.deepEqual(await readSelectedComparison(path), {
    ok: false,
    error: "comparison_unavailable",
  });
  assert.equal(
    await readFile(join(path, "selected-pair.json"), "utf8"),
    "{damaged",
  );
});
test("a selected personal recording retains its own task and absent checks", async (t) => {
  const path = await root(t),
    pair = makePair();
  pair.title = "My own task";
  pair.taskPrompt = "Validate my implementation";
  pair.checks = [];
  for (const a of pair.attempts) {
    a.checks = [];
    a.evaluatedAt = null;
  }
  await privateWrite(path, "selected-pair.json", {
    source: "desktop-recording",
    comparison: pair,
  });
  const result = await readSelectedComparison(path);
  assert.equal(result.ok, true);
  assert.equal(result.comparison.title, "My own task");
  assert.deepEqual(result.comparison.checks, []);
  assert.equal(result.comparison.ready, false);
  assert.equal(result.comparison.desktopRecorded, true);
});
test("supplied evaluation results retain their import provenance", async (t) => {
  const path = await root(t);
  await privateWrite(path, "selected-pair.json", makePair());
  const result = await readSelectedComparison(path);
  assert.equal(result.ok, true);
  assert.equal(result.comparison.imported, true);
  assert.equal(result.comparison.desktopRecorded, false);
  assert.match(
    result.comparison.attempts[0].controlNotes.join(" "),
    /supplied by its author/,
  );
});

test("evaluation import rejects recordings without evaluated checks", async () => {
  const { parseEvaluatedComparisonBundle } =
    await import("../server/insights/import-pair.mjs");
  const pair = makePair();
  pair.checks = [];
  for (const a of pair.attempts) {
    a.checks = [];
    a.evaluatedAt = null;
  }
  assert.throws(
    () => parseEvaluatedComparisonBundle(JSON.stringify(pair)),
    /evaluation_missing/,
  );
});
test("evaluation import accepts supplied results and retains import provenance", async () => {
  const { parseEvaluatedComparisonBundle } =
    await import("../server/insights/import-pair.mjs");
  const pair = makePair();
  const parsed = parseEvaluatedComparisonBundle(JSON.stringify(pair));
  assert.equal(parsed.imported, true);
  assert.ok(parsed.checks.length > 0);
  assert.ok(parsed.attempts.some((a: any) => Number.isFinite(a.evaluatedAt)));
});

test("rejecting an unevaluated import leaves the selected comparison byte-for-byte intact", async (t) => {
  const { selectComparison } = await import("../server/insights/runtime.mjs");
  const path = await root(t);
  await privateWrite(path, "selected-pair.json", makePair());
  const before = await readFile(join(path, "selected-pair.json"), "utf8");
  const incoming = makePair();
  incoming.checks = [];
  for (const a of incoming.attempts) {
    a.checks = [];
    a.evaluatedAt = null;
  }
  await assert.rejects(
    selectComparison(JSON.stringify(incoming), {
      root: path,
      requireChecks: true,
    }),
    /evaluation_missing/,
  );
  assert.equal(
    await readFile(join(path, "selected-pair.json"), "utf8"),
    before,
  );
});
test("evaluated import is persisted with author-supplied provenance and can be reopened", async (t) => {
  const { selectComparison } = await import("../server/insights/runtime.mjs");
  const path = await root(t),
    pair = makePair();
  pair.title = "Supplied evaluation";
  await selectComparison(JSON.stringify(pair), {
    root: path,
    requireChecks: true,
  });
  const reopened = await readSelectedComparison(path);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.comparison.title, "Supplied evaluation");
  assert.equal(reopened.comparison.imported, true);
  assert.equal(reopened.comparison.checks.length, pair.checks.length);
});
