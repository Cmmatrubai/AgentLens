import { execFile as execFileCallback, spawn } from "node:child_process";
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runInspectCommand } from "../src/commands/inspect.js";

const execFile = promisify(execFileCallback);
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const compiledMain = join(workspaceRoot, "apps", "cli", "dist", "main.js");
const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const roots: string[] = [];

async function plainNode(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<Readonly<{ exitCode: number | null; stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd,
      env: { ...env, NODE_OPTIONS: "" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end();
  });
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

beforeAll(async () => {
  await execFile("pnpm", ["typecheck"], { cwd: workspaceRoot });
}, 30_000);

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged AgentLens binary", () => {
  it("runs pnpm agentlens -- from a fresh install with no compiled dist", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-cli-development-"));
    roots.push(root);
    const checkout = join(root, "checkout");
    await cp(workspaceRoot, checkout, {
      recursive: true,
      filter: (source) => {
        const parts = relative(workspaceRoot, source).split("/");
        return !parts.some((part) => [".git", ".superpowers", "dist", "node_modules"].includes(part));
      }
    });
    await execFile("pnpm", ["install", "--offline", "--frozen-lockfile"], {
      cwd: checkout,
      maxBuffer: 10 * 1024 * 1024
    });
    const dataRoot = join(root, "data");

    const result = await execFile("pnpm", [
      "agentlens", "--", "runs", "--data-root", dataRoot, "--json"
    ], { cwd: checkout, encoding: "utf8" });

    expect(JSON.parse(result.stdout)).toEqual({ runs: [] });
  }, 120_000);

  it("runs the compiled Node-shebang entry without tsx or source .js resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-cli-package-"));
    roots.push(root);
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    const dataRoot = join(root, "data");
    await mkdir(repo);
    await mkdir(bin);
    await execFile("git", ["init", "-q"], { cwd: repo });
    await execFile("git", ["config", "user.email", "fixture@example.test"], { cwd: repo });
    await execFile("git", ["config", "user.name", "AgentLens Fixture"], { cwd: repo });
    await writeFile(join(repo, "tracked.txt"), "before\n", "utf8");
    await execFile("git", ["add", "tracked.txt"], { cwd: repo });
    await execFile("git", ["commit", "-qm", "initial"], { cwd: repo });
    await copyFile(fakeCodex, join(bin, "codex"));
    await chmod(join(bin, "codex"), 0o700);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };

    expect((await readFile(compiledMain, "utf8")).split("\n")[0]).toBe("#!/usr/bin/env node");
    const recorded = await plainNode([
      compiledMain,
      "record",
      "--data-root", dataRoot,
      "--",
      "codex", "exec", "--json", "--fake-mode=success"
    ], repo, env);

    expect(recorded).toMatchObject({ exitCode: 0, stderr: "" });
    expect(recorded.stdout).toMatch(/Run ID: [0-9a-f-]+/);

    const listed = await plainNode([
      compiledMain,
      "runs",
      "--data-root", dataRoot,
      "--json"
    ], repo, env);
    expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(listed.stdout)).toMatchObject({
      runs: [{ status: "completed", child: { exitCode: 0, terminatingSignal: null } }]
    });
  });

  it("reports asynchronous record preflight failures through the stable CLI error boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-cli-preflight-"));
    roots.push(root);
    const repo = join(root, "repo");
    const dataRoot = join(root, "data");
    await mkdir(repo);
    await execFile("git", ["init", "-q"], { cwd: repo });
    await execFile("git", ["config", "user.email", "fixture@example.test"], { cwd: repo });
    await execFile("git", ["config", "user.name", "AgentLens Fixture"], { cwd: repo });
    await writeFile(join(repo, "tracked.txt"), "before\n", "utf8");
    await execFile("git", ["add", "tracked.txt"], { cwd: repo });
    await execFile("git", ["commit", "-qm", "initial"], { cwd: repo });
    await writeFile(join(repo, "dirty.txt"), "dirty\n", "utf8");

    const failed = await plainNode([
      compiledMain,
      "record",
      "--data-root", dataRoot,
      "--",
      "codex", "exec", "--json", "never spawned"
    ], repo, process.env);

    expect(failed).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "AgentLens error: AgentLens record requires a clean Git repository before child spawn.\n"
    });
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143]
  ] as const)("reconciles a public %s and exits conventionally", async (signal, expectedExit) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-cli-signal-"));
    roots.push(root);
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    const dataRoot = join(root, "data");
    const startedFile = join(root, "child-started.log");
    await mkdir(repo);
    await mkdir(bin);
    await execFile("git", ["init", "-q"], { cwd: repo });
    await execFile("git", ["config", "user.email", "fixture@example.test"], { cwd: repo });
    await execFile("git", ["config", "user.name", "AgentLens Fixture"], { cwd: repo });
    await writeFile(join(repo, "tracked.txt"), "before\n", "utf8");
    await execFile("git", ["add", "tracked.txt"], { cwd: repo });
    await execFile("git", ["commit", "-qm", "initial"], { cwd: repo });
    await copyFile(fakeCodex, join(bin, "codex"));
    await chmod(join(bin, "codex"), 0o700);

    const child = spawn(process.execPath, [
      compiledMain,
      "record",
      "--data-root", dataRoot,
      "--",
      "codex", "exec", "--json", "--fake-mode=hang"
    ], {
      cwd: repo,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        AGENTLENS_FAKE_STARTED_FILE: startedFile
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end();
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
      (resolve) => child.once("close", (code, childSignal) => resolve({ code, signal: childSignal }))
    );

    await waitForFile(startedFile);
    const runId = /Run ID: ([0-9a-f-]+)/.exec(stdout)?.[1];
    if (!runId) throw new Error("public recorder did not print a run ID");
    child.kill(signal);
    const terminal = await closed;

    let inspected: Awaited<ReturnType<typeof runInspectCommand>> | undefined;
    try {
      inspected = await runInspectCommand({
        name: "inspect",
        runId,
        dataRoot,
        json: true,
        native: false
      }, { stdout: { write: () => true } });
    } finally {
      const childPid = inspected?.run.childPid;
      if (childPid && inspected?.run.status === "running") {
        try { process.kill(childPid, "SIGKILL"); } catch { /* child already ended */ }
      }
    }

    expect(terminal).toEqual({ code: expectedExit, signal: null });
    expect(inspected.run.status).toBe("interrupted");
    expect(inspected.events.filter(({ kind }) => kind === "recorder.interruption")).toHaveLength(1);
    expect(inspected.events.filter(({ kind }) => kind === "run.reconciled")).toHaveLength(1);
  }, 15_000);

  it("uses a second public interrupt for immediate process-group escalation", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "agentlens-cli-double-signal-"));
    roots.push(root);
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    const dataRoot = join(root, "data");
    const startedFile = join(root, "child-started.log");
    const grandchildFile = join(root, "grandchild.pid");
    await mkdir(repo);
    await mkdir(bin);
    await execFile("git", ["init", "-q"], { cwd: repo });
    await execFile("git", ["config", "user.email", "fixture@example.test"], { cwd: repo });
    await execFile("git", ["config", "user.name", "AgentLens Fixture"], { cwd: repo });
    await writeFile(join(repo, "tracked.txt"), "before\n", "utf8");
    await execFile("git", ["add", "tracked.txt"], { cwd: repo });
    await execFile("git", ["commit", "-qm", "initial"], { cwd: repo });
    await copyFile(fakeCodex, join(bin, "codex"));
    await chmod(join(bin, "codex"), 0o700);

    const child = spawn(process.execPath, [
      compiledMain,
      "record",
      "--data-root", dataRoot,
      "--",
      "codex", "exec", "--json", "--fake-mode=ignore-term"
    ], {
      cwd: repo,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        AGENTLENS_FAKE_STARTED_FILE: startedFile,
        AGENTLENS_FAKE_GRANDCHILD_FILE: grandchildFile
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end();
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
      (resolve) => child.once("close", (code, signal) => resolve({ code, signal }))
    );

    await waitForFile(startedFile);
    await waitForFile(grandchildFile);
    const runId = /Run ID: ([0-9a-f-]+)/.exec(stdout)?.[1];
    if (!runId) throw new Error("public recorder did not print a run ID");
    const interruptedAt = Date.now();
    child.kill("SIGINT");
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    child.kill("SIGINT");
    const terminal = await closed;

    const inspected = await runInspectCommand({
      name: "inspect",
      runId,
      dataRoot,
      json: true,
      native: false
    }, { cwd: repo, stdout: { write: () => true } });

    expect(Date.now() - interruptedAt).toBeLessThan(1_000);
    expect(terminal).toEqual({ code: 130, signal: null });
    expect(inspected.run).toMatchObject({
      status: "interrupted",
      exitCode: null,
      terminatingSignal: "SIGKILL"
    });
    expect(inspected.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
    expect(inspected.events.some(({ kind, provenance }) =>
      kind === "turn.completed" && provenance === "observed"
    )).toBe(false);
    const groupId = inspected.ownership?.childProcessGroupId;
    if (groupId === null || groupId === undefined) throw new Error("missing process-group identity");
    expect(() => process.kill(-groupId, 0)).toThrow();
  }, 15_000);
});
