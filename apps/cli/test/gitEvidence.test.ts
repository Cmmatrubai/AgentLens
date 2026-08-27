import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { captureGitAfter, captureGitBefore } from "../src/gitEvidence.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile("git", args, { cwd, encoding: "utf8" })).stdout;
}

async function cleanRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-cli-git-"));
  roots.push(root);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "fixture@example.test");
  await git(root, "config", "user.name", "AgentLens Fixture");
  await writeFile(join(root, "tracked.txt"), "before\n", "utf8");
  await git(root, "add", "tracked.txt");
  await git(root, "commit", "-qm", "initial");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only Git evidence", () => {
  it("refuses tracked, staged, or untracked dirt before child spawn can happen", async () => {
    const root = await cleanRepository();
    await writeFile(join(root, "untracked.txt"), "dirty\n", "utf8");

    await expect(captureGitBefore(root)).rejects.toThrow(/clean Git repository/i);
  });

  it("uses only the frozen read-only Git command allowlist", async () => {
    const root = await cleanRepository();
    const observed: string[][] = [];
    const before = await captureGitBefore(root, {
      onCommand: (args) => observed.push([...args])
    });
    await captureGitAfter(before, {
      onCommand: (args) => observed.push([...args])
    });

    expect(observed).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "HEAD"],
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      ["status", "--porcelain=v2", "--untracked-files=all"],
      ["rev-parse", "HEAD"],
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      ["status", "--porcelain=v2", "--untracked-files=all"],
      ["diff", "--binary", "--no-ext-diff", before.initialHead, "--"],
      ["diff", "--check", before.initialHead, "--"]
    ]);
  });

  it("keeps committed changes visible from the initial HEAD even with a clean final worktree", async () => {
    const root = await cleanRepository();
    const before = await captureGitBefore(root);
    await writeFile(join(root, "tracked.txt"), "after commit\n", "utf8");
    await git(root, "add", "tracked.txt");
    await git(root, "commit", "-qm", "child commit");

    const after = await captureGitAfter(before);

    expect(after.finalStatus).toBe("");
    expect(after.finalHead).not.toBe(before.initialHead);
    expect(after.headChanged).toBe(true);
    expect(after.trackedFinalDiff).toContain("+after commit");
    expect(after.diffCheck).toEqual({ passed: true, output: "" });
  });

  it("exposes branch changes and untracked metadata without reading file contents", async () => {
    const root = await cleanRepository();
    const before = await captureGitBefore(root);
    await git(root, "checkout", "-qb", "child-branch");
    await writeFile(join(root, "future.txt"), "UNTRACKED_CONTENT_MUST_NOT_APPEAR", "utf8");

    const after = await captureGitAfter(before);

    expect(after.branchChanged).toBe(true);
    expect(after.finalBranch).toBe("child-branch");
    expect(after.untrackedMetadata).toEqual([
      { path: "future.txt", type: "file", size: 33 }
    ]);
    expect(JSON.stringify(after.untrackedMetadata)).not.toContain("UNTRACKED_CONTENT_MUST_NOT_APPEAR");
    expect(await readFile(join(root, "future.txt"), "utf8")).toBe("UNTRACKED_CONTENT_MUST_NOT_APPEAR");
  });

  it("decodes Git C-quoted octal UTF-8 paths from a real repository", async () => {
    const root = await cleanRepository();
    await git(root, "config", "core.quotePath", "true");
    const before = await captureGitBefore(root);
    await writeFile(join(root, "é space.txt"), "quoted\n", "utf8");

    const after = await captureGitAfter(before);

    expect(after.finalStatus).toContain('"\\303\\251 space.txt"');
    expect(after.untrackedMetadata).toEqual([
      { path: "é space.txt", type: "file", size: 7 }
    ]);
  });
});
