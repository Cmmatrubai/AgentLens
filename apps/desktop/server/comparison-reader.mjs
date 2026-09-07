import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { projectRecordedRun } from "./recorded-projector.mjs";
import { projectComparison } from "./comparison-projector.mjs";
import {
  validateManifest,
  sha256,
  readEvidence,
} from "./comparison-integrity.mjs";
const exec = promisify(execFile),
  root = fileURLToPath(new URL("../", import.meta.url)),
  local = join(root, ".local/comparison-C01");
let pending;
async function optional(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function read() {
  try {
    const manifest = await optional(join(local, "manifest.json"));
    if (!manifest) throw new Error("unavailable");
    await validateManifest(root, manifest);
    const sources = [];
    const archive = await optional(join(local, "archive.json"));
    if (archive && archive.manifestHash !== manifest.manifestHash)
      throw new Error("Archive identity mismatch");
    if (!archive) {
      const revision = await exec("git", ["rev-parse", "HEAD"], {
        cwd: manifest.recorder.repository,
      });
      if (revision.stdout.trim() !== manifest.recorder.revision)
        throw new Error("Recorder revision changed");
    }
    for (const a of manifest.attempts) {
      if (!["sol", "terra"].includes(a.key)) throw new Error("Invalid attempt");
      const dir = join(local, a.key),
        launch = await optional(join(dir, "launch.json")),
        status = await optional(join(dir, "status.json")),
        result = await optional(join(dir, "result.json"));
      let run = null,
        evaluation = await optional(join(dir, "evaluation.json"));
      if (result) {
        if (!launch || result.manifestHash !== manifest.manifestHash)
          throw new Error("Launch identity mismatch");
        let stdout;
        if (archive) {
          const stored = archive.attempts[a.key];
          if (!stored || stored.runId !== result.result.runId)
            throw new Error("Archive run mismatch");
          const dataRoot = join(local, "archive", a.key, "recording");
          for (const file of stored.recordingFiles) {
            const filePath = resolve(dataRoot, file.path);
            if (!filePath.startsWith(dataRoot + "/"))
              throw new Error("Invalid archive path");
            await readEvidence(filePath, file.sha256);
          }
          stdout = await readEvidence(
            join(local, "archive", a.key, "inspection.json"),
            stored.inspectionSha256,
          );
        } else {
          ({ stdout } = await exec(
            join(manifest.recorder.repository, "node_modules/.bin/tsx"),
            [
              "--conditions=development",
              join(root, "server/read-agentlens.mjs"),
              manifest.recorder.repository,
              a.dataRoot,
              result.result.runId,
            ],
            {
              cwd: manifest.recorder.repository,
              timeout: 20000,
              maxBuffer: 12 * 1024 * 1024,
              encoding: "utf8",
            },
          ));
        }
        const raw = JSON.parse(stdout),
          invocation = raw.inspection.events.find(
            (e) => e.kind === "recorder.invocation",
          )?.normalizedPayload,
          argv = invocation?.argv?.values;
        if (
          !Array.isArray(argv) ||
          JSON.stringify(argv) !== JSON.stringify(launch.argv) ||
          sha256(invocation?.stdin?.text ?? "") !==
            manifest.inputs["experiments/C01/prompt.md"] ||
          argv[argv.indexOf("-m") + 1] !== a.model ||
          !argv.includes('model_reasoning_effort="high"')
        )
          throw new Error("Invocation mismatch");
        run = projectRecordedRun(raw.inspection, {
          title: manifest.title,
          fetchedAt: Date.now(),
          readerRevision: manifest.recorder.revision,
          gitDiff: raw.gitDiff,
        });
      }
      if (evaluation) {
        const snapshot = await optional(join(dir, "snapshot.json"));
        if (
          !snapshot ||
          sha256(JSON.stringify(snapshot.files)) !== snapshot.hash ||
          snapshot.hash !== evaluation.snapshotHash
        )
          throw new Error("Snapshot identity mismatch");
        const checks = [];
        for (const c of evaluation.checks) {
          if (!/^[a-z0-9-]+\.log$/.test(c.outputFile))
            throw new Error("Invalid evaluator evidence path");
          const path = resolve(dir, c.outputFile);
          if (!path.startsWith(dir + "/"))
            throw new Error("Invalid evaluator evidence path");
          const content = await readEvidence(path, c.artifactSha256);
          checks.push({
            ...c,
            output: content.slice(0, 180000),
            outputTruncated: content.length > 180000,
          });
        }
        evaluation = { ...evaluation, checks };
      }
      sources.push({
        key: a.key,
        launch,
        result,
        run,
        evaluation,
        state: status?.state ?? (launch ? "recording" : "pending"),
        eventCount: status?.eventCount ?? 0,
      });
    }
    return { ok: true, comparison: projectComparison(manifest, sources) };
  } catch {
    return { ok: false, error: "comparison_unavailable" };
  }
}
export function readComparison() {
  if (pending) return pending;
  pending = read().finally(() => (pending = undefined));
  return pending;
}
