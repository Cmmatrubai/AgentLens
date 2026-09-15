import test from "node:test";
import assert from "node:assert/strict";
import { makePair } from "./fixtures/insight-comparisons.mjs";
import { parseSelectedComparison } from "../server/live/selection.mjs";
import { parseComparisonBundle } from "../server/insights/import-pair.mjs";

test("locally recorded selection keeps recorder provenance and absent checks unknown", () => {
  const pair = makePair();
  pair.checks = [];
  pair.attempts.forEach((a: any) => {
    a.checks = [];
    a.evaluatedAt = null;
    a.controlNotes = ["Recorded locally"];
    a.coverageLimits = ["No independent evaluator"];
  });
  const selected = parseSelectedComparison({
    source: "desktop-recording",
    comparison: pair,
  });
  assert.equal(selected.imported, false);
  assert.equal(selected.desktopRecorded, true);
  assert.equal(selected.ready, false);
  assert.deepEqual(selected.attempts[0].controlNotes, ["Recorded locally"]);
  assert.equal(parseSelectedComparison(pair).imported, true);
  assert.notEqual(
    parseSelectedComparison({ ...pair, desktopRecorded: true }).desktopRecorded,
    true,
  );
});

test("an imported nested envelope cannot impersonate a desktop recording on reopen", () => {
  const pair = makePair();
  const savedImport = parseComparisonBundle(
    JSON.stringify({
      comparison: {
        ...pair,
        source: "desktop-recording",
        comparison: pair,
      },
    }),
  );
  const reopened = parseSelectedComparison(savedImport);
  assert.equal(reopened.imported, true);
  assert.equal(reopened.desktopRecorded, false);
  assert.deepEqual(
    reopened.attempts[0].controlNotes,
    savedImport.attempts[0].controlNotes,
  );
});
