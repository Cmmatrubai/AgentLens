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
let preparedPackagingCheckout: Promise<string> | undefined;

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

interface StartUiHooks {
  readonly beforeListenerDiscovery?: (input: Readonly<{
    origin: string;
    processGroupId: number;
  }>) => Promise<void> | void;
  readonly onProcessGroup?: (processGroupId: number) => void;
}

interface ShutdownTarget {
  readonly child: ChildProcess;
  readonly knownPids: Set<number>;
  readonly processGroupId: number;
  origin?: string;
}

const gracefulShutdownTimeoutMs = 2_000;

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

async function sharedFreshCheckout(): Promise<string> {
  preparedPackagingCheckout ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-ui-fresh-checkout-"));
    roots.push(root);
    const checkout = join(root, "checkout");
    await prepareFreshCheckout(checkout);
    return checkout;
  })();
  return preparedPackagingCheckout;
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

function processExit(child: ChildProcess): ProcessExit | false {
  return child.exitCode !== null || child.signalCode !== null
    ? { code: child.exitCode, signal: child.signalCode }
    : false;
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function safeLifecycleError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown lifecycle error.";
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/(https?:\/\/127\.0\.0\.1:\d+\/bootstrap\/)[^\s]+/g, "$1[consumed]");
}

async function cleanupEvidence(target: ShutdownTarget): Promise<string> {
  let groupMembers = "inspection-error";
  try {
    const pids = await processGroupPids(target.processGroupId);
    for (const pid of pids) target.knownPids.add(pid);
    groupMembers = String(pids.length);
  } catch { /* retain the closed inspection state */ }
  const knownRemaining = [...target.knownPids].filter((pid) => !pidIsAbsent(pid)).length;
  const originState = target.origin === undefined ? "not-known" : await probeOrigin(target.origin);
  return [
    `wrapper-exited=${processExit(target.child) !== false}`,
    `group-members=${groupMembers}`,
    `known-pids-remaining=${knownRemaining}`,
    `origin=${originState}`
  ].join(", ");
}

async function awaitShutdown(target: ShutdownTarget, timeoutMs: number): Promise<ProcessExit> {
  return waitForCondition(async () => {
    const groupPids = await processGroupPids(target.processGroupId);
    for (const pid of groupPids) target.knownPids.add(pid);
    const exit = processExit(target.child);
    if (exit === false || groupPids.length !== 0 ||
        ![...target.knownPids].every(pidIsAbsent)) return false;
    if (target.origin !== undefined && await probeOrigin(target.origin) !== "refused") return false;
    return exit;
  }, "the packaged UI wrapper, process group, known PIDs, and origin to stop", timeoutMs);
}

async function shutdownProcessGroup(target: ShutdownTarget): Promise<ProcessExit> {
  let gracefulFailure: unknown;
  try {
    for (const pid of await processGroupPids(target.processGroupId)) target.knownPids.add(pid);
    signalProcessGroup(target.processGroupId, "SIGTERM");
    return await awaitShutdown(target, gracefulShutdownTimeoutMs);
  } catch (error) {
    gracefulFailure = error;
  }

  try {
    signalProcessGroup(target.processGroupId, "SIGKILL");
    return await awaitShutdown(target, 10_000);
  } catch (forcedFailure) {
    try { signalProcessGroup(target.processGroupId, "SIGKILL"); } catch { /* evidence below reports the failure */ }
    const evidence = await cleanupEvidence(target);
    throw new Error(
      `Packaged UI cleanup failed after SIGTERM (${safeLifecycleError(gracefulFailure)}) ` +
      `and SIGKILL (${safeLifecycleError(forcedFailure)}): ${evidence}`
    );
  }
}

function startupAndCleanupFailure(original: unknown, cleanup: unknown): AggregateError {
  return new AggregateError([
    new Error(`Startup: ${safeLifecycleError(original)}`),
    new Error(`Cleanup: ${safeLifecycleError(cleanup)}`)
  ], "Packaged UI startup failed and cleanup verification also failed.");
}

async function startUi(
  executable: string,
  args: readonly string[],
  cwd: string,
  hooks: StartUiHooks = {}
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
  const shutdownTarget: ShutdownTarget = {
    child,
    knownPids: new Set([processGroupId]),
    processGroupId
  };
  try {
    hooks.onProcessGroup?.(processGroupId);
    const bootstrapUrl = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for packaged UI startup.")), 20_000);
      child.stdout?.setEncoding("utf8");
      child.stderr?.resume();
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
        reject(new Error(`Packaged UI exited before startup (${code}).`));
      });
    });
    const parsed = new URL(bootstrapUrl);
    const origin = parsed.origin;
    shutdownTarget.origin = origin;
    await hooks.beforeListenerDiscovery?.({ origin, processGroupId });
    const serverPid = await waitForCondition(async () => {
      const pids = await listeningPids(parsed.port);
      return pids.length === 1 ? pids[0]! : false;
    }, "one packaged UI listener PID");
    shutdownTarget.knownPids.add(serverPid);
    const recordedPids = await waitForCondition(async () => {
      const pids = await processGroupPids(processGroupId);
      for (const pid of pids) shutdownTarget.knownPids.add(pid);
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
        closing ??= shutdownProcessGroup(shutdownTarget);
        return closing;
      }
    };
  } catch (original) {
    try {
      await shutdownProcessGroup(shutdownTarget);
    } catch (cleanup) {
      throw startupAndCleanupFailure(original, cleanup);
    }
    throw original;
  }
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
  }
  try {
    await assertStopped(ui, expectedExit);
  } catch (cleanup) {
    if (failure !== undefined) {
      throw new AggregateError([
        new Error(safeLifecycleError(failure)),
        new Error(safeLifecycleError(cleanup))
      ], "Packaged UI verification failed and cleanup verification also failed.");
    }
    throw cleanup;
  }
  return failure;
}

async function exerciseSuccessAndFailure(
  start: (hooks?: StartUiHooks) => Promise<UiProcess>,
  expectedExit: ProcessExit,
  mode: "source" | "compiled",
  exerciseThrowingHook = false
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

  if (exerciseThrowingHook) {
    let throwingHookGroupId: number | undefined;
    let throwingHookFailure: unknown;
    try {
      await start({
        onProcessGroup: (observed) => {
          throwingHookGroupId = observed;
          throw new Error("Synthetic process-group hook failure");
        }
      });
    } catch (error) {
      throwingHookFailure = error;
    }
    if (throwingHookGroupId === undefined) {
      throw new Error("The throwing-hook cleanup probe did not observe the process group.");
    }
    try {
      expect(throwingHookFailure).toMatchObject({ message: "Synthetic process-group hook failure" });
      expect(await processGroupPids(throwingHookGroupId)).toEqual([]);
      expect(pidIsAbsent(throwingHookGroupId)).toBe(true);
    } finally {
      signalProcessGroup(throwingHookGroupId, "SIGKILL");
      await waitForCondition(async () =>
        (await processGroupPids(throwingHookGroupId)).length === 0 ? true : false,
      "the throwing-hook RED-probe process group to disappear");
      await waitForCondition(() => pidIsAbsent(throwingHookGroupId) ? true : false,
        "the throwing-hook RED-probe wrapper PID to disappear");
    }
  }

  let processGroupId: number | undefined;
  let origin: string | undefined;
  let discoveryFailure: unknown;
  try {
    await start({
      onProcessGroup: (observed) => { processGroupId = observed; },
      beforeListenerDiscovery: (observed) => {
        origin = observed.origin;
        throw new Error("Synthetic pre-return listener discovery failure");
      }
    });
  } catch (error) {
    discoveryFailure = error;
  }
  if (processGroupId === undefined || origin === undefined) {
    throw new Error("The pre-return cleanup probe did not observe the process group and origin.");
  }
  try {
    expect(discoveryFailure).toMatchObject({ message: "Synthetic pre-return listener discovery failure" });
    expect(await processGroupPids(processGroupId)).toEqual([]);
    expect(pidIsAbsent(processGroupId)).toBe(true);
    expect(await probeOrigin(origin)).toBe("refused");
  } finally {
    try {
      process.kill(-processGroupId, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await waitForCondition(async () =>
      (await processGroupPids(processGroupId)).length === 0 ? true : false,
    "the RED-probe process group to disappear");
    await waitForCondition(() => pidIsAbsent(processGroupId) ? true : false,
      "the RED-probe wrapper PID to disappear");
    await waitForCondition(async () => await probeOrigin(origin) === "refused" ? true : false,
      "the RED-probe origin to refuse connections");
  }
}

async function createEmptyDataRoot(dataRoot: string): Promise<void> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  openDatabase(join(dataRoot, "agentlens.sqlite")).close();
}

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("production UI packaging", () => {
  it("preserves verification and cleanup failures while force-cleaning the real group", async () => {
    const child = spawn(process.execPath, ["-e", [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write('ready\\n');",
      "setInterval(() => {}, 1000);"
    ].join("")], {
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (child.pid === undefined) throw new Error("The dual-failure cleanup probe did not expose a PID.");
    const processGroupId = child.pid;
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    try {
      await waitForCondition(() => stdout === "ready\n" ? true : false,
        "the dual-failure cleanup probe readiness", 2_000);
      const target: ShutdownTarget = {
        child,
        knownPids: new Set([processGroupId]),
        processGroupId
      };
      const ui: UiProcess = {
        bootstrapUrl: "http://127.0.0.1:1/bootstrap/[synthetic]",
        child,
        origin: "http://127.0.0.1:1",
        processGroupId,
        recordedPids: [processGroupId],
        serverPid: processGroupId,
        async close() {
          await shutdownProcessGroup(target);
          throw new Error("Synthetic cleanup verification failure");
        }
      };
      let combined: unknown;
      try {
        await verifyWithCleanup(ui, { code: null, signal: "SIGKILL" }, async () => {
          throw new Error("Synthetic product verification failure");
        });
      } catch (error) {
        combined = error;
      }
      expect(combined).toBeInstanceOf(AggregateError);
      expect((combined as AggregateError).errors.map(safeLifecycleError)).toEqual([
        "Synthetic product verification failure",
        "Synthetic cleanup verification failure"
      ]);
      expect(await processGroupPids(processGroupId)).toEqual([]);
      expect(pidIsAbsent(processGroupId)).toBe(true);
    } finally {
      signalProcessGroup(processGroupId, "SIGKILL");
      await waitForCondition(async () =>
        (await processGroupPids(processGroupId)).length === 0 ? true : false,
      "the dual-failure cleanup probe group to disappear");
    }
  }, 15_000);

  it("escalates a resistant isolated process group and verifies disappearance", async () => {
    const child = spawn(process.execPath, ["-e", [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write('ready\\n');",
      "setInterval(() => {}, 1000);"
    ].join("")], {
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (child.pid === undefined) throw new Error("The resistant cleanup probe did not expose a PID.");
    const processGroupId = child.pid;
    let stdout = "";
    let startupFailure: unknown;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", (error) => { startupFailure = error; });
    child.once("exit", () => {
      if (stdout !== "ready\n") startupFailure = new Error("The resistant cleanup probe exited before readiness.");
    });
    try {
      await waitForCondition(() => {
        if (startupFailure !== undefined) throw startupFailure;
        return stdout === "ready\n" ? true : false;
      }, "the resistant cleanup probe readiness", 2_000);
      expect(await shutdownProcessGroup({
        child,
        knownPids: new Set([processGroupId]),
        processGroupId
      })).toEqual({ code: null, signal: "SIGKILL" });
      expect(await processGroupPids(processGroupId)).toEqual([]);
      expect(pidIsAbsent(processGroupId)).toBe(true);
    } finally {
      signalProcessGroup(processGroupId, "SIGKILL");
      await waitForCondition(async () =>
        (await processGroupPids(processGroupId)).length === 0 ? true : false,
      "the resistant cleanup probe group to disappear");
    }
  }, 15_000);

  it.each([
    ["pnpm agentlens ui", "source", "pnpm", ["agentlens", "ui"], { code: 143, signal: null }, false],
    ["compiled node ui", "compiled", process.execPath, ["apps/cli/dist/main.js", "ui"], { code: 143, signal: null }, true]
  ] as const)("serves hashed assets and the run API through %s with process-group cleanup", async (_label, mode, executable, prefix, expectedExit, exerciseThrowingHook) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-ui-package-"));
    roots.push(root);
    const checkout = await sharedFreshCheckout();
    const dataRoot = join(root, "data");
    await createEmptyDataRoot(dataRoot);
    await exerciseSuccessAndFailure(
      (hooks) => startUi(executable, [...prefix, "--data-root", dataRoot, "--no-open"], checkout, hooks),
      expectedExit,
      mode,
      exerciseThrowingHook
    );
  }, 120_000);

  it("runs a genuinely fresh offline install from built assets after all source modules are removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-ui-offline-"));
    roots.push(root);
    const checkout = await sharedFreshCheckout();
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
      (hooks) => startUi(process.execPath, [freshMain, "ui", "--data-root", dataRoot, "--no-open"], checkout, hooks),
      { code: 143, signal: null },
      "compiled"
    );
  }, 120_000);
});
