import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureGitAfter,
  captureGitBefore,
  untrackedMetadataForPathBytes
} from "../src/gitEvidence.js";

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

function writeIndexBlob(root: string, path: Buffer, body: string): void {
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: root,
    input: Buffer.from(body),
    encoding: "utf8"
  }).trim();
  execFileSync("git", ["update-index", "-z", "--index-info"], {
    cwd: root,
    input: Buffer.concat([Buffer.from(`100644 ${blob}\t`), path, Buffer.from([0])])
  });
}

function markSkipWorktree(root: string, path: Buffer): void {
  execFileSync("git", ["update-index", "--skip-worktree", "-z", "--stdin"], {
    cwd: root,
    input: Buffer.concat([path, Buffer.from([0])])
  });
}

async function captureIndexPathChange(root: string, path: Buffer, finalBody: string) {
  writeIndexBlob(root, path, "before\n");
  execFileSync("git", ["commit", "-qm", "path fixture"], { cwd: root });
  markSkipWorktree(root, path);
  const before = await captureGitBefore(root);
  writeIndexBlob(root, path, finalBody);
  markSkipWorktree(root, path);
  return captureGitAfter(before);
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
      ["status", "--porcelain=v2", "--untracked-files=all", "-z"],
      ["rev-parse", "HEAD"],
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      ["status", "--porcelain=v2", "--untracked-files=all", "-z"],
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

    expect(after.finalStatus).toContain('"é space.txt"');
    expect(after.untrackedMetadata).toEqual([
      { path: "é space.txt", type: "file", size: 7 }
    ]);
  });

  it("preserves both valid UTF-8 paths in a porcelain-v2 rename record", async () => {
    const root = await cleanRepository();
    await writeFile(join(root, "é old name.txt"), "rename\n", "utf8");
    await git(root, "add", "é old name.txt");
    await git(root, "commit", "-qm", "rename fixture");
    const before = await captureGitBefore(root);
    await git(root, "mv", "é old name.txt", "é new name.txt");

    const after = await captureGitAfter(before);

    expect(after.finalStatus).toContain('"é new name.txt"\t"é old name.txt"');
    expect(after.untrackedMetadata).toEqual([]);
  });

  it("represents a real Git index path with invalid UTF-8 as a content-free placeholder", async () => {
    const root = await cleanRepository();
    const rawName = Buffer.concat([
      Buffer.from("NONUTF8_PATH_SENTINEL_"),
      Buffer.from([0xff]),
      Buffer.from("/.env")
    ]);
    const after = await captureIndexPathChange(root, rawName, "INVALID_DETAIL_SECRET   \n");

    expect(after.finalStatus).toContain("[[UNREPRESENTABLE_GIT_PATH]]");
    expect(after.finalStatus).not.toContain("NONUTF8_PATH_SENTINEL");
    expect(after.trackedFinalDiff).toBe("[[EXCLUDED:unrepresentable-git-path]]\n");
    expect(after.diffCheck).toEqual({
      passed: false,
      output: "[[EXCLUDED:unrepresentable-git-path]]\n"
    });
    expect(after.trackedFinalDiff).not.toContain("NONUTF8_PATH_SENTINEL");
    expect(after.diffCheck.output).not.toContain("NONUTF8_PATH_SENTINEL");
    expect(after.diffCheck.output).not.toContain("INVALID_DETAIL_SECRET");
    expect(after.untrackedMetadata).toEqual([]);
  });

  it("keeps a valid newline path framing-safe for downstream policy", async () => {
    const root = await cleanRepository();
    const after = await captureIndexPathChange(
      root,
      Buffer.from(".env/\nfile"),
      "CONTROL_DETAIL_SECRET   \n"
    );

    expect(after.diffCheck).toEqual({
      passed: false,
      output: '".env/\\nfile":1: trailing whitespace.\n+CONTROL_DETAIL_SECRET   \n'
    });
  });

  it.each([
    ["U+2028", "\u2028", "342\\200\\250", "LINE_SEPARATOR_DETAIL_SECRET"],
    ["U+2029", "\u2029", "342\\200\\251", "PARAGRAPH_SEPARATOR_DETAIL_SECRET"]
  ])("keeps a valid %s path framing-safe for downstream policy", async (
    _name,
    separator,
    octal,
    detail
  ) => {
    const root = await cleanRepository();
    const after = await captureIndexPathChange(
      root,
      Buffer.from(`.env/${separator}file`),
      `${detail}   \n`
    );

    expect(after.diffCheck).toEqual({
      passed: false,
      output: `".env/\\${octal}file":1: trailing whitespace.\n+${detail}   \n`
    });
  });

  it("keeps included ordinary and quoted diff-check paths stable", async () => {
    const ordinaryRoot = await cleanRepository();
    const ordinaryBefore = await captureGitBefore(ordinaryRoot);
    await writeFile(join(ordinaryRoot, "tracked.txt"), "ordinary detail   \n", "utf8");
    const ordinary = await captureGitAfter(ordinaryBefore);
    const quotedRoot = await cleanRepository();
    const quoted = await captureIndexPathChange(
      quotedRoot,
      Buffer.from("ordinary\nfile.txt"),
      "quoted detail   \n"
    );

    expect(ordinary.diffCheck.output).toBe(
      "tracked.txt:1: trailing whitespace.\n+ordinary detail   \n"
    );
    expect(quoted.diffCheck.output).toBe(
      '"ordinary\\nfile.txt":1: trailing whitespace.\n+quoted detail   \n'
    );
  });

  it("uses exact invalid path bytes for contained lstat while returning safe metadata", async () => {
    const root = await cleanRepository();
    const safeFile = join(root, "safe-metadata.txt");
    await writeFile(safeFile, "bytes", "utf8");
    const rawName = Buffer.concat([
      Buffer.from("NONUTF8_PATH_SENTINEL_"),
      Buffer.from([0xff]),
      Buffer.from(".txt")
    ]);
    const observedLstat: Buffer[] = [];

    const metadata = await untrackedMetadataForPathBytes(root, [rawName], {
      realpath: async () => Buffer.from(root),
      lstat: async (path) => {
        observedLstat.push(Buffer.from(path));
        return lstat(safeFile);
      }
    });

    expect(observedLstat).toEqual([
      Buffer.concat([Buffer.from(root), Buffer.from("/"), rawName])
    ]);
    expect(metadata).toEqual([
      { path: "[[UNREPRESENTABLE_GIT_PATH]]", type: "file", size: 5 }
    ]);
  });
});
