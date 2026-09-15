import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { privateRead, privateWrite } from "../insights/private-files.mjs";
import { snapshotAttempt } from "./check-snapshot.mjs";
import { runCheckCommand } from "./check-process.mjs";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const uuid = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const phases = [
  "queued",
  "preparing",
  "running",
  "completed",
  "cancelled",
  "timed_out",
  "unavailable",
  "interrupted",
];
export function validateCheckInput(input) {
  if (
    !input ||
    input.acknowledged !== true ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 120 ||
    typeof input.command !== "string" ||
    !input.command.trim() ||
    input.command.length > 4000 ||
    input.command.includes("\0") ||
    !Number.isInteger(input.timeoutSeconds) ||
    input.timeoutSeconds < 1 ||
    input.timeoutSeconds > 600
  )
    throw Error("invalid_check_request");
  return {
    title: input.title.trim(),
    command: input.command.trim(),
    timeoutSeconds: input.timeoutSeconds,
  };
}
function validState(s) {
  return (
    s?.schemaVersion === 1 &&
    uuid(s.id) &&
    uuid(s.jobId) &&
    ["running", "finished", "interrupted"].includes(s.state) &&
    typeof s.title === "string" &&
    s.title.length <= 120 &&
    typeof s.command === "string" &&
    s.command.length <= 4000 &&
    Number.isInteger(s.timeoutSeconds) &&
    s.timeoutSeconds >= 1 &&
    s.timeoutSeconds <= 600 &&
    (s.state === "running" || Number.isFinite(s.endedAt)) &&
    ["persistenceError", "cleanupUnconfirmed"].every(
      (key) => s[key] === undefined || typeof s[key] === "boolean",
    ) &&
    Number.isFinite(s.startedAt) &&
    Array.isArray(s.attempts) &&
    s.attempts.length === 2 &&
    s.attempts.every(
      (a, i) =>
        a &&
        a.key === (i === 0 ? "a" : "b") &&
        typeof a.runId === "string" &&
        phases.includes(a.state) &&
        ["pass", "fail", "unknown"].includes(a.outcome) &&
        typeof a.output === "string" &&
        a.output.length < 24000 &&
        (!a.artifactSha256 || a.artifactSha256 === hash(a.output)) &&
        (a.outcome === "unknown" ||
          (a.state === "completed" &&
            /^[a-f0-9]{64}$/.test(a.snapshotHash) &&
            a.artifactSha256 === hash(a.output) &&
            Number.isInteger(a.exitCode) &&
            a.outcome === (a.exitCode === 0 ? "pass" : "fail"))),
    )
  );
}
export function createCheckService({
  getRoot,
  getContext,
  write = privateWrite,
  runCommand = runCheckCommand,
}) {
  let initialized,
    root,
    active = null,
    work = null,
    closing = false,
    starting = false;
  const states = new Map();
  const save = async (state) => {
    try {
      await write(join(root, state.jobId), "check-state.json", state);
    } catch {
      state.persistenceError = true;
      for (const a of state.attempts) a.outcome = "unknown";
      throw Error("check_storage_failed");
    }
  };
  const init = () =>
    (initialized ??= (async () => {
      root = await getRoot();
      for (const id of await readdir(root)) {
        if (!uuid(id)) continue;
        let s;
        try {
          s = await privateRead(join(root, id), "check-state.json");
        } catch {
          states.set(id, { invalid: true });
          continue;
        }
        if (!s) continue;
        if (!validState(s) || s.jobId !== id) {
          states.set(id, { invalid: true });
          continue;
        }
        if (s.state === "running") {
          s.state = "interrupted";
          s.cleanupUnconfirmed = true;
          s.endedAt = Date.now();
          for (const a of s.attempts)
            if (["queued", "preparing", "running"].includes(a.state)) {
              a.state = "interrupted";
              a.outcome = "unknown";
            }
          await save(s);
        }
        states.set(id, s);
      }
    })());
  const view = (s) => {
    if (!s || s.invalid) return null;
    const result = structuredClone(s);
    // Do not offer another run while the final evidence is still being saved.
    if (active?.jobId === s.jobId && result.state === "finished")
      result.state = "running";
    return result;
  };
  async function execute(state, context, signal) {
    const runRoot = join(root, state.jobId, "check-runs", state.id);
    try {
      await mkdir(runRoot, { recursive: true, mode: 0o700 });
      // Freeze both before either check can run. Originals are never the cwd.
      for (const attempt of state.attempts) {
        if (signal.aborted) break;
        attempt.state = "preparing";
        await save(state);
        try {
          const snapshot = await snapshotAttempt(
            context.attempts.find((a) => a.key === attempt.key).workspace,
            join(runRoot, attempt.key),
            signal,
          );
          attempt.snapshotHash = snapshot.hash;
          await write(runRoot, `snapshot-${attempt.key}.json`, snapshot);
          attempt.state = "queued";
        } catch (e) {
          attempt.state = signal.aborted ? "cancelled" : "unavailable";
          attempt.error =
            e.message === "check_snapshot_changed"
              ? "check_snapshot_changed"
              : "check_snapshot_unsupported";
        }
        await save(state);
      }
      for (const attempt of state.attempts) {
        if (signal.aborted) break;
        if (!attempt.snapshotHash || attempt.state !== "queued") continue;
        attempt.state = "running";
        await save(state);
        try {
          const result = await runCommand({
            workspace: join(runRoot, attempt.key),
            command: state.command,
            timeoutMs: state.timeoutSeconds * 1000,
            signal,
          });
          Object.assign(attempt, result);
          if (result.cleanupConfirmed !== true) {
            state.cleanupUnconfirmed = true;
            attempt.error = "check_cleanup_unconfirmed";
          }
          attempt.outcome =
            result.state === "completed" &&
            Number.isInteger(result.exitCode) &&
            result.cleanupConfirmed === true
              ? result.exitCode === 0
                ? "pass"
                : "fail"
              : "unknown";
          attempt.output = `Command: ${state.command}\nExecution: ${result.state}\nExit code: ${result.exitCode ?? "unavailable"}\n\n${result.output}`;
          attempt.artifactSha256 = hash(attempt.output);
          attempt.endedAt = Date.now();
        } catch (e) {
          attempt.state = "unavailable";
          attempt.error =
            e.message === "check_platform_unavailable"
              ? e.message
              : "check_execution_unavailable";
        }
        await save(state);
        if (state.cleanupUnconfirmed) break;
      }
    } catch {
      state.persistenceError = true;
    } finally {
      for (const a of state.attempts)
        if (["queued", "preparing", "running"].includes(a.state)) {
          a.state = signal.aborted ? "cancelled" : "unavailable";
          a.outcome = "unknown";
        }
      state.state = "finished";
      state.endedAt = Date.now();
      try {
        await write(
          join(root, state.jobId, "check-history"),
          `${state.id}.json`,
          state,
        );
        await save(state);
      } catch {
        state.persistenceError = true;
        for (const a of state.attempts) a.outcome = "unknown";
        await save(state).catch(() => {});
      }
      active = null;
    }
  }
  return {
    async read(jobId) {
      await init();
      const context = await getContext(jobId);
      const state = states.get(jobId);
      if (state?.invalid) throw Error("check_evidence_unavailable");
      if (
        state &&
        state.attempts.some(
          (a) =>
            !context.attempts.some(
              (b) => a.key === b.key && a.runId === b.runId,
            ),
        )
      )
        throw Error("check_evidence_unavailable");
      return { evaluation: view(state) };
    },
    async start(jobId, input) {
      if (starting || active || closing) throw Error("check_busy");
      starting = true;
      try {
        const check = validateCheckInput(input);
        await init();
        if (
          [...states.values()].some(
            (s) => s.cleanupUnconfirmed && !s.cleanupAcknowledgedAt,
          )
        )
          throw Error("check_cleanup_unconfirmed");
        if ([...states.values()].some((s) => s.invalid))
          throw Error("check_evidence_unavailable");
        const context = await getContext(jobId, { prepare: true });
        if (closing) throw Error("check_busy");
        const state = {
          schemaVersion: 1,
          id: randomUUID(),
          jobId,
          ...check,
          state: "running",
          startedAt: Date.now(),
          baseCommit: context.baseCommit,
          attempts: context.attempts.map((a) => ({
            key: a.key,
            runId: a.runId,
            state: "queued",
            outcome: "unknown",
            output: "",
            outputTruncated: false,
            exitCode: null,
            artifactSha256: null,
            snapshotHash: null,
            durationMs: null,
          })),
        };
        await save(state);
        states.set(jobId, state);
        const stop = new AbortController();
        if (closing) stop.abort();
        active = { jobId, stop };
        work = execute(state, context, stop.signal);
        return { evaluation: view(state) };
      } finally {
        starting = false;
      }
    },
    async stop(jobId) {
      await init();
      if (active?.jobId !== jobId) throw Error("check_not_running");
      active.stop.abort();
      return { evaluation: view(states.get(jobId)) };
    },
    async acknowledge(jobId, confirmed) {
      await init();
      const s = states.get(jobId);
      if (
        !s ||
        s.invalid ||
        !s.cleanupUnconfirmed ||
        confirmed !== true ||
        active
      )
        throw Error("check_cleanup_unconfirmed");
      const acknowledged = {
        ...structuredClone(s),
        cleanupAcknowledgedAt: Date.now(),
      };
      await save(acknowledged);
      states.set(jobId, acknowledged);
      return { evaluation: view(acknowledged) };
    },
    async project(jobId, comparison) {
      let s;
      try {
        s = (await this.read(jobId)).evaluation;
      } catch {
        return {
          ...comparison,
          verificationError: "check_evidence_unavailable",
        };
      }
      if (!s || s.state === "running") return comparison;
      if (s.persistenceError)
        return { ...comparison, verificationError: "check_storage_failed" };
      if (
        s.attempts.some(
          (a) =>
            !comparison.attempts.some(
              (b) => a.key === b.key && a.runId === b.run?.id,
            ),
        )
      )
        return {
          ...comparison,
          verificationError: "check_evidence_unavailable",
        };
      for (const a of s.attempts) {
        if (!a.snapshotHash) continue;
        try {
          const snapshot = await privateRead(
            join(root, jobId, "check-runs", s.id),
            `snapshot-${a.key}.json`,
          );
          if (
            !snapshot ||
            snapshot.hash !== a.snapshotHash ||
            hash(
              JSON.stringify({ head: snapshot.head, files: snapshot.files }),
            ) !== a.snapshotHash
          )
            throw Error("invalid");
        } catch {
          return {
            ...comparison,
            verificationError: "check_evidence_unavailable",
          };
        }
      }
      const checkId = `command-${s.id}`;
      const title = `Command verification: ${s.title}`;
      return {
        ...comparison,
        verificationKind: "command",
        checkBundleHash: hash(
          JSON.stringify({
            command: s.command,
            timeout: s.timeoutSeconds,
            id: s.id,
          }),
        ),
        checks: [{ id: checkId, title }],
        attempts: comparison.attempts.map((a) => {
          const r = s.attempts.find((r) => r.key === a.key);
          return {
            ...a,
            state: "evaluated",
            snapshotHash: r.snapshotHash,
            evaluatedAt: s.endedAt,
            checks: [
              {
                id: checkId,
                title,
                outcome: r.outcome,
                output: r.output,
                artifactSha256: r.artifactSha256,
                command: s.command,
                durationMs: r.durationMs,
                outputTruncated: r.outputTruncated,
                outputAvailable: !!r.artifactSha256,
              },
            ],
            passed: r.outcome === "pass" ? 1 : 0,
            failed: r.outcome === "fail" ? 1 : 0,
            unknown: r.outcome === "unknown" ? 1 : 0,
            controlNotes: [
              ...a.controlNotes,
              "User-defined command executed separately from the agents in fresh copies; no network access and writes restricted to each evaluator copy.",
            ],
            coverageLimits: [
              "A pass means the supplied command exited zero. It does not establish task correctness or independently authored assertions.",
              "Snapshots were taken from retained workspaces at verification time; later manual edits may be present. Ignored files, installed dependencies and Git metadata are not copied.",
              "Commands can read local files; inherited environment credentials are excluded. Output is bounded.",
            ],
          };
        }),
      };
    },
    async shutdown() {
      closing = true;
      active?.stop.abort();
      while (starting) await new Promise((r) => setTimeout(r, 10));
      await work;
      if (
        [...states.values()].some(
          (s) => s.cleanupUnconfirmed && !s.cleanupAcknowledgedAt,
        )
      )
        throw Error("cleanup_unconfirmed");
    },
  };
}
