import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { installDependencies } from "./dependency-process.mjs";
const exec = promisify(execFile);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const git = (cwd, args) =>
  exec(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
    { cwd, timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
  );

export async function inspectDependencies(workspace, snapshotPaths) {
  try {
    const paths =
      snapshotPaths ??
      (await git(workspace, ["ls-files", "-z"])).stdout
        .split("\0")
        .filter(Boolean);
    if (!paths.includes("package.json"))
      return { status: "none", reason: "no_node_manifest" };
    if (!paths.includes("pnpm-lock.yaml"))
      return { status: "unsupported", reason: "pnpm_lockfile_required" };
    if (
      paths.some((p) =>
        /(^|\/)(\.npmrc|\.pnpmfile\.[cm]?js|pnpmfile\.[cm]?js)$/.test(p),
      )
    )
      return { status: "unsupported", reason: "custom_configuration" };
    if (
      paths.some((p) =>
        /(^|\/)(package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(p),
      )
    )
      return { status: "unsupported", reason: "mixed_package_managers" };
    const inputs = paths
      .filter(
        (p) =>
          /(^|\/)package\.json$/.test(p) ||
          p === "pnpm-lock.yaml" ||
          p === "pnpm-workspace.yaml",
      )
      .sort();
    if (inputs.length > 1000)
      return { status: "unsupported", reason: "manifest_limit" };
    const identities = [];
    let requestedVersion = null;
    for (const p of inputs) {
      const parts = p.split("/");
      if (parts.some((x) => !x || x === ".." || x === ".git"))
        throw Error("path");
      let current = workspace;
      for (const part of parts) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw Error("symlink");
      }
      const stat = await lstat(current);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw Error("size");
      const text = await readFile(current, "utf8");
      identities.push([p, hash(text)]);
      if (p.endsWith("package.json")) {
        const pkg = JSON.parse(text);
        if (!pkg || typeof pkg !== "object" || Array.isArray(pkg))
          throw Error("manifest");
        if (p === "package.json" && pkg.packageManager) {
          const m = /^pnpm@(11\.\d+\.\d+)(?:\+sha\d+\.[a-f0-9]+)?$/.exec(
            pkg.packageManager,
          );
          if (!m) return { status: "unsupported", reason: "pnpm_11_required" };
          requestedVersion = m[1];
        }
        if (pkg.devEngines?.runtime)
          return { status: "unsupported", reason: "managed_runtime" };
        for (const deps of [
          pkg.dependencies,
          pkg.devDependencies,
          pkg.optionalDependencies,
        ])
          if (
            deps &&
            Object.values(deps).some(
              (v) =>
                typeof v !== "string" ||
                /^(file:|link:|git\+|git:|github:|https?:|\/|\.\.)/.test(v),
            )
          )
            return { status: "unsupported", reason: "external_dependencies" };
      }
    }
    try {
      if (!snapshotPaths)
        await git(workspace, [
          "check-ignore",
          "--no-index",
          "node_modules/.agentlens-probe",
        ]);
    } catch {
      return { status: "unsupported", reason: "dependencies_not_ignored" };
    }
    return {
      status: "supported",
      manager: "pnpm",
      requestedVersion,
      fingerprint: hash(JSON.stringify(identities)),
      inputCount: identities.length,
    };
  } catch {
    return { status: "unsupported", reason: "unreadable_manifest" };
  }
}

export async function dependencyTools(plan) {
  if (process.platform !== "darwin")
    throw Error("dependency_platform_unavailable");
  const env = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: "/var/empty",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NPM_CONFIG_GLOBALCONFIG: "/dev/null",
    COREPACK_ENABLE_NETWORK: "0",
  };
  let nodeVersion, pnpmVersion;
  try {
    nodeVersion = (
      await exec("node", ["--version"], {
        cwd: tmpdir(),
        env,
        timeout: 8000,
        maxBuffer: 4000,
      })
    ).stdout.trim();
    pnpmVersion = (
      await exec(
        "pnpm",
        ["--config.manage-package-manager-versions=false", "--version"],
        { cwd: tmpdir(), env, timeout: 8000, maxBuffer: 4000 },
      )
    ).stdout.trim();
  } catch {
    throw Error("dependency_tools_unavailable");
  }
  if (
    !/^v\d+\.\d+\.\d+$/.test(nodeVersion) ||
    !/^11\.\d+\.\d+$/.test(pnpmVersion)
  )
    throw Error("dependency_tools_unavailable");
  if (plan.requestedVersion && plan.requestedVersion !== pnpmVersion)
    throw Error("dependency_version_mismatch");
  return { nodeVersion, pnpmVersion };
}

export async function prepareDependencies({
  workspace,
  root,
  plan,
  signal,
  tools: expectedTools,
  snapshotPaths,
}) {
  if (signal.aborted) throw Error("dependency_cancelled");
  const current = await inspectDependencies(workspace, snapshotPaths);
  if (
    current.status !== "supported" ||
    current.fingerprint !== plan.fingerprint
  )
    throw Error("dependency_inputs_changed");
  const tools = await dependencyTools(plan);
  if (expectedTools && JSON.stringify(tools) !== JSON.stringify(expectedTools))
    throw Error("dependency_version_mismatch");
  const result = await installDependencies({ workspace, root, signal });
  const after = await inspectDependencies(workspace, snapshotPaths);
  if (
    result.state === "completed" &&
    (after.status !== "supported" || after.fingerprint !== plan.fingerprint)
  )
    result.state = "failed";
  return {
    ...result,
    ...tools,
    fingerprint: plan.fingerprint,
    outputSha256: hash(result.output),
  };
}
