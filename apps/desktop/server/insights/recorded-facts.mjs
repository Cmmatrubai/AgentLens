import { createHash } from "node:crypto";

export const RECORDED_FACTS_VERSION = "recorded-facts-v1";
const nonempty = (value) => typeof value === "string" && !!value.trim();

// Derive only what the saved normalized records establish. A command exit is
// never a task/check verdict, and missing planned checks never count as passes.
export function buildRecordedFacts(bundle) {
  const facts = [],
    limits = [];
  const checks = new Map();
  for (const check of bundle.task.expectedChecks ?? [])
    if (nonempty(check.id)) checks.set(check.id, check.title || check.id);
  for (const attempt of bundle.attempts)
    for (const check of attempt.facts.checks)
      if (nonempty(check.id) && !checks.has(check.id))
        checks.set(check.id, check.title || check.id);
  if (!checks.size)
    limits.push(
      "No independent checks were declared or recorded. Task correctness is unknown.",
    );
  const add = (fact) => {
    const value = {
      version: RECORDED_FACTS_VERSION,
      inputHash: bundle.inputHash,
      ...fact,
    };
    facts.push({
      id: `fact_${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`,
      ...value,
    });
  };
  for (const attempt of bundle.attempts) {
    for (const [id, title] of [...checks].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const saved = attempt.facts.checks.find((check) => check.id === id);
      const hasIdentifiedOutput = saved?.hasIdentifiedOutput === true;
      const sources = bundle.sources.filter(
        (source) =>
          hasIdentifiedOutput &&
          source.kind === "check" &&
          source.attemptKey === attempt.key &&
          source.checkIds?.includes(id),
      );
      const outcome =
        saved &&
        hasIdentifiedOutput &&
        ["pass", "fail"].includes(saved.outcome) &&
        nonempty(saved.artifactSha256)
          ? saved.outcome
          : "unknown";
      add({
        kind: "independent_check",
        attemptKey: attempt.key,
        checkId: id,
        label: title,
        outcome,
        command: saved?.command ?? "",
        artifactSha256: nonempty(saved?.artifactSha256)
          ? saved.artifactSha256
          : null,
        sourceIds: sources.map((source) => source.id),
        evidenceState: !hasIdentifiedOutput
          ? "missing"
          : sources.length
            ? "selected"
            : "omitted",
        truncated:
          saved?.outputTruncated === true ||
          sources.some((source) => source.truncated),
        reason: !saved
          ? "No result was recorded for this check on this attempt."
          : !hasIdentifiedOutput
            ? "No check output with an artifact identity is available for this attempt."
            : !sources.length
              ? "The check result is recorded; its output is outside the selected evidence."
              : outcome === "unknown"
                ? "The saved check result does not establish pass or fail."
                : "Outcome from the saved independent check record.",
      });
    }
    for (const source of bundle.sources.filter(
      (source) =>
        source.kind === "event" &&
        source.provenance === "Recorded command" &&
        source.attemptKey === attempt.key,
    )) {
      add({
        kind: "command_exit",
        attemptKey: attempt.key,
        label: source.command || "Recorded command",
        command: source.command,
        exitCode: Number.isSafeInteger(source.exitCode)
          ? source.exitCode
          : null,
        sourceIds: [source.id],
        sourceSha256: source.sha256,
        truncated: source.truncated,
        reason:
          "Recorded command exit only; this does not establish an independent check result or task success.",
      });
    }
  }
  limits.push(
    "Command facts cover selected output-bearing records only; they are not a count of every command in the run.",
  );
  return {
    version: RECORDED_FACTS_VERSION,
    inputHash: bundle.inputHash,
    facts,
    limits,
  };
}
