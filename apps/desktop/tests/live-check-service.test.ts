import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  rm,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  createCheckService,
  validateCheckInput,
} from "../server/live/check-service.mjs";
import { privateWrite } from "../server/insights/private-files.mjs";
const id = "00000000-0000-0000-0000-000000000001";
const input = {
  title: "Answer matches expected",
  command: 'test "$(cat answer.txt)" = correct',
  timeoutSeconds: 5,
  acknowledged: true,
};
async function fixture(t: any) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "agentlens-check-service-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const attempts = [];
  for (const key of ["a", "b"]) {
    const workspace = join(root, key);
    await mkdir(workspace);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    await writeFile(
      join(workspace, "answer.txt"),
      key === "a" ? "correct" : "wrong",
    );
    git("add", ".");
    git("commit", "-qm", "base");
    attempts.push({ key, workspace, runId: `${key}-run` });
  }
  const store = join(root, "saved");
  await mkdir(store);
  const context = { baseCommit: "a".repeat(40), attempts };
  const opts = {
    getRoot: async () => store,
    getContext: async (jobId: string) => {
      assert.equal(jobId, id);
      return context;
    },
  };
  return { root, store, context, opts, service: createCheckService(opts) };
}
async function settled(service: any) {
  for (let i = 0; i < 300; i++) {
    const r = await service.read(id);
    if (r.evaluation?.state !== "running") return r.evaluation;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw Error("check did not finish");
}
test("validates command, consent, name and bounded duration", () => {
  assert.throws(() => validateCheckInput({ ...input, acknowledged: false }));
  assert.throws(() => validateCheckInput({ ...input, command: "" }));
  assert.throws(() => validateCheckInput({ ...input, timeoutSeconds: 601 }));
});
test(
  "real checks persist divergent outcomes and hashes, preserve originals, and reopen",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t);
    t.after(() => f.service.shutdown());
    await f.service.start(id, input);
    await assert.rejects(f.service.start(id, input), /check_busy/);
    const result = await settled(f.service);
    assert.deepEqual(
      result.attempts.map((a: any) => a.outcome),
      ["pass", "fail"],
    );
    assert.ok(
      result.attempts.every(
        (a: any) => /^[a-f0-9]{64}$/.test(a.snapshotHash) && a.artifactSha256,
      ),
    );
    assert.equal(
      await readFile(join(f.root, "a/answer.txt"), "utf8"),
      "correct",
    );
    const reopened = createCheckService(f.opts);
    assert.deepEqual((await reopened.read(id)).evaluation, result);
    const comparison = {
      attempts: f.context.attempts.map((a) => ({
        key: a.key,
        run: { id: a.runId },
        controlNotes: [],
        coverageLimits: [],
      })),
    };
    const projected = await reopened.project(id, comparison);
    assert.equal(projected.verificationKind, "command");
    assert.equal(projected.attempts[0].checks[0].outcome, "pass");
    assert.match(
      projected.attempts[0].coverageLimits[0],
      /does not establish task correctness/,
    );
    const before = result.id;
    await f.service.start(id, { ...input, command: "exit 0" });
    const after = await settled(f.service);
    assert.notEqual(after.id, before);
    assert.ok(
      await readFile(
        join(f.store, id, "check-history", `${before}.json`),
        "utf8",
      ),
    );
  },
);
test(
  "cancelled evaluation skips the second command and never promotes cancellation",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t);
    t.after(() => f.service.shutdown());
    await f.service.start(id, { ...input, command: "sleep 20" });
    await f.service.stop(id);
    const result = await settled(f.service);
    assert.ok(result.attempts.every((a: any) => a.outcome === "unknown"));
    assert.ok(result.attempts.every((a: any) => a.state === "cancelled"));
  },
);
test("restart never retries interrupted evaluation and requires cleanup acknowledgment", async (t) => {
  const f = await fixture(t);
  const state = {
    schemaVersion: 1,
    id: "00000000-0000-0000-0000-000000000002",
    jobId: id,
    ...input,
    state: "running",
    startedAt: 1,
    attempts: f.context.attempts.map((a) => ({
      key: a.key,
      runId: a.runId,
      state: "running",
      outcome: "unknown",
      output: "",
    })),
  };
  await privateWrite(join(f.store, id), "check-state.json", state);
  const recovered = await f.service.read(id);
  assert.equal(recovered.evaluation.state, "interrupted");
  assert.equal(recovered.evaluation.cleanupUnconfirmed, true);
  await assert.rejects(f.service.start(id, input), /check_cleanup_unconfirmed/);
  await f.service.acknowledge(id, true);
  assert.ok((await f.service.read(id)).evaluation.cleanupAcknowledgedAt);
});

test("a failed cleanup acknowledgment remains blocked in memory and on disk", async (t) => {
  const f = await fixture(t);
  await privateWrite(join(f.store, id), "check-state.json", {
    schemaVersion: 1,
    id: "00000000-0000-0000-0000-000000000002",
    jobId: id,
    ...input,
    state: "interrupted",
    startedAt: 1,
    endedAt: 2,
    cleanupUnconfirmed: true,
    attempts: f.context.attempts.map((a) => ({
      key: a.key,
      runId: a.runId,
      state: "interrupted",
      outcome: "unknown",
      output: "",
    })),
  });
  const service = createCheckService({
    ...f.opts,
    write: async () => {
      throw Error("disk full");
    },
  });
  await assert.rejects(service.acknowledge(id, true), /check_storage_failed/);
  assert.equal(
    (await service.read(id)).evaluation.cleanupAcknowledgedAt,
    undefined,
  );
  await assert.rejects(service.start(id, input), /check_cleanup_unconfirmed/);
  assert.equal(
    JSON.parse(await readFile(join(f.store, id, "check-state.json"), "utf8"))
      .cleanupAcknowledgedAt,
    undefined,
  );
});

test("shutdown during the initial save prevents any command from launching", async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  let entered!: () => void;
  const saved = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  let calls = 0;
  const service = createCheckService({
    ...f.opts,
    write: async (...args: any[]) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      await privateWrite(...args);
    },
    runCommand: async () => {
      calls++;
      return {
        state: "completed",
        exitCode: 0,
        output: "",
        cleanupConfirmed: true,
      };
    },
  });
  const start = service.start(id, input);
  await saved;
  const shutdown = service.shutdown();
  release();
  await start;
  await shutdown;
  assert.equal(calls, 0);
  assert.ok(
    (await service.read(id)).evaluation.attempts.every(
      (a: any) => a.outcome === "unknown",
    ),
  );
});

test("missing snapshot evidence preserves recordings without projecting a pass", async (t) => {
  const f = await fixture(t);
  const service = createCheckService({
    ...f.opts,
    runCommand: async () => ({
      state: "completed",
      exitCode: 0,
      output: "ok",
      cleanupConfirmed: true,
    }),
  });
  t.after(() => service.shutdown());
  await service.start(id, input);
  const result = await settled(service);
  await rm(join(f.store, id, "check-runs", result.id, "snapshot-a.json"));
  const comparison = {
    checks: [],
    attempts: f.context.attempts.map((a) => ({
      key: a.key,
      run: { id: a.runId },
    })),
  };
  const projected = await service.project(id, comparison);
  assert.equal(projected.verificationError, "check_evidence_unavailable");
  assert.deepEqual(projected.attempts, comparison.attempts);
  assert.deepEqual(projected.checks, []);
});
