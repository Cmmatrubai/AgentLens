import { buildInsightBundle } from "./evidence.mjs";
export const MAX_PAIR_BYTES = 16 * 1024 * 1024;
function appendDisclosure(notes, notice) {
  if (
    notes !== undefined &&
    (!Array.isArray(notes) || notes.some((note) => typeof note !== "string"))
  )
    throw Error("invalid_comparison_disclosures");
  return [...new Set([...(notes ?? []), notice])];
}
export function parseComparisonBundle(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_PAIR_BYTES)
    throw Error("invalid_comparison_bundle");
  const raw = JSON.parse(text);
  const c = raw?.comparison ?? raw;
  if (
    !c ||
    c.schemaVersion !== 1 ||
    typeof c.title !== "string" ||
    !c.title.trim() ||
    c.title.length > 300 ||
    typeof c.taskPrompt !== "string" ||
    !c.taskPrompt.trim() ||
    c.taskPrompt.length > 20000 ||
    !Array.isArray(c.attempts) ||
    c.attempts.length !== 2
  )
    throw Error("invalid_comparison_bundle");
  const planned = c.checks ?? [];
  if (
    !Array.isArray(planned) ||
    planned.some(
      (check) =>
        !check ||
        typeof check.id !== "string" ||
        !check.id.trim() ||
        typeof check.title !== "string" ||
        !check.title.trim(),
    ) ||
    new Set(planned.map((check) => check.id)).size !== planned.length
  )
    throw Error("invalid_check_plan");
  const bundle = buildInsightBundle(c);
  if (!bundle.eligible) throw Error("ineligible_comparison_bundle");
  const attempts = c.attempts.map((a) => {
    if (
      !Array.isArray(a.checks) ||
      !Array.isArray(a.run.events) ||
      !Array.isArray(a.run.git.files)
    )
      throw Error("invalid_comparison_bundle");
    const checks = a.checks.map((x) => {
      if (
        (x.outputAvailable !== undefined &&
          typeof x.outputAvailable !== "boolean") ||
        !["pass", "fail", "unknown"].includes(x.outcome) ||
        typeof x.title !== "string" ||
        typeof x.output !== "string"
      )
        throw Error("invalid_check");
      const fact = bundle.attempts
        .find((attempt) => attempt.key === a.key)
        ?.facts.checks.find((check) => check.id === x.id);
      return { ...x, outcome: fact?.outcome ?? "unknown" };
    });
    return {
      ...a,
      checks,
      elapsedMs: a.run.elapsedMs ?? null,
      eventCount: a.run.events.length,
      passed: checks.filter((c) => c.outcome === "pass").length,
      failed: checks.filter((c) => c.outcome === "fail").length,
      unknown: checks.filter((c) => c.outcome === "unknown").length,
      controlNotes: appendDisclosure(
        a.controlNotes,
        "Imported comparison: identities and provenance were supplied by its author.",
      ),
      coverageLimits: appendDisclosure(
        a.coverageLimits,
        "AgentLens validated bundle structure and local source associations, not the original recording process.",
      ),
    };
  });
  const checks = [
    ...new Map(
      [...attempts.flatMap((a) => a.checks), ...planned].map((c) => [
        c.id,
        { id: c.id, title: c.title },
      ]),
    ).values(),
  ];
  return {
    ...c,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      unknown:
        attempt.unknown +
        checks.filter(
          (check) => !attempt.checks.some((saved) => saved.id === check.id),
        ).length,
    })),
    checks,
    imported: true,
    ready: attempts.every(
      (a) =>
        a.checks.length > 0 &&
        Number.isFinite(a.evaluatedAt) &&
        checks.every((check) =>
          a.checks.some((saved) => saved.id === check.id),
        ),
    ),
    startupFailures: [],
    fetchedAt: Date.now(),
    review: { state: "unavailable", findings: [] },
  };
}

export function parseEvaluatedComparisonBundle(text) {
  const comparison = parseComparisonBundle(text);
  if (
    !comparison.checks.length ||
    !comparison.attempts.some(
      (attempt) =>
        Number.isFinite(attempt.evaluatedAt) && attempt.checks.length > 0,
    )
  )
    throw Error("evaluation_missing");
  return comparison;
}
