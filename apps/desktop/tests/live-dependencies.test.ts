import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  writeFile,
  mkdir,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  inspectDependencies,
  prepareDependencies,
} from "../server/live/dependencies.mjs";
import { installDependencies } from "../server/live/dependency-process.mjs";

async function fixture(t: any) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "agentlens-dependencies-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      name: "setup-fixture",
      version: "1.0.0",
      private: true,
      dependencies: { "setup-helper": "workspace:*" },
      scripts: { postinstall: "echo forbidden > script-ran" },
    }),
  );
  await mkdir(join(repo, "packages/helper"), { recursive: true });
  await writeFile(
    join(repo, "packages/helper/package.json"),
    JSON.stringify({
      name: "setup-helper",
      version: "1.0.0",
      main: "index.cjs",
    }),
  );
  await writeFile(
    join(repo, "packages/helper/index.cjs"),
    "module.exports = 42;",
  );
  await writeFile(
    join(repo, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n",
  );
  await writeFile(join(repo, ".gitignore"), "node_modules/\n");
  execFileSync(
    "pnpm",
    [
      "install",
      "--lockfile-only",
      "--offline",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--config.manage-package-manager-versions=false",
    ],
    { cwd: repo, stdio: "pipe" },
  );
  git("add", ".");
  git("commit", "-qm", "fixture");
  return { root, repo, git };
}
test("dependency plans identify committed lockfiles and reject hooks, missing locks and symlinks", async (t) => {
  const f = await fixture(t);
  const plan = await inspectDependencies(f.repo);
  assert.equal(plan.status, "supported");
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  await writeFile(join(f.repo, ".npmrc"), "registry=https://example.invalid");
  f.git("add", ".npmrc");
  assert.equal(
    (await inspectDependencies(f.repo)).reason,
    "custom_configuration",
  );
  f.git("rm", "-f", ".npmrc");
  await rm(join(f.repo, "pnpm-lock.yaml"));
  assert.equal((await inspectDependencies(f.repo)).status, "unsupported");
  await symlink("/etc/hosts", join(f.repo, "pnpm-lock.yaml"));
  assert.equal(
    (await inspectDependencies(f.repo)).reason,
    "unreadable_manifest",
  );
});
test(
  "a stale lockfile fails without updating it and installation timeout remains distinct",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t);
    const before = await readFile(join(f.repo, "pnpm-lock.yaml"), "utf8");
    const pkg = JSON.parse(
      await readFile(join(f.repo, "package.json"), "utf8"),
    );
    pkg.dependencies["is-number"] = "7.0.0";
    await writeFile(join(f.repo, "package.json"), JSON.stringify(pkg));
    const plan = await inspectDependencies(f.repo);
    const failed = await prepareDependencies({
      workspace: f.repo,
      root: join(f.root, "failed"),
      plan,
      signal: new AbortController().signal,
    });
    assert.equal(failed.state, "failed");
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.output, /OUTDATED_LOCKFILE/);
    assert.equal(
      await readFile(join(f.repo, "pnpm-lock.yaml"), "utf8"),
      before,
    );
    const timed = await installDependencies({
      workspace: f.repo,
      root: join(f.root, "timed"),
      signal: new AbortController().signal,
      timeoutMs: 1,
    });
    assert.equal(timed.state, "timed_out");
    assert.equal(timed.cleanupConfirmed, true);
  },
);
test(
  "real preparation freezes the lockfile, skips scripts and saves local tool versions",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t);
    const before = await readFile(join(f.repo, "pnpm-lock.yaml"), "utf8");
    const plan = await inspectDependencies(f.repo);
    const result = await prepareDependencies({
      workspace: f.repo,
      root: join(f.root, "setup"),
      plan,
      signal: new AbortController().signal,
    });
    assert.equal(result.state, "completed", result.output);
    assert.equal(result.exitCode, 0);
    assert.match(result.pnpmVersion, /^11\./);
    assert.match(result.nodeVersion, /^v\d+/);
    assert.equal(
      await readFile(join(f.repo, "pnpm-lock.yaml"), "utf8"),
      before,
    );
    await assert.rejects(readFile(join(f.repo, "script-ran")));
    assert.equal(
      execFileSync("node", ["-e", 'console.log(require("setup-helper"))'], {
        cwd: f.repo,
        encoding: "utf8",
      }).trim(),
      "42",
    );
    assert.equal(f.git("status", "--porcelain"), "");
  },
);
test("changed dependency inputs are rejected before install and pre-aborted preparation never starts", async (t) => {
  const f = await fixture(t);
  const plan = await inspectDependencies(f.repo);
  await writeFile(join(f.repo, "package.json"), "{}");
  await assert.rejects(
    prepareDependencies({
      workspace: f.repo,
      root: join(f.root, "setup"),
      plan,
      signal: new AbortController().signal,
    }),
    /dependency_inputs_changed/,
  );
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(
    prepareDependencies({
      workspace: f.repo,
      root: join(f.root, "setup"),
      plan,
      signal: stop.signal,
    }),
    /dependency_cancelled/,
  );
});
