import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, RunRepository } from "@agentlens/storage";
import { recordRun } from "../src/recordRun.js";

const execFile = promisify(execFileCallback);
const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const roots: string[] = [];
const silentOutput = { write: () => true };

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile("git", args, { cwd, encoding: "utf8" })).stdout;
}

async function fixture(): Promise<{
  root: string;
  repo: string;
  dataRoot: string;
  env: NodeJS.ProcessEnv;
}> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-cli-record-"));
  roots.push(root);
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const dataRoot = join(root, "data");
  await mkdir(repo);
  await mkdir(bin);
  await git(repo, "init", "-q");
  await git(repo, "config", "user.email", "fixture@example.test");
  await git(repo, "config", "user.name", "AgentLens Fixture");
  await writeFile(join(repo, "tracked.txt"), "before\n", "utf8");
  await writeFile(join(repo, ".env.production"), "DATABASE_PASSWORD=initial\n", "utf8");
  await git(repo, "add", "tracked.txt", ".env.production");
  await git(repo, "commit", "-qm", "initial");
  await copyFile(fakeCodex, join(bin, "codex"));
  await chmod(join(bin, "codex"), 0o700);
  return {
    root,
    repo,
    dataRoot,
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
  };
}

function piped(bytes: Buffer = Buffer.alloc(0)): NodeJS.ReadStream {
  return Object.assign(Readable.from([bytes]), { isTTY: false }) as unknown as NodeJS.ReadStream;
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

async function waitForOpenCommand(dataRoot: string, runId: () => string | undefined): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      const id = runId();
      if (id && detail(dataRoot, id).events.some(({ kind, status }) =>
        kind === "command" && status === "in_progress"
      )) return;
    } catch {
      // The database/run can still be between creation and its first event.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the persisted open command event.");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("recordRun lifecycle", () => {
  it("refuses a dirty worktree before the fake child or durable recorder starts", async () => {
    const context = await fixture();
    const startedFile = join(context.root, "child-started.log");
    await writeFile(join(context.repo, "untracked-before-spawn.txt"), "dirty\n", "utf8");

    await expect(recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, AGENTLENS_FAKE_STARTED_FILE: startedFile },
        stdout: silentOutput
      }
    )).rejects.toThrow(/clean Git repository before child spawn/i);
    await expect(readFile(startedFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(context.dataRoot, "agentlens.sqlite"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("prints the run id before the real fake child starts and forwards exact argv", async () => {
    const context = await fixture();
    const orderFile = join(context.root, "order.log");
    const argvCapture = join(context.root, "argv.json");
    const output: string[] = [];
    const childArgs = [
      "codex", "exec", "--json", "literal argument with spaces", "--fake-mode=success"
    ];

    const result = await recordRun(
      { name: "record", capture: "standard", dataRoot: context.dataRoot, childArgs },
      {
        cwd: context.repo,
        stdin: piped(),
        env: {
          ...context.env,
          AGENTLENS_FAKE_STARTED_FILE: orderFile,
          AGENTLENS_ARGV_CAPTURE: argvCapture
        },
        stdout: {
          write: (chunk) => {
            output.push(String(chunk));
            return true;
          }
        },
        onRunIdPrinted: (runId) => writeFile(orderFile, `run-id:${runId}\n`, "utf8")
      }
    );

    expect(result).toMatchObject({ status: "completed", exitCode: 0, terminatingSignal: null });
    expect(output.join("")).toContain(result.runId);
    expect((await readFile(orderFile, "utf8")).split("\n").slice(0, 2)).toEqual([
      `run-id:${result.runId}`,
      "child-started"
    ]);
    expect(JSON.parse(await readFile(argvCapture, "utf8"))).toEqual(childArgs.slice(1));
    expect(detail(context.dataRoot, result.runId).run.childPid).toEqual(expect.any(Number));
  });

  it("keeps provider completion and a nonzero process exit as separate contradictory facts", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=nonzero"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(result).toMatchObject({ status: "failed", exitCode: 7, cliExitCode: 7 });
    expect(run.run).toMatchObject({
      providerTerminalKind: "completed",
      exitCode: 7,
      contradictionCodes: ["provider_completed_with_nonzero_exit"]
    });
    expect(run.events.some(({ kind, provenance }) =>
      kind === "turn.completed" && provenance === "observed"
    )).toBe(true);
    expect(run.events.some(({ kind, provenance }) =>
      kind === "recorder.process_exit" && provenance === "recorder"
    )).toBe(true);
  });

  it("keeps an observed command failure and later recovery activity as separate facts", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=failed-then-recovery"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);
    const commands = run.events.filter(({ kind }) => kind === "command");

    expect(result.status).toBe("completed");
    expect(commands.map(({ status }) => status)).toEqual([
      "in_progress", "failed", "in_progress", "completed"
    ]);
    expect(commands.every(({ provenance }) => provenance === "observed")).toBe(true);
    expect(run.run).toMatchObject({ providerTerminalKind: "completed", exitCode: 0 });
  });

  it("persists malformed stdout, unknown provider records, and stderr without losing the run", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=malformed-unknown-stderr"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const events = detail(context.dataRoot, result.runId).events;

    expect(result.status).toBe("completed");
    expect(events.filter(({ kind }) => kind === "recorder.stream_diagnostic")).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({
      kind: "source.unknown",
      nativePayload: { storage: "inline", redacted: { type: "future.event", future: { nested: 7 } } }
    }));
  });

  it("forwards buffered stdin bytes unchanged and closes child stdin", async () => {
    const context = await fixture();
    const stdinCapture = join(context.root, "stdin.bin");
    const original = Buffer.from([0x00, 0xff, 0x41, 0x0a, 0x42]);
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "-", "--fake-mode=stdin-echo"]
      },
      {
        cwd: context.repo,
        stdin: piped(original),
        env: { ...context.env, AGENTLENS_STDIN_CAPTURE: stdinCapture },
        stdout: silentOutput
      }
    );

    expect(result.status).toBe("completed");
    expect(await readFile(stdinCapture)).toEqual(original);
  });

  it("durably reconciles a recorder error when the child rejects buffered stdin", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "-", "--fake-mode=stdin-reject"]
      },
      {
        cwd: context.repo,
        stdin: piped(Buffer.alloc(8 * 1024 * 1024, 0x61)),
        env: context.env,
        stdout: silentOutput
      }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(result.status).toBe("recorder_error");
    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "error",
      provenance: "recorder"
    }));
    expect(run.events.at(-1)?.kind).toBe("run.reconciled");
  });

  it("keeps the run starting on spawn failure, appends validated recorder support, and reconciles", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: { ...context.env, PATH: join(context.root, "missing-bin") },
        stdout: silentOutput
      }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(run.run).toMatchObject({
      status: "recorder_error",
      childPid: null,
      exitCode: null,
      terminatingSignal: null,
      providerTerminalKind: null
    });
    expect(run.events.map(({ kind }) => kind)).toEqual([
      "git.snapshot", "recorder.invocation", "error", "git.final_evidence", "run.reconciled"
    ]);
    expect(run.events[0]).toMatchObject({ provenance: "git_recovered" });
    expect(run.events[2]).toMatchObject({
      provenance: "recorder",
      normalizedPayload: { recorderFailure: true }
    });
    expect(run.events.some(({ kind }) => kind === "recorder.process_exit")).toBe(false);
  });

  it("records explicit interruption, nullable signal semantics, and one recovery for an open item", async () => {
    const context = await fixture();
    const controller = new AbortController();
    let printedRunId: string | undefined;
    const recording = recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=hang"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: {
          write: (chunk) => {
            const match = /Run ID: ([^\n]+)/.exec(String(chunk));
            if (match?.[1]) printedRunId = match[1];
            return true;
          }
        },
        signal: controller.signal
      }
    );
    await waitForOpenCommand(context.dataRoot, () => printedRunId);
    controller.abort();
    const result = await recording;
    const run = detail(context.dataRoot, result.runId);

    expect(result.status).toBe("interrupted");
    expect(run.run.exitCode).toBeNull();
    expect(run.run.terminatingSignal).toMatch(/^SIG/);
    expect(run.events.filter(({ kind }) => kind === "recorder.interruption")).toHaveLength(1);
    expect(run.events.filter(({ kind }) => kind === "recorder.recovery")).toHaveLength(1);
    expect(run.events.find(({ kind }) => kind === "command")?.status).toBe("in_progress");
  });

  it("persists final Git evidence after a child commit even when status is clean", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=commit"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const gitEvidence = detail(context.dataRoot, result.runId).gitEvidence;

    expect(gitEvidence).toMatchObject({
      headChanged: true,
      finalStatus: { state: "artifact" },
      trackedFinalDiff: { state: "artifact" },
      diffCheck: { state: "artifact" },
      diffCheckPassed: true
    });
  });

  it("reconciles a recorder error when final Git evidence becomes unavailable", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=remove-git"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);

    expect(result.status).toBe("recorder_error");
    expect(run.gitEvidence).toBeNull();
    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "recorder.process_exit",
      provenance: "recorder"
    }));
    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "error",
      provenance: "recorder",
      normalizedPayload: { recorderFailure: true, phase: "recording" }
    }));
    const providerTerminal = run.events.find(({ kind }) => kind === "turn.completed");
    const recorderFailure = run.events.find(({ kind }) => kind === "error");
    const reconciled = run.events.at(-1);
    expect(run.run.providerTerminalKind).toBe("completed");
    expect(reconciled?.kind).toBe("run.reconciled");
    expect(reconciled?.relationships).toEqual(expect.arrayContaining([
      { type: "derived_from", eventId: providerTerminal?.id },
      { type: "derived_from", eventId: recorderFailure?.id }
    ]));
  });

  it("records successive runs that share identical content-addressed artifacts", async () => {
    const context = await fixture();
    const command = {
      name: "record" as const,
      capture: "standard" as const,
      dataRoot: context.dataRoot,
      childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
    };

    const first = await recordRun(command, {
      cwd: context.repo,
      stdin: piped(),
      env: context.env,
      stdout: silentOutput
    });
    const second = await recordRun(command, {
      cwd: context.repo,
      stdin: piped(),
      env: context.env,
      stdout: silentOutput
    });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(second.runId).not.toBe(first.runId);
    expect(detail(context.dataRoot, first.runId).gitEvidence?.initialStatus).toEqual(
      detail(context.dataRoot, second.runId).gitEvidence?.initialStatus
    );
  });
});
