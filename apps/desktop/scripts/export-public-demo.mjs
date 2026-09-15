import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const MAX_BYTES = 800_000;
const fields = (value, names) =>
  Object.fromEntries(names.map((name) => [name, value[name]]));
const sensitive =
  /\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|Bearer\s+\S{12,}|AKIA[A-Z0-9]{16})|-----BEGIN [^-]*PRIVATE KEY|(?:api[_-]?key|token|password)\s*[=:]\s*["']?[a-zA-Z0-9_-]{16,}|\/(?:Users|home)\/|[A-Z]:\\Users\\|https?:\/\/[^\s/]+:[^\s/]+@/i;
function publicText(value) {
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value) > MAX_BYTES)
    throw Error("Public export size limit exceeded");
  const text = value
    .replace(
      /\/(?:private\/)?tmp\/agentlens-comparison-C01-20260906(?=\/|\s|$)/g,
      "[local-workspace]",
    )
    .replace(
      /\/(?:private\/)?tmp\/agentlens-[^\s"'`<>:)]+/g,
      "[temporary-path]",
    )
    .replace(/\/private\/var\/folders\/[^\s"'`<>:)]+/g, "[temporary-path]");
  if (sensitive.test(text) || /\/(?:private\/)?tmp\//.test(text))
    throw Error("Public export contains sensitive or unreviewed local text");
  return text;
}
function clean(value) {
  if (typeof value === "string") return publicText(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, clean(v)]),
    );
  return value;
}

// Explicit projections below are the export boundary. Never serialize the raw
// comparison, local settings, provider drafts, or an entire recording directory.
export function exportPublicDemo(input) {
  if (
    input.schemaVersion !== 1 ||
    !input.ready ||
    input.attempts?.length !== 2 ||
    new Set(input.attempts.map((a) => a.key)).size !== 2 ||
    input.review?.state !== "available" ||
    !input.review.findings?.length
  )
    throw Error("A complete comparison with authored evidence is required");
  if (!input.taskPrompt || digest(input.taskPrompt) !== input.promptHash)
    throw Error("Original task prompt identity mismatch");
  const sources = [],
    selections = new Map();
  const findings = input.review.findings.map((f) => ({
    ...clean(
      fields(f, [
        "id",
        "category",
        "title",
        "summary",
        "interpretation",
        "limitations",
      ]),
    ),
    sides: f.sides.map((side) => {
      const attempt = input.attempts.find((a) => a.key === side.attemptKey);
      if (
        !attempt?.run ||
        side.runId !== attempt.run.id ||
        side.model !== attempt.model ||
        !side.sources?.length
      )
        throw Error("Authored source owner mismatch");
      const selection = selections.get(attempt.key) ?? {
        events: new Set(),
        files: new Set(),
      };
      selections.set(attempt.key, selection);
      return {
        ...clean(
          fields(side, [
            "attemptKey",
            "model",
            "reasoningEffort",
            "runId",
            "observation",
          ]),
        ),
        sources: side.sources.map((source) => {
          let original;
          if (source.kind === "file") {
            const file = attempt.run.git.files.find(
              (f) => f.path === source.path,
            );
            if (
              !file ||
              file.truncated ||
              source.identity !== attempt.run.git.artifactId ||
              digest(file.content) !== source.sha256
            )
              throw Error("Authored file source mismatch");
            if (
              source.command !== "" ||
              source.exitCode !== null ||
              source.provenance !== "Final Git diff" ||
              source.truncated !== false
            )
              throw Error("Authored source metadata mismatch");
            original = file.content;
            selection.files.add(source.path);
          } else if (source.kind === "event") {
            const event = attempt.run.events.find(
              (e) => e.id === source.identity,
            );
            if (!event || !["command", "message.agent"].includes(event.kind))
              throw Error("Authored event source mismatch");
            const body = fields(event, [
              "kind",
              "provenance",
              "status",
              "command",
              "output",
              "message",
              "exitCode",
            ]);
            if (digest(JSON.stringify(body)) !== source.sha256)
              throw Error("Authored event source hash mismatch");
            if (
              source.command !== event.command ||
              source.exitCode !== event.exitCode ||
              source.path !== null ||
              source.provenance !==
                (event.kind === "command"
                  ? "Recorded command"
                  : "Agent report") ||
              source.truncated !== (event.outputState === "truncated") ||
              (event.kind === "command" && event.outputState === "unavailable")
            )
              throw Error("Authored source metadata mismatch");
            original = event.kind === "command" ? event.output : event.message;
            selection.events.add(event.id);
          } else throw Error("Unreviewed source kind");
          const lines = original.split("\n");
          if (
            source.fullSource !== original ||
            !Number.isSafeInteger(source.fromLine) ||
            !Number.isSafeInteger(source.toLine) ||
            source.fromLine < 1 ||
            source.toLine < source.fromLine ||
            source.toLine > lines.length ||
            source.excerpt !==
              lines.slice(source.fromLine - 1, source.toLine).join("\n")
          )
            throw Error("Authored citation mismatch");
          const fullSource = publicText(original),
            sha256 = digest(fullSource);
          sources.push({
            attemptKey: attempt.key,
            sourceId: source.id,
            originalIdentity: source.identity,
            originalSha256: source.sha256,
            exportedSha256: sha256,
            transformed: fullSource !== original,
          });
          return {
            ...clean(
              fields(source, [
                "id",
                "kind",
                "label",
                "path",
                "provenance",
                "command",
                "exitCode",
                "truncated",
                "fromLine",
                "toLine",
              ]),
            ),
            identity: `public-text-sha256:${sha256}`,
            sha256,
            fullSource,
            excerpt: fullSource
              .split("\n")
              .slice(source.fromLine - 1, source.toLine)
              .join("\n"),
          };
        }),
      };
    }),
  }));
  const attempts = input.attempts.map((a) => {
    if (!a.run || a.run.status !== "completed")
      throw Error("Completed source recordings required");
    const selection = selections.get(a.key);
    if (!selection) throw Error("Both attempts need authored sources");
    const run = a.run;
    const events = run.events
      .filter((e) => selection.events.has(e.id))
      .map((e) => ({
        ...clean(
          fields(e, [
            "id",
            "sequence",
            "kind",
            "status",
            "provenance",
            "receivedAt",
            "summary",
            "command",
            "output",
            "outputState",
            "exitCode",
            "message",
            "testOutcome",
            "testAttribution",
          ]),
        ),
        files: [],
        artifactId: null,
        relationships: [],
      }));
    const files = run.git.files
      .filter((f) => selection.files.has(f.path))
      .map((f) => clean(fields(f, ["path", "content", "truncated"])));
    const checks = a.checks.map((c) => {
      const output = publicText(c.output),
        artifactSha256 = digest(output);
      sources.push({
        attemptKey: a.key,
        sourceId: `check:${c.id}`,
        originalIdentity: c.id,
        originalSha256: c.artifactSha256,
        exportedSha256: artifactSha256,
        transformed: output !== c.output,
      });
      return {
        ...clean(
          fields(c, [
            "id",
            "title",
            "outcome",
            "command",
            "durationMs",
            "outputTruncated",
          ]),
        ),
        output,
        artifactSha256,
      };
    });
    if (
      input.checks.some((c) => !checks.some((x) => x.id === c.id)) ||
      checks.some((c) => !["pass", "fail", "unknown"].includes(c.outcome))
    )
      throw Error("Independent check source mismatch");
    return {
      ...clean(
        fields(a, [
          "key",
          "model",
          "reasoningEffort",
          "state",
          "elapsedMs",
          "snapshotHash",
          "evaluatedAt",
          "eventCount",
          "controlNotes",
        ]),
      ),
      coverageLimits: [
        ...clean(a.coverageLimits),
        `Public selection: ${events.length} of ${run.eventCount} recorded events and ${files.length} of ${run.git.files.length} changed files. Local paths are replaced; exported text has its own hashes.`,
      ],
      checks,
      passed: checks.filter((c) => c.outcome === "pass").length,
      failed: checks.filter((c) => c.outcome === "fail").length,
      unknown: checks.filter((c) => c.outcome === "unknown").length,
      run: {
        ...clean(
          fields(run, [
            "schemaVersion",
            "id",
            "title",
            "label",
            "provider",
            "agentVersion",
            "model",
            "status",
            "startedAt",
            "endedAt",
            "readerRevision",
            "capturePolicy",
            "eventCount",
            "commandCount",
            "failedCommandCount",
            "elapsedMs",
            "tokenUsageReason",
          ]),
        ),
        fetchedAt: 0,
        tests: clean(
          fields(run.tests, [
            "total",
            "passed",
            "failed",
            "unknown",
            "derivation",
            "durability",
          ]),
        ),
        assessment: clean(
          fields(run.assessment, [
            "verdict",
            "taskCompleted",
            "eventId",
            "reviewedAt",
          ]),
        ),
        events,
        git: {
          ...clean(fields(run.git, ["state", "initialHead", "finalHead"])),
          reason: "Selected public diffs; original artifact is not bundled.",
          artifactId: `public-files-sha256:${digest(JSON.stringify(files))}`,
          files,
        },
      },
    };
  });
  const comparison = {
    ...clean(
      fields(input, [
        "schemaVersion",
        "id",
        "title",
        "manifestHash",
        "baseCommit",
        "timeoutMs",
        "taskPrompt",
        "promptHash",
        "checkBundleHash",
        "ready",
      ]),
    ),
    promptHash: digest(publicText(input.taskPrompt)),
    checks: input.checks.map((c) => clean(fields(c, ["id", "title"]))),
    attempts,
    startupFailures: [],
    fetchedAt: 0,
    review: {
      state: "available",
      id: `${input.review.id}-public-v1`,
      method: "Authored case notes, selected public evidence",
      findings,
    },
  };
  const comparisonJSON =
    JSON.stringify({ ok: true, comparison }, null, 2) + "\n";
  if (Buffer.byteLength(comparisonJSON) > MAX_BYTES)
    throw Error("Public export size limit exceeded");
  const manifest = clean({
    schemaVersion: 1,
    exportVersion: "public-demo-v1",
    caseId: input.id,
    originalManifestHash: input.manifestHash,
    comparisonFile: "comparison.json",
    originalPromptHash: input.promptHash,
    comparisonSha256: digest(comparisonJSON),
    comparisonBytes: Buffer.byteLength(comparisonJSON),
    narrative:
      "Authored case notes; not generated or verified by the live insight engine.",
    omissions: [
      "Only sources linked by the three authored case notes and all independent check outputs are selected.",
      "Uncited events and files, startup failures, local configuration, credentials, provider drafts and review history are excluded.",
      "Run event totals describe the original recordings; this packet includes only the declared selection.",
      "Local workspace and temporary paths are replaced. Text hashes identify the exported bytes, not the original artifact.",
      "Original identifiers and artifact hashes are provenance references; the original archives are not included.",
    ],
    sources,
  });
  return { comparison, comparisonJSON, manifest };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { readComparison } = await import("../server/comparison-reader.mjs");
  const response = await readComparison();
  if (!response.ok) throw Error("Original C01 evidence unavailable");
  const taskPrompt = await readFile(
    new URL("../experiments/C01/prompt.md", import.meta.url),
    "utf8",
  );
  const packet = exportPublicDemo({ ...response.comparison, taskPrompt });
  const destination = new URL("../public/demo/", import.meta.url);
  await mkdir(destination, { recursive: true });
  await writeFile(
    new URL("comparison.json", destination),
    packet.comparisonJSON,
  );
  await writeFile(
    new URL("manifest.json", destination),
    JSON.stringify(packet.manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      directory: fileURLToPath(destination),
      bytes: packet.manifest.comparisonBytes,
      sha256: packet.manifest.comparisonSha256,
      sources: packet.manifest.sources.length,
    }),
  );
}
