import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { projectReviewedFindings } from "../server/comparison-findings.mjs";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const comparison: any = {
    id: "pair",
    manifestHash: "manifest",
    ready: true,
    attempts: ["sol", "terra"].map((key) => ({
      key,
      model: key,
      reasoningEffort: "high",
      snapshotHash: key + "-tree",
      run: {
        id: key + "-run",
        git: {
          artifactId: key + "-artifact",
          files: [
            {
              path: "reader.ts",
              content: "header\n+" + key + " implementation\nfooter",
              truncated: false,
            },
          ],
        },
        events: [],
      },
    })),
  };
  const review: any = {
    id: "review-v1",
    comparisonId: "pair",
    manifestHash: "manifest",
    method: "AI-assisted analysis",
    attempts: ["sol", "terra"].map((key) => ({
      key,
      runId: key + "-run",
      snapshotHash: key + "-tree",
      model: key,
      reasoningEffort: "high",
    })),
    findings: [
      {
        id: "approach",
        category: "Implementation",
        title: "Different approaches",
        summary: "Different structure",
        interpretation: "Review the tradeoff",
        limitations: "No general winner",
        sides: ["sol", "terra"].map((key) => ({
          attemptKey: key,
          observation: key + " observation",
          sources: [
            {
              id: key + "-source",
              kind: "file",
              path: "reader.ts",
              label: "Reader change",
              artifactId: key + "-artifact",
              sha256: digest("header\n+" + key + " implementation\nfooter"),
              fromLine: 2,
              toLine: 2,
            },
          ],
        })),
      },
    ],
  };
  return { comparison, review };
}
test("analysis stays bound to its reviewed runs even when input order changes", () => {
  const { comparison, review } = fixture();
  comparison.attempts.reverse();
  const r = projectReviewedFindings(comparison, review);
  assert.equal(r.state, "available");
  assert.equal(r.findings[0].sides[0].model, "sol");
  assert.equal(
    r.findings[0].sides[1].sources[0].excerpt,
    "+terra implementation",
  );
  assert.equal(r.findings[0].interpretation, "Review the tradeoff");
  assert.equal("passed" in r.findings[0], false);
});
test("another manifest or final snapshot cannot inherit these conclusions", () => {
  const { comparison, review } = fixture();
  comparison.manifestHash = "different";
  assert.equal(
    projectReviewedFindings(comparison, review).state,
    "unavailable",
  );
  comparison.manifestHash = "manifest";
  comparison.attempts[0].snapshotHash = "changed";
  assert.equal(
    projectReviewedFindings(comparison, review).state,
    "unavailable",
  );
});
test("changed, missing or truncated source hides its interpretation", () => {
  for (const change of ["changed", "missing", "truncated"]) {
    const { comparison, review } = fixture();
    const files = comparison.attempts[0].run.git.files;
    if (change === "changed") files[0].content = "changed";
    if (change === "missing") files.length = 0;
    if (change === "truncated") files[0].truncated = true;
    const r = projectReviewedFindings(comparison, review);
    assert.equal(r.state, "unavailable");
    assert.deepEqual(r.findings, []);
  }
});
test("changed independent outcomes or artifact identities withhold the analysis", () => {
  for (const change of ["outcome", "artifactSha256"]) {
    const { comparison, review } = fixture();
    comparison.attempts[0].checks = [
      { id: "regression", outcome: "passed", artifactSha256: "original" },
    ];
    review.attempts[0].checks = comparison.attempts[0].checks.map((c: any) => ({
      ...c,
    }));
    assert.equal(
      projectReviewedFindings(comparison, review).state,
      "available",
    );
    comparison.attempts[0].checks[0][change] = "changed";
    assert.equal(
      projectReviewedFindings(comparison, review).state,
      "unavailable",
    );
  }
});
test("an unfinished pair or a different model cannot inherit the analysis", () => {
  const { comparison, review } = fixture();
  comparison.ready = false;
  assert.equal(
    projectReviewedFindings(comparison, review).state,
    "unavailable",
  );
  comparison.ready = true;
  comparison.attempts[0].model = "another-model";
  assert.equal(
    projectReviewedFindings(comparison, review).state,
    "unavailable",
  );
});
test("duplicate source identity and invalid excerpt range are rejected", () => {
  const { comparison, review } = fixture();
  const source = review.findings[0].sides[0].sources[0];
  source.toLine = 100;
  assert.equal(
    projectReviewedFindings(comparison, review).state,
    "unavailable",
  );
  source.toLine = 2;
  review.findings[0].sides[0].sources.push({ ...source });
  assert.equal(
    projectReviewedFindings(comparison, review).state,
    "unavailable",
  );
});
test("recorded failure cannot silently become a success beneath a finding", () => {
  const { comparison, review } = fixture();
  comparison.attempts[0].run.events = [
    {
      id: "event-1",
      sequence: 5,
      kind: "command",
      provenance: "observed",
      status: "failed",
      command: "run tests",
      output: "blocked",
      message: "",
      exitCode: 1,
      outputState: "available",
    },
  ];
  const source = {
    id: "event-source",
    kind: "event",
    eventId: "event-1",
    sequence: 5,
    label: "Blocked validation",
    sha256: digest(
      '{"kind":"command","provenance":"observed","status":"failed","command":"run tests","output":"blocked","message":"","exitCode":1}',
    ),
    fromLine: 1,
    toLine: 1,
  };
  review.findings[0].sides[0].sources = [source];
  assert.equal(
    projectReviewedFindings(comparison, review).findings[0].sides[0].sources[0]
      .exitCode,
    1,
  );
  comparison.attempts[0].run.events[0].exitCode = 0;
  assert.equal(
    projectReviewedFindings(comparison, review).state,
    "unavailable",
  );
});
