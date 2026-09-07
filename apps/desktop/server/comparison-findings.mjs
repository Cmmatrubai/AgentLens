import { createHash } from "node:crypto";
const digest = (text) => createHash("sha256").update(text).digest("hex");
const unique = (items) => new Set(items).size === items.length;
function resolveSource(attempt, ref) {
  let text,
    identity,
    provenance,
    command = "",
    exitCode = null,
    truncated = false;
  if (ref.kind === "file") {
    const file = attempt.run.git.files.find((f) => f.path === ref.path);
    if (
      !file ||
      file.truncated ||
      attempt.run.git.artifactId !== ref.artifactId ||
      digest(file.content) !== ref.sha256
    )
      throw Error("File evidence mismatch");
    text = file.content;
    identity = ref.artifactId;
    provenance = "Final Git diff";
  } else if (ref.kind === "event") {
    const event = attempt.run.events.find((e) => e.id === ref.eventId);
    if (
      !event ||
      event.sequence !== ref.sequence ||
      !["command", "message.agent"].includes(event.kind)
    )
      throw Error("Event identity mismatch");
    const body = {
      kind: event.kind,
      provenance: event.provenance,
      status: event.status,
      command: event.command,
      output: event.output,
      message: event.message,
      exitCode: event.exitCode,
    };
    if (
      digest(JSON.stringify(body)) !== ref.sha256 ||
      (event.kind === "command" && event.outputState === "unavailable")
    )
      throw Error("Event evidence mismatch");
    text = event.kind === "command" ? event.output : event.message;
    identity = event.id;
    command = event.command;
    exitCode = event.exitCode;
    provenance = event.kind === "command" ? "Recorded command" : "Agent report";
    truncated = event.outputState === "truncated";
  } else throw Error("Unknown source kind");
  const lines = text.split("\n");
  if (
    !Number.isInteger(ref.fromLine) ||
    !Number.isInteger(ref.toLine) ||
    ref.fromLine < 1 ||
    ref.toLine < ref.fromLine ||
    ref.toLine > lines.length
  )
    throw Error("Invalid excerpt");
  return {
    id: ref.id,
    kind: ref.kind,
    label: ref.label,
    path: ref.path ?? null,
    identity,
    provenance,
    command,
    exitCode,
    truncated,
    sha256: ref.sha256,
    fromLine: ref.fromLine,
    toLine: ref.toLine,
    excerpt: lines.slice(ref.fromLine - 1, ref.toLine).join("\n"),
    fullSource: text,
  };
}

// Editorial interpretation is separate from deterministic check outcomes. A
// reviewed note is shown only for the exact pair and evidence it was written for.
export function projectReviewedFindings(comparison, review) {
  const unavailable = { state: "unavailable", findings: [] };
  try {
    if (
      !comparison.ready ||
      comparison.id !== review.comparisonId ||
      comparison.manifestHash !== review.manifestHash ||
      review.attempts.length !== 2 ||
      !unique(review.attempts.map((a) => a.key)) ||
      !unique(comparison.attempts.map((a) => a.key))
    )
      return unavailable;
    for (const expected of review.attempts) {
      const a = comparison.attempts.find((a) => a.key === expected.key);
      if (
        !a?.run ||
        a.run.id !== expected.runId ||
        a.snapshotHash !== expected.snapshotHash ||
        a.model !== expected.model ||
        a.reasoningEffort !== expected.reasoningEffort
      )
        return unavailable;
      if (
        expected.checks &&
        (expected.checks.length !== a.checks.length ||
          expected.checks.some(
            (c) =>
              !a.checks.some(
                (actual) =>
                  actual.id === c.id &&
                  actual.outcome === c.outcome &&
                  actual.artifactSha256 === c.artifactSha256,
              ),
          ))
      )
        return unavailable;
    }
    if (!unique(review.findings.map((f) => f.id))) return unavailable;
    const findings = review.findings.map((note) => {
      if (
        note.sides.length !== 2 ||
        !unique(note.sides.map((s) => s.attemptKey))
      )
        throw Error("Missing side");
      const sides = review.attempts.map((expected) => {
        const side = note.sides.find((s) => s.attemptKey === expected.key);
        const attempt = comparison.attempts.find((a) => a.key === expected.key);
        if (!side?.sources.length || !unique(side.sources.map((s) => s.id)))
          throw Error("Missing source");
        return {
          attemptKey: attempt.key,
          model: attempt.model,
          reasoningEffort: attempt.reasoningEffort,
          runId: attempt.run.id,
          observation: side.observation,
          sources: side.sources.map((ref) => resolveSource(attempt, ref)),
        };
      });
      return {
        id: note.id,
        category: note.category,
        title: note.title,
        summary: note.summary,
        interpretation: note.interpretation,
        limitations: note.limitations,
        sides,
      };
    });
    return {
      state: "available",
      id: review.id,
      method: review.method,
      findings,
    };
  } catch {
    return unavailable;
  }
}
