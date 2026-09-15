import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { displayText } from "../recorded-projector.mjs";

export async function runCheckCommand({
  workspace,
  command,
  timeoutMs,
  signal,
}) {
  if (process.platform !== "darwin") throw Error("check_platform_unavailable");
  workspace = await realpath(workspace);
  const home = join(workspace, ".agentlens-check-home"),
    tmp = join(workspace, ".agentlens-check-tmp");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(tmp, { recursive: true, mode: 0o700 });
  if (signal.aborted)
    return {
      state: "cancelled",
      exitCode: null,
      output: "",
      outputTruncated: false,
      durationMs: 0,
      cleanupConfirmed: true,
    };
  const profile = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(workspace)}) (literal "/dev/null"))`;
  return new Promise((resolve) => {
    const began = Date.now();
    let reason = null,
      error = false,
      finished = false,
      kept = 0,
      truncated = false;
    const chunks = [];
    const child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", profile, "/bin/sh", "-c", command],
      {
        cwd: workspace,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH || "/usr/bin:/bin",
          HOME: home,
          TMPDIR: tmp,
          LANG: "en_US.UTF-8",
          CI: "1",
        },
      },
    );
    const kill = (sig) => {
      if (child.pid)
        try {
          process.kill(-child.pid, sig);
        } catch {}
    };
    let force;
    const stop = (state) => {
      if (reason || finished) return;
      reason = state;
      kill("SIGTERM");
      force = setTimeout(() => kill("SIGKILL"), 500);
    };
    const abort = () => stop("cancelled");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(() => stop("timed_out"), timeoutMs);
    const output = (chunk) => {
      const room = 16384 - kept;
      if (chunk.length > room) truncated = true;
      if (room > 0) {
        chunks.push(chunk.subarray(0, room));
        kept += Math.min(room, chunk.length);
      }
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.once("error", () => {
      error = true;
    });
    child.once("close", (code) => {
      finished = true;
      clearTimeout(deadline);
      clearTimeout(force);
      signal.removeEventListener("abort", abort);
      // A shell can exit before its background jobs. Stop the whole group on every exit.
      kill("SIGKILL");
      setTimeout(() => {
        let cleanupConfirmed = true;
        if (child.pid)
          try {
            process.kill(-child.pid, 0);
            cleanupConfirmed = false;
          } catch (e) {
            cleanupConfirmed = e.code === "ESRCH";
          }
        resolve({
          state: reason ?? (error ? "unavailable" : "completed"),
          exitCode: Number.isInteger(code) ? code : null,
          output: displayText(Buffer.concat(chunks).toString("utf8")).replace(
            /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,
            "",
          ),
          outputTruncated: truncated,
          durationMs: Date.now() - began,
          cleanupConfirmed,
        });
      }, 50);
    });
  });
}
