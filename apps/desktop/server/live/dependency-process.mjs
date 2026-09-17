import { spawn } from "node:child_process";
import { realpath, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { displayText } from "../recorded-projector.mjs";

export async function installDependencies({
  workspace,
  root,
  signal,
  timeoutMs = 300000,
}) {
  if (process.platform !== "darwin")
    throw Error("dependency_platform_unavailable");
  workspace = await realpath(workspace);
  await mkdir(root, { recursive: true, mode: 0o700 });
  root = await realpath(root);
  const home = join(root, "home"),
    tmp = join(root, "tmp");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(tmp, { recursive: true, mode: 0o700 });
  const args = [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--no-runtime",
    "--config.manage-package-manager-versions=false",
    "--config.package-manager-strict-version=true",
    "--config.engine-strict=true",
    "--config.side-effects-cache=false",
    "--store-dir",
    join(root, "store"),
    "--reporter=append-only",
  ];
  // Retain every effective option without storing a machine-specific directory.
  const command = [
    "pnpm",
    ...args.map((arg) =>
      arg === join(root, "store") ? "<per-copy-store>" : arg,
    ),
  ].join(" ");
  if (signal.aborted)
    return {
      state: "cancelled",
      exitCode: null,
      output: "",
      outputTruncated: false,
      durationMs: 0,
      cleanupConfirmed: true,
      command,
    };
  const profile = `(version 1)(allow default)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(workspace)}) (subpath ${JSON.stringify(root)}) (literal "/dev/null"))`;
  return new Promise((resolve) => {
    const began = Date.now();
    let reason,
      failed = false,
      finished = false,
      kept = 0,
      truncated = false,
      force;
    const chunks = [];
    const child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", profile, "/usr/bin/env", "pnpm", ...args],
      {
        cwd: workspace,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH || "/usr/bin:/bin",
          HOME: home,
          TMPDIR: tmp,
          CI: "1",
          LANG: "en_US.UTF-8",
          XDG_CACHE_HOME: join(home, "cache"),
          XDG_CONFIG_HOME: join(home, "config"),
          XDG_DATA_HOME: join(home, "data"),
          NPM_CONFIG_USERCONFIG: "/dev/null",
          NPM_CONFIG_GLOBALCONFIG: "/dev/null",
          COREPACK_ENABLE_AUTO_PIN: "0",
          COREPACK_ENABLE_NETWORK: "0",
        },
      },
    );
    const kill = (sig) => {
      if (child.pid)
        try {
          process.kill(-child.pid, sig);
        } catch {}
    };
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
    const append = (chunk) => {
      const room = 16384 - kept;
      if (chunk.length > room) truncated = true;
      if (room > 0) {
        chunks.push(chunk.subarray(0, room));
        kept += Math.min(room, chunk.length);
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", () => {
      failed = true;
    });
    // Do not wait for inherited stdout from background children before cleanup.
    child.once("exit", () => kill("SIGKILL"));
    child.once("close", (code) => {
      finished = true;
      clearTimeout(deadline);
      clearTimeout(force);
      signal.removeEventListener("abort", abort);
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
          state:
            reason ??
            (failed ? "unavailable" : code === 0 ? "completed" : "failed"),
          exitCode: Number.isInteger(code) ? code : null,
          output: displayText(Buffer.concat(chunks).toString("utf8"))
            .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted]")
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""),
          outputTruncated: truncated,
          durationMs: Date.now() - began,
          cleanupConfirmed,
          command,
        });
      }, 50);
    });
  });
}
