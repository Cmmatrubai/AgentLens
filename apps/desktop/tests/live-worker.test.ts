import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  copyFile,
  chmod,
  rm,
  rename,
  readFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { execFileSync, fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { launchAttempt } from "../server/live/transport.mjs";
import { privateWrite } from "../server/insights/private-files.mjs";

async function fixture(t: any, model = "fixture-a") {
  const dir = await mkdtemp(join(tmpdir(), "agentlens-worker-"));
  const workspace = join(dir, "work");
  const bin = join(dir, "bin");
  await mkdir(workspace);
  await mkdir(bin);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(workspace, "task.txt"), "before\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  await copyFile(
    fileURLToPath(new URL("./fixtures/live-codex.mjs", import.meta.url)),
    join(bin, "codex"),
  );
  await chmod(join(bin, "codex"), 0o700);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return {
    key: "a",
    workspace,
    root: join(dir, "saved"),
    task: "Improve task.txt",
    baseCommit: git("rev-parse", "HEAD"),
    model,
    effort: "high",
    env: { ...process.env, PATH: bin + delimiter + process.env.PATH },
    node: process.execPath,
  };
}

test("real recorder worker streams persisted redacted evidence and projects its saved final diff", async (t) => {
  const input = await fixture(t);
  const events: any[] = [];
  let runId;
  const run = await launchAttempt({
    ...input,
    signal: new AbortController().signal,
    onEvent: async (e: any) => {
      events.push(e);
    },
    onRunId: async (id: string) => {
      runId = id;
    },
  });
  assert.equal(run.status, "completed");
  assert.equal(run.id, runId);
  assert.equal(run.git.initialHead, input.baseCommit);
  assert.ok(
    run.git.files.some((f: any) => f.content.includes("updated by fixture-a")),
  );
  assert.ok(
    events.some(
      (e) => e.kind === "command" && e.output.includes("1 test passed"),
    ),
  );
  assert.ok(
    events.some(
      (e) =>
        e.kind === "message.agent" && e.message.includes("Updated task.txt"),
    ),
  );
  assert.ok(
    events.every((e) => run.events.some((saved: any) => saved.id === e.id)),
  );
  assert.doesNotMatch(
    JSON.stringify(events),
    /sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDE/,
  );
});

test("stopping a real worker finalizes an interrupted recording", async (t) => {
  const input = await fixture(t, "fixture-hang");
  const stop = new AbortController();
  const safety = setTimeout(() => stop.abort(), 4000);
  t.after(() => clearTimeout(safety));
  const run = await launchAttempt({
    ...input,
    signal: stop.signal,
    onRunId: async () => {},
    onEvent: async (event: any) => {
      if (event.kind === "command") stop.abort();
    },
  });
  assert.equal(run.status, "interrupted");
  assert.ok(run.events.some((e: any) => e.kind === "command"));
});

test("a model failure remains a failed recording with its evidence available", async (t) => {
  const input = await fixture(t, "fixture-fail");
  const run = await launchAttempt({
    ...input,
    signal: new AbortController().signal,
    onRunId: async () => {},
    onEvent: async () => {},
  });
  assert.notEqual(run.status, "completed");
  assert.ok(run.events.length > 0);
});

test(
  "a recorder artifact write failure terminates even a resistant Codex process",
  { timeout: 12000 },
  async (t) => {
    const input = await fixture(t, "fixture-storage");
    const pidFile = join(input.root, "fixture.pid");
    const stop = new AbortController();
    const safety = setTimeout(() => stop.abort(), 7000);
    let corrupted = false;
    let pid: number | undefined;
    t.after(() => {
      clearTimeout(safety);
      if (pid) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
    });
    const outcome = await launchAttempt({
      ...input,
      env: { ...input.env, AGENTLENS_FIXTURE_PID: pidFile },
      signal: stop.signal,
      onRunId: async () => {},
      onEvent: async () => {
        if (corrupted) return;
        corrupted = true;
        pid = Number(await readFile(pidFile, "utf8"));
        const artifacts = join(input.root, "recording", "artifacts", "sha256");
        await rename(artifacts, artifacts + "-original");
        await writeFile(artifacts, "fixture disk failure");
      },
    }).catch(() => null);
    if (outcome) assert.notEqual(outcome.status, "completed");
    assert.ok(pid);
    assert.throws(() => process.kill(pid!, 0), /ESRCH/);
  },
);

test("omitted large live output is labeled as a shortened preview", async (t) => {
  const input = await fixture(t, "fixture-large");
  const events: any[] = [];
  await launchAttempt({
    ...input,
    signal: new AbortController().signal,
    onRunId: async () => {},
    onEvent: async (e: any) => {
      events.push(e);
    },
  });
  const large = events.find((e) => e.command === "echo fixture-output");
  assert.equal(large?.truncated, true);
});

test(
  "normal completion cleans remaining processes in the owned group",
  { timeout: 10000 },
  async (t) => {
    const input = await fixture(t, "fixture-descendant");
    const childFile = join(input.root, "descendant.pid");
    let pid: number | undefined;
    t.after(async () => {
      if (!pid) {
        try {
          pid = Number(await readFile(childFile, "utf8"));
        } catch {}
      }
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    });
    const run = await launchAttempt({
      ...input,
      env: { ...input.env, AGENTLENS_FIXTURE_DESCENDANT: childFile },
      signal: new AbortController().signal,
      onRunId: async () => {},
      onEvent: async () => {},
    });
    pid = Number(await readFile(childFile, "utf8"));
    assert.equal(run.status, "completed");
    assert.throws(() => process.kill(pid!, 0), /ESRCH/);
  },
);

test(
  "a caller storage error cannot certify cleanup after the worker crashes",
  { timeout: 10000 },
  async (t) => {
    const input = await fixture(t, "fixture-worker-crash");
    const pidFile = join(input.root, "fixture.pid");
    let pid: number | undefined;
    t.after(async () => {
      if (!pid) {
        try {
          pid = Number(await readFile(pidFile, "utf8"));
        } catch {}
      }
      if (pid) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
    });
    await assert.rejects(
      launchAttempt({
        ...input,
        env: { ...input.env, AGENTLENS_FIXTURE_PID: pidFile },
        signal: new AbortController().signal,
        onRunId: async () => {},
        onEvent: async () => {
          pid = Number(await readFile(pidFile, "utf8"));
          throw Object.assign(Error("workspace_storage_failed"), {
            cleanupConfirmed: true,
          });
        },
      }),
      (error: any) => {
        assert.equal(error.cleanupConfirmed, false);
        return true;
      },
    );
  },
);

test(
  "successful completion drains background descendants that inherit output pipes",
  { timeout: 10000 },
  async (t) => {
    const input = await fixture(t, "fixture-inherited-pipes");
    const childFile = join(input.root, "descendant.pid");
    const stop = new AbortController();
    const safety = setTimeout(() => stop.abort(), 4000);
    t.after(async () => {
      clearTimeout(safety);
      try {
        process.kill(Number(await readFile(childFile, "utf8")), "SIGKILL");
      } catch {}
    });
    const run = await launchAttempt({
      ...input,
      env: { ...input.env, AGENTLENS_FIXTURE_DESCENDANT: childFile },
      signal: stop.signal,
      onRunId: async () => {},
      onEvent: async () => {},
    });
    assert.equal(
      stop.signal.aborted,
      false,
      "normal completion must not depend on timeout cancellation",
    );
    assert.equal(run.status, "completed");
    assert.throws(
      () =>
        process.kill(
          Number(execFileSync("cat", [childFile], { encoding: "utf8" })),
          0,
        ),
      /ESRCH/,
    );
  },
);

test("prerequisites distinguish missing runtime, missing Codex, old CLI and signed-out account", async (t) => {
  const input = await fixture(t);
  const bin = input.env.PATH.split(delimiter)[0];
  await symlink(process.execPath, join(bin, "node"));
  const probe = (env: Record<string, string | undefined>) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {preflight} from ${JSON.stringify(new URL("../server/live/transport.mjs", import.meta.url).href)}; try { console.log(JSON.stringify(await preflight())); } catch (error) { console.log(JSON.stringify({error:error.message})); }`,
        ],
        { env: { ...input.env, ...env }, encoding: "utf8", timeout: 20000 },
      ),
    );
  assert.equal(
    probe({ PATH: "/nonexistent-agentlens-fixture-path" }).error,
    "recorder_runtime_unavailable",
  );
  await rename(join(bin, "codex"), join(bin, "codex.saved"));
  assert.equal(probe({ PATH: bin }).error, "codex_unavailable");
  await rename(join(bin, "codex.saved"), join(bin, "codex"));
  assert.equal(
    probe({ AGENTLENS_FIXTURE_OLD_CLI: "1" }).error,
    "codex_update_required",
  );
  assert.equal(
    probe({ AGENTLENS_FIXTURE_SIGNED_OUT: "1" }).error,
    "codex_login_required",
  );
  assert.equal(probe({}).version, "codex fixture");
});

test(
  "a parent IPC disconnect cancels the actual recorder and preserves an interrupted result",
  { timeout: 20000 },
  async (t) => {
    const input = await fixture(t, "fixture-hang");
    const repository = fileURLToPath(new URL("../../../", import.meta.url));
    const pidFile = join(input.root, "codex.pid");
    await privateWrite(input.root, "request.json", {
      repository,
      root: input.root,
      workspace: input.workspace,
      task: input.task,
      model: input.model,
      effort: input.effort,
    });
    const child = fork(
      fileURLToPath(new URL("../server/live/worker.mjs", import.meta.url)),
      [join(input.root, "request.json")],
      {
        execPath: process.execPath,
        execArgv: [
          "--import",
          createRequire(import.meta.url).resolve("tsx"),
          "--conditions=development",
        ],
        env: { ...input.env, AGENTLENS_FIXTURE_PID: pidFile },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let disconnected = false;
    const safety = setTimeout(() => child.kill("SIGTERM"), 10000);
    t.after(async () => {
      clearTimeout(safety);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      try {
        process.kill(-Number(await readFile(pidFile, "utf8")), "SIGKILL");
      } catch {}
    });
    child.on("message", (message: any) => {
      if (!child.connected) return;
      if (
        !disconnected &&
        message.type === "event" &&
        message.event.kind === "command"
      ) {
        disconnected = true;
        child.send({ ack: message.sequence }, () => child.disconnect());
      } else child.send({ ack: message.sequence });
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(disconnected, true);
    assert.equal(code, 0);
    const run = JSON.parse(
      await readFile(join(input.root, "run.json"), "utf8"),
    );
    assert.equal(run.status, "interrupted");
    assert.ok(run.events.some((event: any) => event.kind === "command"));
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  },
);

test("spawn and malformed worker protocol failures never synthesize a completed recording", async (t) => {
  const input = await fixture(t);
  const callbacks = {
    signal: new AbortController().signal,
    onRunId: async () => {},
    onEvent: async () => {},
  };
  await assert.rejects(
    launchAttempt({
      ...input,
      ...callbacks,
      node: join(input.workspace, "missing-node"),
    }),
    (error: any) => {
      assert.equal(error.message, "worker_spawn_failed");
      assert.equal(error.cleanupConfirmed, true);
      return true;
    },
  );
  const malformed = join(input.workspace, "malformed-worker");
  await writeFile(
    malformed,
    '#!/usr/bin/env node\nprocess.on("SIGTERM",()=>process.exit(1)); process.send({sequence:"invalid",type:"complete"}); setInterval(()=>{},1000);\n',
  );
  await chmod(malformed, 0o700);
  await assert.rejects(
    launchAttempt({ ...input, ...callbacks, node: malformed }),
    (error: any) => {
      assert.equal(error.message, "worker_protocol_failed");
      assert.equal(error.cleanupConfirmed, false);
      return true;
    },
  );
});
