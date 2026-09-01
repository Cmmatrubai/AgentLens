import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../../../packages/storage/src/index.js";

const execFile = promisify(execFileCallback);
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const roots: string[] = [];

interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface UiProcess {
  readonly bootstrapUrl: string;
  readonly child: ChildProcess;
  readonly origin: string;
  readonly processGroupId: number;
  readonly recordedPids: readonly number[];
  readonly serverPid: number;
  close(): Promise<ProcessExit>;
}

async function waitForCondition<T>(
  condition: () => T | false | Promise<T | false>,
  description: string,
  timeoutMs = 10_000
): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    const result = await condition();
    if (result !== false) return result;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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

async function processGroupPids(processGroupId: number): Promise<number[]> {
  const listed = await execFile("ps", ["-axo", "pid=,pgid="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  return listed.stdout.split(/\r?\n/).flatMap((line) => {
    const [pidText, groupText] = line.trim().split(/\s+/, 2);
    const pid = Number(pidText);
    const group = Number(groupText);
    return Number.isSafeInteger(pid) && group === processGroupId ? [pid] : [];
  }).sort((left, right) => left - right);
}

async function listeningPids(port: string): Promise<number[]> {
  try {
    const listed = await execFile("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    return [...new Set(listed.stdout.split(/\s+/).filter(Boolean).map(Number)
      .filter((pid) => Number.isSafeInteger(pid) && pid > 0))].sort((left, right) => left - right);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
    if (code === 1 || code === "1") return [];
    throw error;
  }
}

function pidIsAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function probeOrigin(origin: string): Promise<"listening" | "refused" | "unavailable"> {
  const parsed = new URL(origin);
  return new Promise((resolve) => {
    const socket = createConnection({ host: parsed.hostname, port: Number(parsed.port) });
    let settled = false;
    const finish = (result: "listening" | "refused" | "unavailable"): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish("listening"));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ECONNREFUSED" ? "refused" : "unavailable"));
    socket.setTimeout(1_000, () => finish("unavailable"));
  });
}

async function startUi(
  executable: string,
  args: readonly string[],
  cwd: string
): Promise<UiProcess> {
  const child = spawn(executable, [...args], {
    cwd,
    detached: true,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (child.pid === undefined) throw new Error("Packaged UI did not expose a process identifier.");
  const processGroupId = child.pid;
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
  const parsed = new URL(bootstrapUrl);
  const origin = parsed.origin;
  const serverPid = await waitForCondition(async () => {
    const pids = await listeningPids(parsed.port);
    return pids.length === 1 ? pids[0]! : false;
  }, "one packaged UI listener PID");
  const recordedPids = await waitForCondition(async () => {
    const pids = await processGroupPids(processGroupId);
    return pids.includes(serverPid) ? pids : false;
  }, "the listening server to belong to the isolated process group");
  let closing: Promise<ProcessExit> | undefined;
  return {
    bootstrapUrl,
    child,
    origin,
    processGroupId,
    recordedPids,
    serverPid,
    close() {
      closing ??= (async () => {
        try {
          process.kill(-processGroupId, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        const exit = await waitForCondition<ProcessExit>(() =>
          child.exitCode !== null || child.signalCode !== null
            ? { code: child.exitCode, signal: child.signalCode }
            : false,
        "the packaged UI wrapper to exit");
        await waitForCondition(async () =>
          (await processGroupPids(processGroupId)).length === 0 ? true : false,
        "the packaged UI process group to disappear");
        await waitForCondition(() =>
          recordedPids.every(pidIsAbsent) ? true : false,
        "every recorded packaged UI PID to disappear");
        await waitForCondition(async () =>
          await probeOrigin(origin) === "refused" ? true : false,
        "the exact packaged UI origin to refuse connections");
        return exit;
      })();
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
  const asset = await fetch(new URL(JSON.parse(entryUrl) as string, ui.origin));
  expect(asset.status).toBe(200);
  expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
  const runs = await fetch(`${ui.origin}/api/v1/runs?limit=50`, {
    headers: { Authorization: `Bearer ${JSON.parse(tokenLiteral) as string}` }
  });
  expect(runs.status).toBe(200);
  expect(runs.headers.get("cache-control")).toBe("no-store");
  expect(await runs.json()).toMatchObject({ schemaVersion: 1, items: [] });
}

async function assertStopped(ui: UiProcess, expectedExit: ProcessExit): Promise<void> {
  expect(await ui.close()).toEqual(expectedExit);
  expect(await processGroupPids(ui.processGroupId)).toEqual([]);
  for (const pid of ui.recordedPids) expect(pidIsAbsent(pid), `PID ${pid} must be absent after cleanup.`).toBe(true);
  expect(await probeOrigin(ui.origin)).toBe("refused");
}

async function verifyWithCleanup(
  ui: UiProcess,
  expectedExit: ProcessExit,
  verification: () => Promise<void>
): Promise<unknown> {
  let failure: unknown;
  try {
    await verification();
  } catch (error) {
    failure = error;
  } finally {
    await assertStopped(ui, expectedExit);
  }
  return failure;
}

async function exerciseSuccessAndFailure(
  start: () => Promise<UiProcess>,
  expectedExit: ProcessExit,
  mode: "source" | "compiled"
): Promise<void> {
  const success = await start();
  expect(success.recordedPids).toContain(success.serverPid);
  expect(success.recordedPids).toContain(success.child.pid);
  if (mode === "source") expect(success.serverPid).not.toBe(success.child.pid);
  else expect(success.serverPid).toBe(success.child.pid);
  expect(await verifyWithCleanup(success, expectedExit, () => verifyUi(success))).toBeUndefined();

  const induced = await start();
  const failure = await verifyWithCleanup(induced, expectedExit, async () => {
    await verifyUi(induced);
    throw new Error("Synthetic post-start verification failure");
  });
  expect(failure).toMatchObject({ message: "Synthetic post-start verification failure" });
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
    ["pnpm agentlens ui", "source", "pnpm", ["agentlens", "ui"], { code: 143, signal: null }],
    ["compiled node ui", "compiled", process.execPath, ["apps/cli/dist/main.js", "ui"], { code: 143, signal: null }]
  ] as const)("serves hashed assets and the run API through %s with process-group cleanup", async (_label, mode, executable, prefix, expectedExit) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-ui-package-"));
    roots.push(root);
    const checkout = join(root, "checkout");
    await prepareFreshCheckout(checkout);
    const dataRoot = join(root, "data");
    await createEmptyDataRoot(dataRoot);
    await exerciseSuccessAndFailure(
      () => startUi(executable, [...prefix, "--data-root", dataRoot, "--no-open"], checkout),
      expectedExit,
      mode
    );
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
    await exerciseSuccessAndFailure(
      () => startUi(process.execPath, [freshMain, "ui", "--data-root", dataRoot, "--no-open"], checkout),
      { code: 143, signal: null },
      "compiled"
    );
  }, 120_000);
});
