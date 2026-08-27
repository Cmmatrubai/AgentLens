import { execFile as execFileCallback, spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

beforeAll(async () => {
  await execFile("pnpm", ["typecheck"], { cwd: workspaceRoot });
}, 30_000);

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged AgentLens binary", () => {
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
});
