const LIMIT = 180000;
const text = (value) => (typeof value === "string" ? value : "");
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export function displayText(value) {
  return text(value)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\/Users\/[^/\s"')]+/g, "[home]")
    .replace(
      /\/private\/tmp\/agentlens-replays\/[^/\s]+\/worktree/g,
      "[workspace]",
    );
}
export function allowBridgeRequest(req, path = "/api/recorded-run") {
  const h = req.headers ?? {};
  return (
    req.method === "GET" &&
    req.url === path &&
    /^127\.0\.0\.1:(5177|5178)$/.test(h.host ?? "") &&
    h["x-agentlens-read"] === "1" &&
    (!h.origin || h.origin === `http://${h.host}`) &&
    (!h["sec-fetch-site"] || h["sec-fetch-site"] === "same-origin")
  );
}
export function projectRecordedRun(input, context) {
  const run = input?.run;
  if (
    !run ||
    typeof run.id !== "string" ||
    !Array.isArray(input.events) ||
    input.events.length > 10000 ||
    !input.summary
  )
    throw new Error("Invalid recorded run");
  const seenIds = new Set(),
    seenSequences = new Set();
  const details = new Map(
    (input.summary.likelyTests?.testCommandDetails ?? []).map((d) => [
      d.sourceEventId,
      d,
    ]),
  );
  const events = input.events
    .map((e) => {
      if (
        e.runId !== run.id ||
        typeof e.id !== "string" ||
        !Number.isSafeInteger(e.sequence) ||
        e.sequence < 0 ||
        seenIds.has(e.id) ||
        seenSequences.has(e.sequence)
      )
        throw new Error("Invalid event identity");
      seenIds.add(e.id);
      seenSequences.add(e.sequence);
      const p = e.normalizedPayload ?? {},
        native = e.nativeContent?.item ?? {};
      const permitted = run.capturePolicy === "standard";
      const command = permitted
        ? displayText(
            p.commandEvidence?.redactedCommand ?? p.command ?? native.command,
          ).slice(0, 20000)
        : "";
      const rawOutput =
        permitted && e.kind === "command"
          ? typeof p.aggregatedOutput === "string"
            ? p.aggregatedOutput
            : native.aggregated_output
          : undefined;
      const exitCode = finite(p.exitCode ?? native.exit_code);
      const derived = details.get(e.id);
      const outputState =
        typeof rawOutput !== "string"
          ? "unavailable"
          : rawOutput.length > LIMIT
            ? "truncated"
            : "available";
      return {
        id: e.id,
        sequence: e.sequence,
        kind: text(e.kind),
        status: text(e.status),
        provenance: text(e.provenance),
        receivedAt: e.receivedAt,
        summary: displayText(e.summary).slice(0, 1000),
        command,
        output: displayText(rawOutput).slice(0, LIMIT),
        outputState,
        exitCode,
        message:
          permitted && e.kind === "message.agent"
            ? displayText(p.text).slice(0, 20000)
            : "",
        files:
          permitted && e.kind === "file.change" && Array.isArray(p.changes)
            ? p.changes
                .slice(0, 100)
                .map((f) => ({
                  path: displayText(f.path).slice(0, 2000),
                  kind: text(f.kind),
                }))
            : [],
        testOutcome: derived
          ? derived.outcomeAttribution === "source_exit" && exitCode !== null
            ? exitCode === 0
              ? "pass"
              : "fail"
            : "unknown"
          : null,
        testAttribution: derived?.outcomeAttribution ?? null,
        artifactId:
          e.nativePayload?.storage === "artifact"
            ? e.nativePayload.artifactId
            : null,
        relationships: (e.relationships ?? [])
          .slice(0, 100)
          .map((r) => ({ type: text(r.type), eventId: text(r.eventId) })),
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
  for (const id of details.keys())
    if (!seenIds.has(id)) throw new Error("Missing test source event");
  const commands = events.filter(
    (e) => e.kind === "command" && e.status !== "in_progress",
  );
  const a = input.summary.assessment ?? {};
  const git = context.gitDiff;
  const parts = git?.content?.split(/(?=^diff --git )/m).filter(Boolean) ?? [];
  return {
    schemaVersion: 1,
    id: run.id,
    title: context.title || run.label || "Recorded run",
    label: text(run.label),
    provider: text(run.provider),
    agentVersion: text(run.agentVersion),
    model: null,
    status: text(run.status),
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    fetchedAt: context.fetchedAt,
    readerRevision: context.readerRevision,
    capturePolicy: text(run.capturePolicy),
    eventCount: events.length,
    commandCount: commands.length,
    failedCommandCount: commands.filter((e) =>
      e.exitCode !== null ? e.exitCode !== 0 : e.status === "failed",
    ).length,
    elapsedMs:
      input.summary.elapsedRecorderTimeMs?.availability === "available"
        ? finite(input.summary.elapsedRecorderTimeMs.value)
        : null,
    tokenUsageReason: input.summary.observedTokenUsage?.reason ?? "unavailable",
    tests: {
      ...(input.summary.likelyTests?.attempts ?? {
        total: 0,
        passed: 0,
        failed: 0,
        unknown: 0,
      }),
      derivation: input.summary.likelyTests?.derivationId ?? null,
      durability: input.summary.likelyTests?.durability ?? null,
    },
    assessment: {
      verdict: text(a.verdict) || "unreviewed",
      taskCompleted: text(a.taskCompleted) || "uncertain",
      eventId: a.currentEventId ?? null,
      reviewedAt: a.reviewedAt ?? null,
    },
    events,
    git: {
      state: git?.state ?? "unavailable",
      artifactId: git?.artifactId ?? null,
      reason: git?.reason ?? null,
      initialHead: input.gitEvidence?.initialHead ?? null,
      finalHead: input.gitEvidence?.finalHead ?? null,
      files: parts.map((part) => ({
        path: displayText(
          part.match(/^\+\+\+ b\/(.+)$/m)?.[1] ??
            part.match(/^diff --git a\/(.+) b\//m)?.[1] ??
            "Recorded file",
        ),
        content: displayText(part).slice(0, LIMIT),
        truncated: part.length > LIMIT,
      })),
    },
  };
}
