import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../../../packages/storage/src/index.js";

const execFile = promisify(execFileCallback);
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const roots: string[] = [];

interface UiProcess {
  readonly child: ChildProcess;
  readonly bootstrapUrl: string;
  close(): Promise<number | null>;
}

async function copyTrackedWorkspace(checkout: string): Promise<void> {
  await mkdir(checkout, { recursive: true });
  const listed = await execFile("git", ["ls-files", "-z"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  for (const path of listed.stdout.split("\0").filter(Boolean)) {
    const destination = join(checkout, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(workspaceRoot, path), destination);
  }
}

async function prepareFreshCheckout(checkout: string): Promise<void> {
  await copyTrackedWorkspace(checkout);
  await execFile("pnpm", ["install", "--offline", "--frozen-lockfile"], {
    cwd: checkout,
    maxBuffer: 10 * 1024 * 1024
  });
  await execFile("pnpm", ["build"], {
    cwd: checkout,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function startUi(
  executable: string,
  args: readonly string[],
  cwd: string
): Promise<UiProcess> {
  const child = spawn(executable, [...args], {
    cwd,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const bootstrapUrl = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for packaged UI startup.")), 20_000);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/, 1)[0];
      if (line === undefined) return;
      try {
        const parsed = new URL(line);
        if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.startsWith("/bootstrap/")) return;
        clearTimeout(timeout);
        resolve(parsed.href);
      } catch { /* wait for a complete first line */ }
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Packaged UI exited before startup (${code}): ${stderr.slice(0, 160)}`));
    });
  });
  let closing: Promise<number | null> | undefined;
  return {
    child,
    bootstrapUrl,
    close() {
      closing ??= new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
        child.kill("SIGTERM");
      });
      return closing;
    }
  };
}

async function verifyUi(ui: UiProcess): Promise<void> {
  const bootstrap = await fetch(ui.bootstrapUrl);
  expect(bootstrap.status).toBe(200);
  expect(bootstrap.headers.get("cache-control")).toBe("no-store");
  const html = await bootstrap.text();
  const entryUrl = /import\(("\/assets\/[^"]+-[A-Za-z0-9_-]+\.js")\)/.exec(html)?.[1];
  const tokenLiteral = /const token = ("[A-Za-z0-9_-]+");/.exec(html)?.[1];
  if (entryUrl === undefined || tokenLiteral === undefined) {
    throw new Error("Bootstrap did not bind hashed assets and in-memory authorization.");
  }
  const origin = new URL(ui.bootstrapUrl).origin;
  const asset = await fetch(new URL(JSON.parse(entryUrl) as string, origin));
  expect(asset.status).toBe(200);
  expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
  const runs = await fetch(`${origin}/api/v1/runs?limit=50`, {
    headers: { Authorization: `Bearer ${JSON.parse(tokenLiteral) as string}` }
  });
  expect(runs.status).toBe(200);
  expect(runs.headers.get("cache-control")).toBe("no-store");
  expect(await runs.json()).toMatchObject({ schemaVersion: 1, items: [] });
}

async function createEmptyDataRoot(dataRoot: string): Promise<void> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  openDatabase(join(dataRoot, "agentlens.sqlite")).close();
}

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("production UI packaging", () => {
  it.each([
    ["pnpm agentlens ui", "source"],
    ["compiled node ui", "compiled"]
  ] as const)("serves hashed assets and the run API through %s with SIGTERM cleanup", async (_label, mode) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-ui-package-"));
    roots.push(root);
    const checkout = join(root, "checkout");
    await prepareFreshCheckout(checkout);
    const dataRoot = join(root, "data");
    await createEmptyDataRoot(dataRoot);
    const executable = mode === "source" ? "pnpm" : process.execPath;
    const prefix = mode === "source"
      ? ["agentlens", "ui"]
      : [join(checkout, "apps", "cli", "dist", "main.js"), "ui"];
    const ui = await startUi(executable, [...prefix, "--data-root", dataRoot, "--no-open"], checkout);
    try {
      await verifyUi(ui);
    } finally {
      expect(await ui.close()).toBe(143);
    }
    expect(() => process.kill(ui.child.pid!, 0)).toThrow();
  }, 120_000);

  it("runs a genuinely fresh offline install from built assets after all source modules are removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-ui-offline-"));
    roots.push(root);
    const checkout = join(root, "checkout");
    await prepareFreshCheckout(checkout);
    for (const relativePath of [
      "apps/cli/src",
      "apps/server/src",
      "apps/web/src",
      "packages/api-contract/src",
      "packages/application/src",
      "packages/codex/src",
      "packages/core/src",
      "packages/derivations/src",
      "packages/storage/src"
    ]) await rm(join(checkout, relativePath), { recursive: true, force: true });

    const freshMain = join(checkout, "apps", "cli", "dist", "main.js");
    const dataRoot = join(root, "data");
    await createEmptyDataRoot(dataRoot);
    const ui = await startUi(process.execPath, [freshMain, "ui", "--data-root", dataRoot, "--no-open"], checkout);
    try {
      await verifyUi(ui);
    } finally {
      expect(await ui.close()).toBe(143);
    }
    expect(() => process.kill(ui.child.pid!, 0)).toThrow();
  }, 120_000);
});
