import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createLiveController } from "../server/live/controller.mjs";
import { privateWrite } from "../server/insights/private-files.mjs";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
async function setup(t: any, launchAttempt: any) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "agentlens-live-")));
  const repo = join(dir, "repo");
  git(dir, "init", "-q", repo);
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "user.name", "Fixture");
  await writeFile(join(repo, "task.txt"), "same starting content\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  const options = {
    root: join(dir, "saved"),
    preflight: async () => ({ version: "fixture" }),
    launchAttempt,
  };
  const service = createLiveController(options);
  t.after(async () => {
    await service.shutdown().catch((error: Error) => {
      if (error.message !== "cleanup_unconfirmed") throw error;
    });
    await rm(dir, { recursive: true, force: true });
  });
  const project = await service.chooseProject(repo);
  const input = {
    projectId: project.id,
    baseCommit: project.commit,
    task: "Improve task.txt",
    models: [
      { model: "model-a", effort: "high" },
      { model: "model-b", effort: "high" },
    ],
    timeoutMinutes: 10,
    acknowledged: true,
  };
  return { dir, repo, service, project, input, options };
}
async function terminal(service: any, id: string) {
  for (let i = 0; i < 300; i++) {
    const snapshot = await service.read(id);
    const job = snapshot.job;
    if (
      !snapshot.activeId &&
      ["finished", "interrupted", "failed"].includes(job.state)
    )
      return job;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw Error("fixture job did not settle");
}
const fakeRun = (input: any) => ({
  id: input.key + "-run",
  status: "completed",
  git: { initialHead: input.baseCommit, files: [] },
  events: [],
  capturePolicy: "standard",
  elapsedMs: 100,
  eventCount: 0,
});

test("two workers start from one frozen revision and cannot edit the source checkout", async (t) => {
  const f = await setup(t, async (input: any) => {
    assert.equal(git(input.workspace, "rev-parse", "HEAD"), input.baseCommit);
    assert.equal(
      await readFile(join(input.workspace, "task.txt"), "utf8"),
      "same starting content\n",
    );
    await writeFile(join(input.workspace, "task.txt"), input.key);
    await input.onEvent({
      id: input.key + "-event",
      kind: "command",
      summary: "Read project",
      output: "local output",
    });
    return fakeRun(input);
  });
  const start = await f.service.start(f.input);
  const job = await terminal(f.service, start.id);
  assert.deepEqual(
    job.attempts.map((a: any) => a.state),
    ["completed", "completed"],
  );
  assert.notEqual(job.attempts[0].workspace, job.attempts[1].workspace);
  assert.equal(
    job.attempts[0].recordingPath,
    join(f.options.root, job.id, "a", "recording"),
  );
  assert.equal(
    await readFile(join(f.repo, "task.txt"), "utf8"),
    "same starting content\n",
  );
  assert.equal(git(f.repo, "status", "--porcelain"), "");
  const comparison = await f.service.comparison(job.id);
  assert.equal(comparison.baseCommit, f.project.commit);
  assert.equal(comparison.taskPrompt, f.input.task);
  assert.deepEqual(comparison.checks, []);
  assert.equal(comparison.ready, false);
});

test("dirty projects and changed revisions are rejected before workers start", async (t) => {
  const f = await setup(t, async () => {
    throw Error("must not launch");
  });
  await writeFile(join(f.repo, "task.txt"), "uncommitted");
  await assert.rejects(f.service.start(f.input), /project_dirty/);
  assert.equal((await f.service.read()).job, null);
  git(f.repo, "add", ".");
  git(f.repo, "commit", "-qm", "changed");
  await assert.rejects(f.service.start(f.input), /project_changed/);
});

test("duplicate starts are rejected and stopping one side leaves the other running", async (t) => {
  const f = await setup(
    t,
    (input: any) =>
      new Promise((resolve) => {
        input.signal.addEventListener(
          "abort",
          () => resolve({ ...fakeRun(input), status: "interrupted" }),
          { once: true },
        );
      }),
  );
  const first = f.service.start(f.input);
  await assert.rejects(f.service.start(f.input), /comparison_busy/);
  const job = await first;
  for (let i = 0; i < 100; i++) {
    if (
      (await f.service.read(job.id)).job.attempts.every(
        (a: any) => a.state === "running",
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await f.service.stop(job.id, "a");
  for (let i = 0; i < 100; i++) {
    if ((await f.service.read(job.id)).job.attempts[0].state === "stopped")
      break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const snapshot = (await f.service.read(job.id)).job;
  assert.equal(snapshot.attempts[0].state, "stopped");
  assert.equal(snapshot.attempts[1].state, "running");
  await assert.rejects(f.service.stop("wrong-id", "b"), /invalid_job/);
  await f.service.stop(job.id, "b");
  await terminal(f.service, job.id);
  await assert.rejects(f.service.comparison(job.id), /comparison_incomplete/);
});

test("one worker failure preserves the other result and a reload never reruns a finished job", async (t) => {
  const f = await setup(t, async (input: any) => {
    if (input.key === "a") throw Error("provider_unavailable");
    return fakeRun(input);
  });
  const job = await terminal(f.service, (await f.service.start(f.input)).id);
  assert.deepEqual(
    job.attempts.map((a: any) => a.state),
    ["failed", "completed"],
  );
  const reopened = createLiveController({
    ...f.options,
    launchAttempt: () => {
      throw Error("unexpected relaunch");
    },
  });
  assert.deepEqual(
    (await reopened.read()).job.attempts.map((a: any) => a.state),
    ["failed", "completed"],
  );
});

test("invalid launch input cannot become a process argument or silently substitute settings", async (t) => {
  const f = await setup(t, async () => {
    throw Error("must not launch");
  });
  for (const change of [
    { task: " " },
    { task: "x".repeat(20001) },
    { acknowledged: false },
    { timeoutMinutes: 0 },
    ...[undefined, null, 123, ["model-a"], "--help"].map((model) => ({
      models: [{ model, effort: "high" }, f.input.models[1]],
    })),
    { models: [f.input.models[0], f.input.models[0]] },
  ]) {
    await assert.rejects(
      f.service.start({ ...f.input, ...change }),
      /invalid_/,
    );
  }
});

test("quitting during prerequisite checks cancels startup before any work launches", async (t) => {
  const f = await setup(t, async () => {
    throw Error("must not launch");
  });
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const checking = new Promise<void>((r) => {
    entered = r;
  });
  const service = createLiveController({
    ...f.options,
    preflight: async () => {
      entered();
      await gate;
    },
  });
  const project = await service.chooseProject(f.repo);
  const start = service.start({ ...f.input, projectId: project.id });
  const rejected = assert.rejects(start, /comparison_closing/);
  await checking;
  const quit = service.shutdown();
  release();
  await quit;
  await rejected;
  assert.equal((await service.read()).job, null);
});

test("a damaged saved job cannot hide healthy saved comparisons", async (t) => {
  const f = await setup(t, async (input: any) => fakeRun(input));
  const done = await terminal(f.service, (await f.service.start(f.input)).id);
  const bad = "00000000-0000-0000-0000-000000000000";
  await privateWrite(join(f.options.root, bad), "job.json", {
    schemaVersion: 1,
    id: bad,
    state: "running",
    attempts: [null, null],
  });
  const reopened = createLiveController(f.options);
  const snapshot = await reopened.read();
  assert.equal(snapshot.job.id, done.id);
  assert.equal(snapshot.recoveryWarnings.length, 1);
});

test("a deadline never overwrites an earlier stop while cancellation drains", async (t) => {
  let ready!: () => void;
  const launched = new Promise<void>((r) => {
    ready = r;
  });
  const finish: (() => void)[] = [];
  const f = await setup(
    t,
    (input: any) =>
      new Promise((resolve) => {
        finish.push(() =>
          resolve({ ...fakeRun(input), status: "interrupted" }),
        );
        if (finish.length === 2) ready();
      }),
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const job = await f.service.start({ ...f.input, timeoutMinutes: 1 });
  await launched;
  await f.service.stop(job.id, "a");
  t.mock.timers.tick(60000);
  for (const resolve of finish) resolve();
  t.mock.timers.reset();
  const done = await terminal(f.service, job.id);
  assert.deepEqual(
    done.attempts.map((a: any) => a.state),
    ["stopped", "timed_out"],
  );
});

test("a worker crash during stopping cannot be reported as a finalized stop", async (t) => {
  let ready!: () => void;
  const launched = new Promise<void>((r) => {
    ready = r;
  });
  let count = 0;
  const f = await setup(
    t,
    (input: any) =>
      new Promise((_resolve, reject) => {
        input.signal.addEventListener(
          "abort",
          () => reject(Error("worker_failed")),
          { once: true },
        );
        if (++count === 2) ready();
      }),
  );
  const started = await f.service.start(f.input);
  await launched;
  await assert.rejects(f.service.shutdown(), /cleanup_unconfirmed/);
  const job = (await f.service.read(started.id)).job;
  assert.equal(job.cleanupUnconfirmed, true);
  assert.deepEqual(
    job.attempts.map((a: any) => a.state),
    ["failed", "failed"],
  );
  await assert.rejects(
    f.service.acknowledgeCleanup(job.id, false),
    /invalid_cleanup_acknowledgement/,
  );
  await f.service.acknowledgeCleanup(job.id, true);
  await f.service.shutdown();
  const acknowledged = (await f.service.read(job.id)).job;
  assert.equal(acknowledged.cleanupUnconfirmed, true);
  assert.ok(acknowledged.cleanupAcknowledgedAt);
  assert.deepEqual(
    acknowledged.attempts.map((a: any) => a.state),
    ["failed", "failed"],
  );
});

test("bursty activity stays bounded and duplicate delivery does not inflate recorded counts", async (t) => {
  const f = await setup(t, async (input: any) => {
    for (let i = 0; i < 100; i++)
      await input.onEvent({
        id: `event-${i}`,
        kind: "command",
        output: "x".repeat(6000),
      });
    await input.onEvent({
      id: "event-99",
      kind: "command",
      output: "duplicate",
    });
    return fakeRun(input);
  });
  const job = await terminal(f.service, (await f.service.start(f.input)).id);
  assert.equal(job.attempts[0].events.length, 80);
  assert.equal(job.attempts[0].events[0].id, "event-20");
  assert.equal(job.attempts[0].omittedEvents, 20);
  assert.equal(job.attempts[0].eventCount, 100);
  assert.equal(job.attempts[0].events[0].output.length, 4000);
  assert.equal(job.attempts[0].events[0].truncated, true);
});

test("a workspace journal write failure is visible and cancels work instead of claiming it is saved", async (t) => {
  const f = await setup(t, async (input: any) => {
    await input.onEvent({
      id: "one",
      kind: "command",
      summary: "Recorded action",
    });
    return fakeRun(input);
  });
  let failed = false;
  const service = createLiveController({
    ...f.options,
    write: async (root: string, name: string, value: any) => {
      if (
        !failed &&
        name === "job.json" &&
        value.attempts.some((a: any) => a.eventCount > 0)
      ) {
        failed = true;
        throw Object.assign(Error("disk full"), { code: "ENOSPC" });
      }
      return privateWrite(root, name, value);
    },
  });
  const project = await service.chooseProject(f.repo);
  const job = await terminal(
    service,
    (await service.start({ ...f.input, projectId: project.id })).id,
  );
  assert.equal(job.persistenceError, true);
  assert.equal(
    job.attempts.some((a: any) => a.state === "failed"),
    true,
  );
  await assert.rejects(service.comparison(job.id), /comparison_incomplete/);
});

test("reopening restores finalized worker results from an unfinished journal without rerunning", async (t) => {
  const f = await setup(t, async (input: any) => fakeRun(input));
  const done = await terminal(f.service, (await f.service.start(f.input)).id);
  const saved = structuredClone(done);
  saved.state = "running";
  for (const attempt of saved.attempts) attempt.state = "running";
  await privateWrite(join(f.options.root, done.id), "job.json", saved);
  const reopened = createLiveController({
    ...f.options,
    launchAttempt: () => assert.fail("must not rerun"),
  });
  const snapshot = await reopened.read();
  assert.deepEqual(
    snapshot.job.attempts.map((a: any) => a.state),
    ["completed", "completed"],
  );
  assert.equal(snapshot.job.state, "finished");
  assert.deepEqual(snapshot.unresolvedCleanup, []);
  assert.equal((await reopened.comparison(done.id)).ready, false);
  await reopened.shutdown();
});

test("reopening keeps missing worker results uncertain while preserving the completed peer", async (t) => {
  const f = await setup(t, async (input: any) => fakeRun(input));
  const done = await terminal(f.service, (await f.service.start(f.input)).id);
  done.state = "running";
  done.attempts[0].state = "stopping";
  done.attempts[0].stopReason = "stopped";
  await rm(join(f.options.root, done.id, "a", "run.json"));
  await privateWrite(join(f.options.root, done.id), "job.json", done);
  const reopened = createLiveController(f.options);
  const snapshot = await reopened.read();
  assert.deepEqual(
    snapshot.job.attempts.map((a: any) => a.state),
    ["interrupted", "completed"],
  );
  assert.equal(snapshot.job.cleanupUnconfirmed, true);
  assert.equal(snapshot.unresolvedCleanup[0].id, done.id);
  await assert.rejects(reopened.start(f.input), /cleanup_unconfirmed/);
  await assert.rejects(reopened.shutdown(), /cleanup_unconfirmed/);
  await reopened.acknowledgeCleanup(done.id, true);
  await reopened.shutdown();
  const again = createLiveController(f.options);
  assert.deepEqual((await again.read()).unresolvedCleanup, []);
  assert.equal((await again.read()).job.attempts[0].state, "interrupted");
  await again.shutdown();
});

test("a failed acknowledgment write cannot clear uncertainty in memory", async (t) => {
  const f = await setup(t, async () => {
    throw Error("worker_failed");
  });
  const done = await terminal(f.service, (await f.service.start(f.input)).id);
  const reopened = createLiveController({
    ...f.options,
    write: async (root: string, name: string, value: any) => {
      if (value.cleanupAcknowledgedAt) throw Error("disk full");
      return privateWrite(root, name, value);
    },
  });
  await assert.rejects(
    reopened.acknowledgeCleanup(done.id, true),
    /workspace_storage_failed/,
  );
  const snapshot = await reopened.read();
  assert.equal(snapshot.job.cleanupAcknowledgedAt, undefined);
  assert.equal(snapshot.unresolvedCleanup[0].id, done.id);
  await assert.rejects(reopened.shutdown(), /cleanup_unconfirmed/);
});

test("damaged nested saved activity is skipped instead of reaching the renderer", async (t) => {
  const f = await setup(t, async (input: any) => {
    await input.onEvent({
      id: "event",
      kind: "command",
      command: "node --test",
    });
    return fakeRun(input);
  });
  const done = await terminal(f.service, (await f.service.start(f.input)).id);
  const mutations = [
    (j: any) => {
      j.attempts[0].events[0].kind = {};
    },
    (j: any) => {
      j.attempts[0].events[0].files = null;
    },
    (j: any) => {
      j.attempts[0].events[0].files = [{}];
    },
    (j: any) => {
      j.attempts[0].events[0].output = "x".repeat(4001);
    },
    (j: any) => {
      j.attempts[0].eventCount = "many";
    },
    (j: any) => {
      j.attempts[0].effort = {};
    },
    (j: any) => {
      j.project.name = {};
    },
    (j: any) => {
      j.timeoutMs = -1;
    },
    (j: any) => {
      j.cleanupAcknowledgedAt = "trusted";
    },
  ];
  for (let i = 0; i < mutations.length; i++) {
    const bad = structuredClone(done);
    bad.id = `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    mutations[i](bad);
    await privateWrite(join(f.options.root, bad.id), "job.json", bad);
  }
  const reopened = createLiveController(f.options);
  const snapshot = await reopened.read();
  assert.equal(snapshot.recent.length, 1);
  assert.equal(snapshot.job.id, done.id);
  assert.equal(snapshot.recoveryWarnings.length, mutations.length);
  await reopened.shutdown();
});

test("nonrepositories, unborn and bare repositories, and submodules cannot launch", async (t) => {
  const f = await setup(t, async () => assert.fail("must not launch"));
  await assert.rejects(
    f.service.chooseProject(join(f.dir, "missing")),
    /invalid_git_project/,
  );
  const unborn = join(f.dir, "unborn");
  git(f.dir, "init", "-q", unborn);
  await assert.rejects(f.service.chooseProject(unborn), /invalid_git_project/);
  const bare = join(f.dir, "bare.git");
  git(f.dir, "clone", "-q", "--bare", f.repo, bare);
  await assert.rejects(f.service.chooseProject(bare), /invalid_git_project/);
  git(
    f.repo,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    f.repo,
    "nested-project",
  );
  git(f.repo, "add", ".");
  git(f.repo, "commit", "-qm", "fixture gitlink");
  const chosen = await f.service.chooseProject(f.repo);
  assert.equal(chosen.submodules, true);
  await assert.rejects(
    f.service.start({
      ...f.input,
      projectId: chosen.id,
      baseCommit: chosen.commit,
    }),
    /project_submodules/,
  );
});

test("a stale stop request cannot cancel a replacement comparison", async (t) => {
  let launches = 0;
  let ready!: () => void;
  const running = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const f = await setup(t, async (input: any) => {
    if (++launches <= 2) return fakeRun(input);
    return new Promise((resolve) => {
      input.signal.addEventListener(
        "abort",
        () => resolve({ ...fakeRun(input), status: "interrupted" }),
        { once: true },
      );
      if (launches === 4) ready();
    });
  });
  const first = await terminal(f.service, (await f.service.start(f.input)).id);
  const second = await f.service.start(f.input);
  await running;
  await assert.rejects(f.service.stop(first.id, "all"), /invalid_stop/);
  assert.equal((await f.service.read()).activeId, second.id);
  assert.deepEqual(
    (await f.service.read(second.id)).job.attempts.map((a: any) => a.state),
    ["running", "running"],
  );
  await f.service.stop(second.id, "all");
  await terminal(f.service, second.id);
});

test("symlinked storage resolves physical workspaces before launching sandboxed agents", async (t) => {
  const launched: string[] = [];
  const f = await setup(t, async () => {
    throw Error("unused controller");
  });
  const physical = join(f.dir, "physical-storage");
  await mkdir(physical);
  const alias = join(f.dir, "storage-alias");
  await symlink(physical, alias, "dir");
  const service = createLiveController({
    ...f.options,
    root: alias,
    launchAttempt: async (input: any) => {
      launched.push(input.workspace);
      assert.equal(input.workspace, await realpath(input.workspace));
      return fakeRun(input);
    },
  });
  t.after(() => service.shutdown());
  const project = await service.chooseProject(f.repo);
  const started = await service.start({ ...f.input, projectId: project.id });
  const job = await terminal(service, started.id);
  assert.equal(launched.length, 2);
  assert.deepEqual(
    job.attempts.map((a: any) => a.state),
    ["completed", "completed"],
  );
  for (const a of job.attempts)
    assert.equal(a.workspace, await realpath(a.workspace));
});
