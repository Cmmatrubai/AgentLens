import { createHash } from "node:crypto";
import { INSIGHT_VERSION } from "./schema.mjs";

export { INSIGHT_VERSION, validateInsightOutput } from "./schema.mjs";

const DEFAULT_MAX_CHARACTERS = 60000;
const DEFAULT_MAX_SOURCES = 24;
const MAX_SOURCE_CHARACTERS = 6000;
const SELECTION_VERSION = "balanced-evidence-v3";
const sha256 = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
const text = (value) => (typeof value === "string" ? value : "");
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function normalizedHashInput(comparison) {
  const attempts = Array.isArray(comparison?.attempts)
    ? comparison.attempts
        .map((attempt) => ({
          key: text(attempt?.key),
          model: text(attempt?.model),
          reasoningEffort: text(attempt?.reasoningEffort),
          state: text(attempt?.state),
          elapsedMs: finite(attempt?.elapsedMs),
          checks: Array.isArray(attempt?.checks)
            ? attempt.checks
                .map((check) => ({
                  id: text(check?.id),
                  title: text(check?.title),
                  outcome: text(check?.outcome),
                  output: text(check?.output),
                  artifactSha256:
                    typeof check?.artifactSha256 === "string"
                      ? check.artifactSha256
                      : null,
                  command: text(check?.command),
                  durationMs: finite(check?.durationMs),
                  outputTruncated: check?.outputTruncated === true,
                }))
                .sort((a, b) => a.id.localeCompare(b.id))
            : [],
          passed: finite(attempt?.passed),
          failed: finite(attempt?.failed),
          unknown: finite(attempt?.unknown),
          snapshotHash:
            typeof attempt?.snapshotHash === "string"
              ? attempt.snapshotHash
              : null,
          evaluatedAt: finite(attempt?.evaluatedAt),
          eventCount: finite(attempt?.eventCount),
          controlNotes: Array.isArray(attempt?.controlNotes)
            ? attempt.controlNotes.map(text)
            : [],
          coverageLimits: Array.isArray(attempt?.coverageLimits)
            ? attempt.coverageLimits.map(text)
            : [],
          run: normalizeRunForHash(attempt?.run),
        }))
        .sort((a, b) => a.key.localeCompare(b.key))
    : [];
  return {
    schemaVersion: comparison?.schemaVersion ?? null,
    id: text(comparison?.id),
    title: text(comparison?.title),
    taskPrompt: text(comparison?.taskPrompt),
    manifestHash: text(comparison?.manifestHash),
    baseCommit: text(comparison?.baseCommit),
    timeoutMs: finite(comparison?.timeoutMs),
    promptHash: text(comparison?.promptHash),
    checkBundleHash: text(comparison?.checkBundleHash),
    checks: Array.isArray(comparison?.checks)
      ? comparison.checks
          .map((check) => ({ id: text(check?.id), title: text(check?.title) }))
          .sort((a, b) => a.id.localeCompare(b.id))
      : [],
    startupFailures: Array.isArray(comparison?.startupFailures)
      ? comparison.startupFailures
          .map((failure) => ({
            model: text(failure?.model),
            runId: text(failure?.runId),
            reason: text(failure?.reason),
          }))
          .sort((a, b) =>
            `${a.model}\0${a.runId}`.localeCompare(`${b.model}\0${b.runId}`),
          )
      : [],
    attempts,
  };
}

function normalizeRunForHash(run) {
  if (!run || typeof run !== "object") return null;
  return {
    schemaVersion: run.schemaVersion ?? null,
    id: text(run.id),
    title: text(run.title),
    label: text(run.label),
    provider: text(run.provider),
    agentVersion: text(run.agentVersion),
    model: typeof run.model === "string" ? run.model : null,
    status: text(run.status),
    startedAt: finite(run.startedAt),
    endedAt: finite(run.endedAt),
    readerRevision: text(run.readerRevision),
    capturePolicy: text(run.capturePolicy),
    eventCount: finite(run.eventCount),
    commandCount: finite(run.commandCount),
    failedCommandCount: finite(run.failedCommandCount),
    elapsedMs: finite(run.elapsedMs),
    tokenUsageReason: text(run.tokenUsageReason),
    tests: run.tests ?? null,
    assessment: run.assessment ?? null,
    events: Array.isArray(run.events)
      ? run.events
          .map((event) => ({
            id: text(event?.id),
            sequence: finite(event?.sequence),
            kind: text(event?.kind),
            status: text(event?.status),
            provenance: text(event?.provenance),
            receivedAt: event?.receivedAt ?? null,
            summary: text(event?.summary),
            command: text(event?.command),
            output: text(event?.output),
            outputState: text(event?.outputState),
            exitCode: finite(event?.exitCode),
            message: text(event?.message),
            files: Array.isArray(event?.files) ? event.files : [],
            testOutcome: event?.testOutcome ?? null,
            testAttribution: event?.testAttribution ?? null,
            artifactId: event?.artifactId ?? null,
            relationships: Array.isArray(event?.relationships)
              ? event.relationships
              : [],
          }))
          .sort(
            (a, b) =>
              (a.sequence ?? -1) - (b.sequence ?? -1) ||
              a.id.localeCompare(b.id),
          )
      : [],
    git: run.git
      ? {
          state: text(run.git.state),
          artifactId:
            typeof run.git.artifactId === "string" ? run.git.artifactId : null,
          reason: typeof run.git.reason === "string" ? run.git.reason : null,
          initialHead:
            typeof run.git.initialHead === "string"
              ? run.git.initialHead
              : null,
          finalHead:
            typeof run.git.finalHead === "string" ? run.git.finalHead : null,
          files: Array.isArray(run.git.files)
            ? run.git.files
                .map((file) => ({
                  path: text(file?.path),
                  content: text(file?.content),
                  truncated: file?.truncated === true,
                }))
                .sort((a, b) => a.path.localeCompare(b.path))
            : [],
        }
      : null,
  };
}

function eligibility(comparison, attempts) {
  if (!comparison || typeof comparison !== "object")
    return "Comparison input is missing.";
  if (!text(comparison.manifestHash).trim())
    return "A nonempty manifest hash is required.";
  if (!text(comparison.promptHash).trim())
    return "A nonempty prompt hash is required.";
  if (!text(comparison.baseCommit).trim())
    return "A nonempty base commit is required.";
  if (attempts.length !== 2) return "Exactly two attempts are required.";
  if (attempts.some((attempt) => !text(attempt?.model).trim()))
    return "Each attempt needs a model identity.";
  if (
    attempts.some((attempt) => {
      const checks = Array.isArray(attempt.checks) ? attempt.checks : [];
      return (
        checks.some((check) => !text(check?.id).trim()) ||
        new Set(checks.map((check) => check.id)).size !== checks.length
      );
    })
  )
    return "Independent checks need unique, nonempty identities.";
  if (new Set(attempts.map((attempt) => text(attempt?.key))).size !== 2)
    return "Two unique attempt keys are required.";
  if (attempts.some((attempt) => !text(attempt?.key).trim()))
    return "Each attempt key must be nonempty.";
  if (attempts.some((attempt) => !attempt?.run))
    return "Each attempt must have a recorded run.";
  if (new Set(attempts.map((attempt) => text(attempt.run?.id))).size !== 2)
    return "Two unique run identities are required.";
  if (attempts.some((attempt) => !text(attempt.run?.id).trim()))
    return "Each run identity must be nonempty.";
  for (const attempt of attempts) {
    for (const [items, field] of [
      [attempt.run?.events ?? [], "id"],
      [attempt.run?.git?.files ?? [], "path"],
    ]) {
      if (
        !Array.isArray(items) ||
        items.some((item) => !text(item?.[field]).trim()) ||
        new Set(items.map((item) => item[field])).size !== items.length
      )
        return "Recorded events and file paths need unique, nonempty identities within each attempt.";
    }
  }
  if (attempts.some((attempt) => attempt.run?.status !== "completed"))
    return "Both recorded runs must be completed.";
  if (
    attempts.some(
      (attempt) => attempt.run?.git?.initialHead !== comparison.baseCommit,
    )
  )
    return "Each run must match the declared base commit.";
  if (
    attempts.some(
      (attempt) =>
        text(attempt.run?.capturePolicy) &&
        attempt.run.capturePolicy !== "standard",
    )
  )
    return "Partial capture policies are not eligible for insight generation.";
  return "";
}

function checkFacts(attempt) {
  return (Array.isArray(attempt?.checks) ? attempt.checks : [])
    .map((check) => ({
      id: text(check?.id),
      title: text(check?.title),
      outcome:
        ["pass", "fail", "unknown"].includes(check?.outcome) &&
        text(check?.output).trim() &&
        text(check?.artifactSha256).trim()
          ? check.outcome
          : "unknown",
      artifactSha256:
        typeof check?.artifactSha256 === "string" ? check.artifactSha256 : null,
      command: text(check?.command),
      durationMs: finite(check?.durationMs),
      outputTruncated: check?.outputTruncated === true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function candidatesForAttempt(attempt, limits) {
  const run = attempt?.run;
  if (!run) return [];
  const candidates = [];
  const checks = Array.isArray(attempt.checks) ? attempt.checks : [];
  const checkGroups = new Map();
  for (const check of [...checks].sort((a, b) =>
    text(a?.id).localeCompare(text(b?.id)),
  )) {
    const content = text(check?.output);
    if (!content) {
      limits.push(
        `Independent check ${text(check?.id) || "(unnamed)"} for attempt ${text(attempt.key)} has no output excerpt.`,
      );
      continue;
    }
    const groupKey = check.artifactSha256
      ? `${check.artifactSha256}:${sha256(content)}:${text(check.command)}`
      : `check:${check.id}`;
    const existing = checkGroups.get(groupKey);
    if (existing) {
      existing.label += `; ${text(check.title) || text(check.id)}`;
      existing.identity += `;${text(check.id)}`;
      continue;
    }
    const candidate = {
      priority: 0,
      order: text(check?.id),
      kind: "check",
      label: text(check?.title) || text(check?.id) || "Independent check",
      path: null,
      identity: `check:${text(check?.id)}:${text(check?.artifactSha256) || "unavailable"}`,
      provenance: "Independent check",
      command: text(check?.command),
      exitCode: null,
      capturedTruncated: check?.outputTruncated === true,
      content,
    };
    checkGroups.set(groupKey, candidate);
    candidates.push(candidate);
  }
  const events = Array.isArray(run.events) ? run.events : [];
  const starts = new Map();
  let missingOutput = 0;
  for (const event of [...events].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  )) {
    if (event?.kind !== "command") continue;
    const command = text(event.command);
    if (event.status === "in_progress" && event.exitCode == null) {
      starts.set(command, (starts.get(command) ?? 0) + 1);
      continue;
    }
    if (starts.get(command)) starts.set(command, starts.get(command) - 1);
    if (event.outputState === "unavailable" || !text(event.output)) {
      missingOutput++;
      continue;
    }
    const failed =
      event.exitCode !== null && event.exitCode !== undefined
        ? event.exitCode !== 0
        : event.status === "failed";
    candidates.push({
      priority: failed ? 1 : 2,
      order: -(Number.isSafeInteger(event.sequence) ? event.sequence : -1),
      kind: "event",
      label:
        text(event.summary) || (failed ? "Failed command" : "Recorded command"),
      path: null,
      identity: `event:${text(event.id)}:${Number.isSafeInteger(event.sequence) ? event.sequence : "unknown"}`,
      provenance: "Recorded command",
      command: text(event.command),
      exitCode: finite(event.exitCode),
      capturedTruncated: event.outputState === "truncated",
      content: text(event.output),
    });
  }
  const unmatchedStarts = [...starts.values()].reduce((sum, n) => sum + n, 0);
  if (unmatchedStarts)
    limits.push(
      `${unmatchedStarts} command start(s) for attempt ${text(attempt.key)} have no matching terminal record.`,
    );
  if (missingOutput)
    limits.push(
      `${missingOutput} terminal command(s) for attempt ${text(attempt.key)} have no available output excerpt.`,
    );
  const files = Array.isArray(run.git?.files) ? run.git.files : [];
  for (const file of [...files].sort((a, b) =>
    text(a?.path).localeCompare(text(b?.path)),
  )) {
    if (!text(file?.content)) continue;
    candidates.push({
      priority: 3,
      order: text(file?.path),
      kind: "file",
      label: text(file?.path) || "Final Git diff",
      path: text(file?.path) || null,
      identity: `git:${text(run.git?.artifactId) || "unavailable"}:${text(file?.path)}`,
      provenance: "Final Git diff",
      command: "",
      exitCode: null,
      capturedTruncated: file?.truncated === true,
      content: text(file?.content),
    });
  }
  for (const event of events) {
    if (event?.kind !== "message.agent" || !text(event.message)) continue;
    candidates.push({
      priority: 4,
      order: -(Number.isSafeInteger(event.sequence) ? event.sequence : -1),
      kind: "event",
      label: text(event.summary) || "Agent report",
      path: null,
      identity: `event:${text(event.id)}:${Number.isSafeInteger(event.sequence) ? event.sequence : "unknown"}`,
      provenance: "Agent report",
      command: "",
      exitCode: null,
      capturedTruncated: event.outputState === "truncated",
      content: text(event.message),
    });
  }
  return candidates.sort(
    (a, b) =>
      a.priority - b.priority ||
      (typeof a.order === "number" && typeof b.order === "number"
        ? a.order - b.order
        : String(a.order).localeCompare(String(b.order))),
  );
}

function alternateCandidates(attempts, byAttempt) {
  const ordered = [];
  const priorities = [
    ...new Set(
      attempts.flatMap((attempt) =>
        byAttempt.get(attempt.key).map((candidate) => candidate.priority),
      ),
    ),
  ].sort((a, b) => a - b);
  for (const priority of priorities) {
    const candidatesAtPriority = new Map(
      attempts.map((attempt) => [
        attempt.key,
        byAttempt
          .get(attempt.key)
          .filter((candidate) => candidate.priority === priority),
      ]),
    );
    const longest = Math.max(
      0,
      ...attempts.map(
        (attempt) => candidatesAtPriority.get(attempt.key).length,
      ),
    );
    for (let index = 0; index < longest; index += 1)
      for (const attempt of attempts) {
        const candidate = candidatesAtPriority.get(attempt.key)[index];
        if (candidate) ordered.push({ attempt, candidate });
      }
  }
  return ordered;
}

function sourceFromCandidate(attempt, candidate, maximum, limits) {
  const fullDigest = sha256(candidate.content);
  const excerpt = candidate.content.slice(0, maximum);
  const selectionTruncated = excerpt.length < candidate.content.length;
  const truncated = candidate.capturedTruncated || selectionTruncated;
  if (candidate.capturedTruncated)
    limits.push(
      `${candidate.label} for attempt ${attempt.key} was already truncated when captured.`,
    );
  if (selectionTruncated)
    limits.push(
      `${candidate.label} for attempt ${attempt.key} was truncated by the insight evidence limit.`,
    );
  const fromLine = 1;
  const toLine = Math.max(1, excerpt.split("\n").length);
  const id = `src_${sha256(
    stableJson({
      version: INSIGHT_VERSION,
      attemptKey: attempt.key,
      runId: attempt.run.id,
      kind: candidate.kind,
      identity: candidate.identity,
      sha256: fullDigest,
      fromLine,
      toLine,
      excerpt,
    }),
  ).slice(0, 24)}`;
  return {
    id,
    kind: candidate.kind,
    label: candidate.label,
    path: candidate.path,
    identity: candidate.identity,
    provenance: candidate.provenance,
    command: candidate.command,
    exitCode: candidate.exitCode,
    truncated,
    sha256: fullDigest,
    fromLine,
    toLine,
    excerpt,
    fullSource: excerpt,
    attemptKey: attempt.key,
  };
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function selectBalanced(candidates, includedCount, attempts) {
  const selected = candidates.slice(0, includedCount);
  if (includedCount < 8) return selected;
  const reserved = attempts.flatMap((attempt) => [
    ...candidates
      .filter(
        (x) => x.attempt.key === attempt.key && x.candidate.kind === "file",
      )
      .slice(0, 2),
    ...candidates
      .filter(
        (x) =>
          x.attempt.key === attempt.key &&
          x.candidate.provenance === "Agent report",
      )
      .slice(0, 1),
  ]);
  for (const item of reserved) {
    if (selected.includes(item)) continue;
    const replace = selected.findLastIndex((x) => !reserved.includes(x));
    if (replace >= 0) selected[replace] = item;
  }
  return candidates.filter((x) => selected.includes(x));
}

export function buildInsightBundle(comparison, options = {}) {
  const maxCharacters = positiveInteger(
    options.maxCharacters,
    DEFAULT_MAX_CHARACTERS,
    "maxCharacters",
  );
  const maxSources = positiveInteger(
    options.maxSources,
    DEFAULT_MAX_SOURCES,
    "maxSources",
  );
  const rawAttempts = Array.isArray(comparison?.attempts)
    ? comparison.attempts
    : [];
  const attempts = [...rawAttempts].sort((a, b) =>
    text(a?.key).localeCompare(text(b?.key)),
  );
  let reason = eligibility(comparison, attempts);
  const limits = [];
  for (const attempt of attempts) {
    if (!Array.isArray(attempt?.checks) || attempt.checks.length === 0)
      limits.push(
        `No independent check evidence is available for attempt ${text(attempt?.key) || "(unnamed)"}.`,
      );
    for (const limit of Array.isArray(attempt?.coverageLimits)
      ? attempt.coverageLimits
      : [])
      if (text(limit).trim())
        limits.push(
          `Attempt ${text(attempt?.key) || "(unnamed)"}: ${text(limit)}`,
        );
    if (
      text(attempt?.run?.capturePolicy) &&
      attempt.run.capturePolicy !== "standard"
    )
      limits.push(
        `Attempt ${text(attempt?.key) || "(unnamed)"} uses the ${attempt.run.capturePolicy} capture policy.`,
      );
    if (attempt?.run?.git?.state && attempt.run.git.state !== "available")
      limits.push(
        `Final Git diff evidence for attempt ${text(attempt?.key) || "(unnamed)"} is ${attempt.run.git.state}.`,
      );
  }

  const byAttempt = new Map(
    attempts.map((attempt) => [
      attempt.key,
      candidatesForAttempt(attempt, limits),
    ]),
  );
  const candidates = alternateCandidates(attempts, byAttempt);
  const includedCount = Math.min(maxSources, candidates.length, maxCharacters);
  const perSourceLimit = Math.max(
    1,
    Math.min(
      MAX_SOURCE_CHARACTERS,
      Math.floor(maxCharacters / Math.max(1, includedCount)),
    ),
  );
  const sources = selectBalanced(candidates, includedCount, attempts).map(
    ({ attempt, candidate }) =>
      sourceFromCandidate(attempt, candidate, perSourceLimit, limits),
  );
  const characters = sources.reduce(
    (total, source) => total + source.excerpt.length,
    0,
  );
  if (
    !reason &&
    attempts.some(
      (attempt) => !sources.some((source) => source.attemptKey === attempt.key),
    )
  )
    reason = "Not enough captured evidence is available for both attempts.";
  if (sources.length < candidates.length)
    limits.push(
      `${candidates.length - sources.length} evidence source(s) were omitted by the insight source or character limit.`,
    );

  return {
    schemaVersion: 1,
    comparisonId: text(comparison?.id),
    inputHash: sha256(
      stableJson({
        input: normalizedHashInput(comparison),
        selectionVersion: SELECTION_VERSION,
        maxCharacters,
        maxSources,
      }),
    ),
    selectionVersion: SELECTION_VERSION,
    eligible: !reason,
    reason,
    task: {
      title: text(comparison?.title),
      prompt: text(comparison?.taskPrompt),
      baseCommit: text(comparison?.baseCommit),
      manifestHash: text(comparison?.manifestHash),
      promptHash: text(comparison?.promptHash),
      checkBundleHash: text(comparison?.checkBundleHash),
      timeoutMs: finite(comparison?.timeoutMs),
    },
    attempts: attempts.map((attempt) => ({
      key: text(attempt?.key),
      model: text(attempt?.model),
      reasoningEffort: text(attempt?.reasoningEffort),
      runId: text(attempt?.run?.id),
      controlNotes: Array.isArray(attempt?.controlNotes)
        ? attempt.controlNotes.map(text)
        : [],
      facts: {
        elapsedMs: finite(attempt?.run?.elapsedMs ?? attempt?.elapsedMs),
        commandCount: finite(attempt?.run?.commandCount),
        failedCommandCount: finite(attempt?.run?.failedCommandCount),
        checks: checkFacts(attempt),
      },
    })),
    sources,
    coverage: {
      includedSources: sources.length,
      totalSources: candidates.length,
      omittedSources: candidates.length - sources.length,
      characters,
      limits: [...new Set(limits)],
    },
  };
}
