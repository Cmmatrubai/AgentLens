import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { watch } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, openDatabaseForServerRead, RunRepository } from "@agentlens/storage";

const execFile = promisify(execFileCallback);
const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const tsx = join(projectRoot, "node_modules", ".bin", "tsx");
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentlens-crash-recovery-"));
  roots.push(root);
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const dataRoot = join(root, "data");
  const startedFile = join(root, "child-started.log");
  const readyFile = join(root, "provider-ready.log");
  const barrierSocket = join(root, "provider-release.sock");
  await mkdir(repo);
  await mkdir(bin);
  await execFile("git", ["init", "-q"], { cwd: repo });
  await execFile("git", ["config", "user.email", "fixture@example.test"], { cwd: repo });
  await execFile("git", ["config", "user.name", "AgentLens Fixture"], { cwd: repo });
  await writeFile(join(repo, "tracked.txt"), "before\n");
  await execFile("git", ["add", "tracked.txt"], { cwd: repo });
  await execFile("git", ["commit", "-qm", "initial"], { cwd: repo });
  await copyFile(fakeCodex, join(bin, "codex"));
  await chmod(join(bin, "codex"), 0o700);
  return {
    repo,
    dataRoot,
    barrierSocket,
    readyFile,
    startedFile,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      AGENTLENS_FAKE_STARTED_FILE: startedFile,
      AGENTLENS_FAKE_BARRIER_SOCKET: barrierSocket,
      AGENTLENS_FAKE_READY_FILE: readyFile
    }
  };
}

async function releaseProviderBarrier(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => { socket.end("provider-release\n"); });
    socket.once("close", (hadError) => {
      if (!hadError) resolve();
    });
    socket.once("error", reject);
  });
}

async function fileContains(path: string, marker: string): Promise<boolean> {
  return readFile(path, "utf8").then((value) => value.includes(marker), () => false);
}

async function waitForMarker(
  path: string,
  marker: string,
  recorder: ChildProcessWithoutNullStreams,
  stdout: () => string,
  stderr: () => string
): Promise<void> {
  if (await fileContains(path, marker)) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const watcher = watch(dirname(path), { persistent: false }, (_event, filename) => {
      if (filename === null || filename.toString() === basename(path)) void check();
    });
    const cleanup = (): void => {
      watcher.close();
      recorder.off("close", onClose);
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const check = async (): Promise<void> => {
      if (await fileContains(path, marker)) succeed();
    };
    const onClose = (): void => {
      fail(new Error(`Recorder exited before provider readiness: stdout=${stdout()} stderr=${stderr()}`));
    };
    recorder.once("close", onClose);
    if (recorder.exitCode !== null || recorder.signalCode !== null) onClose();
    else void check();
  });
}

async function waitForRunId(
  stdout: () => string,
  recorder: ChildProcessWithoutNullStreams,
  stderr: () => string
): Promise<string> {
  const current = /Run ID: ([^\n]+)/.exec(stdout())?.[1];
  if (current !== undefined) return current;
  return new Promise<string>((resolve, reject) => {
    const cleanup = (): void => {
      recorder.stdout.off("data", onData);
      recorder.off("close", onClose);
    };
    const onData = (): void => {
      const runId = /Run ID: ([^\n]+)/.exec(stdout())?.[1];
      if (runId === undefined) return;
      cleanup();
      resolve(runId);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error(`Recorder exited before publishing its run ID: stdout=${stdout()} stderr=${stderr()}`));
    };
    recorder.stdout.on("data", onData);
    recorder.once("close", onClose);
    onData();
  });
}

function startCli(
  context: Awaited<ReturnType<typeof fixture>>,
  args: readonly string[]
): ChildProcessWithoutNullStreams {
  return spawn(tsx, ["--conditions=development", main, ...args], {
    cwd: context.repo,
    detached: process.platform !== "win32",
    env: context.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

async function ownsProcessGroup(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (child.pid === undefined) return false;
  const listed = await execFile("ps", ["-o", "pgid=", "-p", String(child.pid)], {
    encoding: "utf8"
  });
  return Number(listed.stdout.trim()) === child.pid;
}

async function finish(child: ChildProcessWithoutNullStreams): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      code: child.exitCode,
      signal: child.signalCode,
      stdout,
      stderr
    };
  }
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { ...result, stdout, stderr };
}

async function runCli(
  context: Awaited<ReturnType<typeof fixture>>,
  args: readonly string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = startCli(context, args);
  child.stdin.end();
  return finish(child);
}

function detail(dataRoot: string, runId: string) {
  const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
  try {
    return new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    }).getRunDetail(runId);
  } finally {
    database.close();
  }
}

function readOnlyDetail(dataRoot: string, runId: string) {
  const { database } = openDatabaseForServerRead(join(dataRoot, "agentlens.sqlite"));
  try {
    return new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    }).getRunDetail(runId);
  } finally {
    database.close();
  }
}

async function waitForOpenRun(
  dataRoot: string,
  stdout: () => string,
  recorder: ChildProcessWithoutNullStreams,
  stderr: () => string
): Promise<{
  runId: string;
  recorderPid: number;
  childProcessGroupId: number;
  originalOpen: string;
}> {
  const deadline = Date.now() + 5_000;
  let lastState = "run id unavailable";
  let childStarted = false;
  while (Date.now() < deadline) {
    if (recorder.exitCode !== null || recorder.signalCode !== null) {
      throw new Error(`Recorder exited before open work: stdout=${stdout()} stderr=${stderr()}`);
    }
    const runId = /Run ID: ([^\n]+)/.exec(stdout())?.[1];
    if (!childStarted) {
      childStarted = await readFile(join(dataRoot, "..", "child-started.log"), "utf8")
        .then((value) => value.includes("child-started"), () => false);
    }
    if (runId && childStarted) {
      try {
        const run = readOnlyDetail(dataRoot, runId);
        lastState = JSON.stringify({
          status: run.run.status,
          ownership: run.ownership,
          childStarted,
          events: run.events.map(({ kind, status }) => ({ kind, status }))
        });
        const open = run.events.find(({ kind, status }) => kind === "command" && status === "in_progress");
        const recorderPid = run.ownership?.recorderPid;
        const processGroup = run.ownership?.childProcessGroupId;
        if (open && recorderPid && processGroup) {
          const checkpointedOpen = detail(dataRoot, runId).events.find(
            ({ kind, status }) => kind === "command" && status === "in_progress"
          );
          if (checkpointedOpen === undefined) continue;
          return {
            runId,
            recorderPid,
            childProcessGroupId: processGroup,
            originalOpen: JSON.stringify(checkpointedOpen)
          };
        }
      } catch {
        // Run creation and first event are separate durable steps.
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for durable open provider work: state=${lastState} stdout=${stdout()} stderr=${stderr()}`
  );
}

async function waitForGroupGone(processGroupId: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(-processGroupId, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process group ${processGroupId} remained alive.`);
}

async function waitForPidGone(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process ${pid} remained alive.`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable crash ownership recovery", () => {
  it("diagnoses on reads and reconciles a dead recorder at clean record startup", async () => {
    const context = await fixture();
    const recorder = startCli(context, [
      "record", "--data-root", context.dataRoot, "--",
      "codex", "exec", "--json", "--fake-mode=crash-barrier"
    ]);
    expect(await ownsProcessGroup(recorder), "The crash probe recorder must own an isolated process group.").toBe(true);
    recorder.stdin.end();
    let recorderStdout = "";
    let recorderStderr = "";
    recorder.stdout.on("data", (chunk: Buffer) => { recorderStdout += chunk.toString("utf8"); });
    recorder.stderr.on("data", (chunk: Buffer) => { recorderStderr += chunk.toString("utf8"); });
    let opened: Awaited<ReturnType<typeof waitForOpenRun>> | undefined;

    try {
      await waitForMarker(
        context.readyFile,
        "provider-ready",
        recorder,
        () => recorderStdout,
        () => recorderStderr
      );
      const preReleaseRunId = await waitForRunId(() => recorderStdout, recorder, () => recorderStderr);
      const preRelease = readOnlyDetail(context.dataRoot, preReleaseRunId);
      expect(preRelease.run.status).toBe("running");
      expect(preRelease.events.some(({ kind, status }) => kind === "command" && status === "in_progress"))
        .toBe(false);
      await releaseProviderBarrier(context.barrierSocket);
      opened = await waitForOpenRun(
        context.dataRoot,
        () => recorderStdout,
        recorder,
        () => recorderStderr
      );
      process.kill(opened.recorderPid, "SIGSTOP");

      const liveRead = await runCli(context, [
        "inspect", opened.runId, "--data-root", context.dataRoot, "--json"
      ]);
      expect(liveRead.code, liveRead.stderr).toBe(0);
      const live = JSON.parse(liveRead.stdout) as {
        run: { status: string };
        ownership: { condition: string };
        events: Array<{ kind: string }>;
      };
      expect(live.run.status).toBe("running");
      expect(live.ownership.condition).toBe("active");
      expect(live.events.some(({ kind }) => kind === "recorder.ownership_lost")).toBe(false);

      process.kill(opened.recorderPid, "SIGKILL");
      await waitForPidGone(opened.recorderPid);

      const staleRead = await runCli(context, [
        "inspect", opened.runId, "--data-root", context.dataRoot, "--json"
      ]);
      expect(staleRead.code).toBe(0);
      const stale = JSON.parse(staleRead.stdout) as {
        run: { status: string; endedAt: number | null };
        ownership: { condition: string; diagnosis: string };
        events: Array<{ kind: string }>;
        gitEvidence: { available: boolean };
      };
      expect(stale.run).toMatchObject({ status: "running", endedAt: null });
      expect(stale.ownership).toMatchObject({ condition: "active", diagnosis: "likely_stale" });
      expect(stale.events.filter(({ kind }) => kind === "recorder.ownership_lost")).toEqual([]);
      expect(stale.gitEvidence.available).toBe(false);

      const orphanTrigger = await runCli(context, [
        "record", "--data-root", context.dataRoot, "--",
        "codex", "exec", "--json", "--fake-mode=success"
      ]);
      expect(orphanTrigger.code).toBe(0);
      const orphanRead = await runCli(context, [
        "inspect", opened.runId, "--data-root", context.dataRoot, "--json"
      ]);
      expect(orphanRead.code).toBe(0);
      const orphan = JSON.parse(orphanRead.stdout) as {
        run: { status: string; endedAt: number | null };
        ownership: { condition: string; diagnosis: string };
        events: Array<{ kind: string }>;
        gitEvidence: { available: boolean };
      };
      expect(orphan.run).toMatchObject({ status: "running", endedAt: null });
      expect(orphan.ownership).toMatchObject({
        condition: "orphan_child_active",
        diagnosis: "orphan_child_active"
      });
      expect(orphan.events.filter(({ kind }) => kind === "recorder.ownership_lost")).toHaveLength(1);
      expect(orphan.gitEvidence.available).toBe(false);

      process.kill(-opened.childProcessGroupId, "SIGKILL");
      await waitForGroupGone(opened.childProcessGroupId);

      const recoveryTrigger = await runCli(context, [
        "record", "--data-root", context.dataRoot, "--",
        "codex", "exec", "--json", "--fake-mode=success"
      ]);
      expect(recoveryTrigger.code).toBe(0);

      const recoveredRead = await runCli(context, [
        "inspect", opened.runId, "--data-root", context.dataRoot, "--json"
      ]);
      expect(recoveredRead.code).toBe(0);
      const recovered = JSON.parse(recoveredRead.stdout) as {
        run: {
          status: string;
          terminalReason: string;
          exitCode: number | null;
          terminatingSignal: string | null;
          providerTerminalKind: string | null;
        };
        ownership: { condition: string };
        events: Array<{ id: string; kind: string; provenance: string }>;
        gitEvidence: { available: boolean };
      };
      expect(recovered.run).toMatchObject({
        status: "interrupted",
        terminalReason: "recorder_crash",
        exitCode: null,
        terminatingSignal: null,
        providerTerminalKind: null
      });
      expect(recovered.ownership.condition).toBe("released");
      expect(recovered.events.filter(({ kind }) => kind === "recorder.ownership_lost")).toHaveLength(1);
      expect(recovered.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
      expect(recovered.events.filter(({ kind }) => kind === "run.reconciled")).toHaveLength(1);
      expect(recovered.events.filter(({ kind }) =>
        kind === "test.command" || kind === "test.result"
      )).toEqual([]);
      expect(recovered.events.some(({ kind }) => kind === "recorder.process_exit")).toBe(false);
      expect(recovered.events.some(({ kind, provenance }) =>
        provenance === "observed" && kind === "turn.completed"
      )).toBe(false);
      expect(recovered.gitEvidence.available).toBe(true);

      const durable = detail(context.dataRoot, opened.runId);
      expect(JSON.stringify(durable.events.find(({ kind }) => kind === "command")))
        .toBe(opened.originalOpen);

      const repeatedRead = await runCli(context, [
        "inspect", opened.runId, "--data-root", context.dataRoot, "--json"
      ]);
      const repeated = JSON.parse(repeatedRead.stdout) as { events: Array<{ kind: string }> };
      expect(repeated.events.filter(({ kind }) => kind === "recorder.ownership_lost")).toHaveLength(1);
      expect(repeated.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
      expect(repeated.events.filter(({ kind }) => kind === "run.reconciled")).toHaveLength(1);
    } finally {
      if (opened !== undefined) {
        try {
          process.kill(opened.recorderPid, "SIGKILL");
        } catch {
          // The expected crash path already terminated the durable recorder.
        }
        try {
          process.kill(-opened.childProcessGroupId, "SIGKILL");
        } catch {
          // The expected recovery path already terminated the child group externally.
        }
      }
      if (recorder.pid !== undefined && process.platform !== "win32") {
        try {
          process.kill(-recorder.pid, "SIGKILL");
        } catch {
          // The detached recorder process group already exited.
        }
      } else if (recorder.exitCode === null && recorder.signalCode === null) {
        recorder.kill("SIGKILL");
      }
    }
  }, 20_000);
});
