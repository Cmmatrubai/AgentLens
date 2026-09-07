import { displayText } from "./recorded-projector.mjs";
import { projectReviewedFindings } from "./comparison-findings.mjs";
import review from "./c01-review.mjs";
const names = {
  "stdout-64mib": "Discard oversized stdout safely",
  "stderr-64mib": "Discard oversized stderr safely",
  "byte-limit-crlf": "Honor the byte limit and CRLF",
  "utf8-tail": "Preserve text and final records",
  backpressure: "Apply callback backpressure",
  "inherited-suite-with-declared-supplement":
    "Pass the independent regression suite",
  typecheck: "Pass TypeScript checks",
};
export function projectComparison(manifest, sources) {
  if (
    !manifest?.manifestHash ||
    manifest.attempts?.length !== 2 ||
    !Array.isArray(manifest.checks) ||
    new Set(manifest.checks).size !== manifest.checks.length
  )
    throw new Error("Invalid comparison manifest");
  if (new Set(sources.map((a) => a.key)).size !== sources.length)
    throw new Error("Duplicate attempt identity");
  const attempts = manifest.attempts.map((expected) => {
    const source = sources.find((a) => a.key === expected.key);
    const launch = source?.launch,
      run = source?.run ?? null,
      evaluation = source?.evaluation;
    if (
      launch &&
      (launch.manifestHash !== manifest.manifestHash ||
        launch.model !== expected.model ||
        launch.reasoningEffort !== expected.reasoningEffort)
    )
      throw new Error("Attempt manifest mismatch");
    if (
      run &&
      (!launch ||
        run.id !== source.result?.result?.runId ||
        run.git.initialHead !== manifest.baseCommit)
    )
      throw new Error("Recorded identity or base mismatch");
    if (
      evaluation &&
      (!run ||
        evaluation.manifestHash !== manifest.manifestHash ||
        evaluation.runId !== run.id ||
        !evaluation.snapshotHash)
    )
      throw new Error("Evaluator identity mismatch");
    const supplied = evaluation?.checks ?? [];
    if (
      new Set(supplied.map((c) => c.id)).size !== supplied.length ||
      supplied.some((c) => !manifest.checks.includes(c.id))
    )
      throw new Error("Invalid comparison check identity");
    const checks = manifest.checks.map((id) => {
      const c = supplied.find((c) => c.id === id);
      if (
        c &&
        (!["pass", "fail", "unknown"].includes(c.outcome) ||
          (c.outcome !== "unknown" &&
            (!c.artifactSha256 || typeof c.output !== "string")))
      )
        throw new Error("Missing evaluator evidence");
      return {
        id,
        title: names[id] ?? c?.title ?? id,
        outcome: c?.outcome ?? "unknown",
        output: displayText(
          c?.output ??
            "Independent evaluation has not produced evidence for this check.",
        ),
        artifactSha256: c?.artifactSha256 ?? null,
        command: displayText(c?.command ?? ""),
        durationMs: c?.durationMs ?? null,
        outputTruncated: !!c?.outputTruncated,
      };
    });
    return {
      key: expected.key,
      model: expected.model,
      reasoningEffort: expected.reasoningEffort,
      state: source?.state ?? "pending",
      run,
      elapsedMs: run?.elapsedMs ?? null,
      checks,
      passed: checks.filter((c) => c.outcome === "pass").length,
      failed: checks.filter((c) => c.outcome === "fail").length,
      unknown: checks.filter((c) => c.outcome === "unknown").length,
      snapshotHash: evaluation?.snapshotHash ?? null,
      evaluatedAt: evaluation?.endedAt ?? null,
      eventCount: run?.eventCount ?? source?.eventCount ?? 0,
      controlNotes: (evaluation?.controlNotes ?? []).map(displayText),
      coverageLimits: (evaluation?.coverageLimits ?? []).map(displayText),
    };
  });
  const comparison = {
    schemaVersion: 1,
    id: manifest.id,
    title: manifest.title,
    manifestHash: manifest.manifestHash,
    baseCommit: manifest.baseCommit,
    timeoutMs: manifest.timeoutMs,
    promptHash: manifest.inputs["experiments/C01/prompt.md"],
    checkBundleHash: manifest.inputs["experiments/C01/independent.test.ts"],
    attempts,
    ready: attempts.every((a) => a.run && Number.isFinite(a.evaluatedAt)),
    checks: manifest.checks.map((id) => ({ id, title: names[id] ?? id })),
    startupFailures: (manifest.startupFailures ?? []).map((f) => ({
      model: f.key,
      runId: f.runId,
      reason: displayText(f.reason),
    })),
    fetchedAt: Date.now(),
  };
  return { ...comparison, review: projectReviewedFindings(comparison, review) };
}
