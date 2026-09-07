import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import { projectRecordedRun } from "./recorded-projector.mjs";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
let pending;
export function readRecordedRun() {
  if (pending) return pending;
  pending = read().finally(() => {
    pending = undefined;
  });
  return pending;
}
async function read() {
  try {
    const c = JSON.parse(
      await readFile(join(root, ".local/connection.json"), "utf8"),
    );
    if (
      !isAbsolute(c.repository) ||
      !isAbsolute(c.dataRoot) ||
      !isAbsolute(c.runtime) ||
      !/^[a-f0-9-]{36}$/.test(c.runId)
    )
      throw new Error("Invalid local connection");
    const [result, revision] = await Promise.all([
      exec(
        c.runtime,
        [
          "--conditions=development",
          join(root, "server/read-agentlens.mjs"),
          c.repository,
          c.dataRoot,
          c.runId,
        ],
        {
          cwd: c.repository,
          timeout: 20000,
          maxBuffer: 12 * 1024 * 1024,
          encoding: "utf8",
        },
      ),
      exec("git", ["rev-parse", "HEAD"], {
        cwd: c.repository,
        timeout: 3000,
        encoding: "utf8",
      }),
    ]);
    const data = JSON.parse(result.stdout);
    return {
      ok: true,
      run: projectRecordedRun(data.inspection, {
        title: c.title,
        readerRevision: revision.stdout.trim(),
        fetchedAt: Date.now(),
        gitDiff: data.gitDiff,
      }),
    };
  } catch (error) {
    const message = String(error?.stderr ?? error?.message ?? "");
    const reason = /wal_present|WAL|active.*snapshot/i.test(message)
      ? "active_evidence"
      : /ENOENT|not found|unavailable/i.test(message)
        ? "unavailable"
        : /timed out|killed/i.test(message)
          ? "timeout"
          : "validation_failed";
    return { ok: false, error: reason };
  }
}
