import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  rm,
  symlink,
  chmod,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshotAttempt } from "../server/live/check-snapshot.mjs";
import { runCheckCommand } from "../server/live/check-process.mjs";
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
async function fixture(t: any) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "agentlens-check-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  await writeFile(join(root, "answer.txt"), "old");
  await writeFile(join(root, "deleted.txt"), "old");
  await writeFile(join(root, ".gitignore"), "ignored\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return root;
}
test("snapshot preserves changed and new files, deletion and executable identity without modifying original", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "answer.txt"), "new");
  await writeFile(join(root, "new.txt"), "added");
  await chmod(join(root, "new.txt"), 0o755);
  await writeFile(join(root, "ignored"), "not copied");
  await rm(join(root, "deleted.txt"));
  const dest = await realpath(await mkdtemp(join(tmpdir(), "agentlens-copy-")));
  t.after(() => rm(dest, { recursive: true, force: true }));
  const saved = await snapshotAttempt(root, join(dest, "tree"));
  assert.match(saved.hash, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(dest, "tree/answer.txt"), "utf8"), "new");
  assert.equal(await readFile(join(dest, "tree/new.txt"), "utf8"), "added");
  assert.equal((await stat(join(dest, "tree/new.txt"))).mode & 0o777, 0o755);
  await assert.rejects(readFile(join(dest, "tree/deleted.txt")));
  await assert.rejects(readFile(join(dest, "tree/ignored")));
  assert.equal(await readFile(join(root, "answer.txt"), "utf8"), "new");
});
test("snapshot refuses symlinks rather than following files outside the attempt", async (t) => {
  const root = await fixture(t);
  await symlink("/etc/hosts", join(root, "external"));
  const dest = await realpath(await mkdtemp(join(tmpdir(), "agentlens-copy-")));
  t.after(() => rm(dest, { recursive: true, force: true }));
  await assert.rejects(
    snapshotAttempt(root, join(dest, "tree")),
    /check_snapshot_unsupported/,
  );
});
test("snapshot refuses oversized files and a destination inside the source", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    snapshotAttempt(root, join(root, "copy")),
    /check_snapshot_unsupported/,
  );
  await writeFile(join(root, "oversized"), Buffer.alloc(17 * 1024 * 1024));
  const dest = await realpath(await mkdtemp(join(tmpdir(), "agentlens-copy-")));
  t.after(() => rm(dest, { recursive: true, force: true }));
  await assert.rejects(
    snapshotAttempt(root, join(dest, "tree")),
    /check_snapshot_unsupported/,
  );
});
test(
  "real sandboxed command has bounded output, no inherited secret, and cannot write outside its copy",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await fixture(t);
    const outside = await realpath(
      await mkdtemp(join(tmpdir(), "agentlens-check-outside-")),
    );
    t.after(() => rm(outside, { recursive: true, force: true }));
    process.env.AGENTLENS_TEST_SECRET = "must-not-inherit";
    try {
      const result = await runCheckCommand({
        workspace: root,
        command: `test -z "$AGENTLENS_TEST_SECRET" && printf ok > inside && ! printf bad > '${outside}/escape'`,
        timeoutMs: 5000,
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.state, "completed");
      assert.equal(await readFile(join(root, "inside"), "utf8"), "ok");
      await assert.rejects(readFile(join(outside, "escape")));
    } finally {
      delete process.env.AGENTLENS_TEST_SECRET;
    }
    const flood = await runCheckCommand({
      workspace: root,
      command: "yes sample | head -c 100000",
      timeoutMs: 5000,
      signal: new AbortController().signal,
    });
    assert.equal(flood.outputTruncated, true);
    assert.ok(flood.output.length < 18000);
  },
);
test(
  "failed, timed out and cancelled commands remain distinct",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await fixture(t);
    const failed = await runCheckCommand({
      workspace: root,
      command: "exit 3",
      timeoutMs: 5000,
      signal: new AbortController().signal,
    });
    assert.equal(failed.exitCode, 3);
    assert.equal(failed.state, "completed");
    const timed = await runCheckCommand({
      workspace: root,
      command: "sleep 20",
      timeoutMs: 50,
      signal: new AbortController().signal,
    });
    assert.equal(timed.state, "timed_out");
    const stop = new AbortController();
    const pending = runCheckCommand({
      workspace: root,
      command: "sleep 20",
      timeoutMs: 5000,
      signal: stop.signal,
    });
    setTimeout(() => stop.abort(), 50);
    assert.equal((await pending).state, "cancelled");
  },
);
