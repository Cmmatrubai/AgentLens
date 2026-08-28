import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureGitAfter,
  captureGitBefore,
  untrackedMetadataForPathBytes
} from "../src/gitEvidence.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const unsupportedFilterMessage =
  "AgentLens v0.1 does not support Git evidence capture when clean or process filters are configured.";
const gitTraceEnvironmentKeys = [
  "GIT_TRACE",
  "GIT_TRACE_FSMONITOR",
  "GIT_TRACE_PACK_ACCESS",
  "GIT_TRACE_PACKET",
  "GIT_TRACE_PACKFILE",
  "GIT_TRACE_PERFORMANCE",
  "GIT_TRACE_REFS",
  "GIT_TRACE_SETUP",
  "GIT_TRACE_SHALLOW",
  "GIT_TRACE_CURL",
  "GIT_TRACE2",
  "GIT_TRACE2_EVENT",
  "GIT_TRACE2_PERF"
] as const;

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

async function bloblessSparseRepository(): Promise<Readonly<{
  root: string;
  missingInitialBlob: string;
}>> {
  const source = await cleanRepository();
  await mkdir(join(source, "sparse"));
  await writeFile(join(source, "sparse", "hidden.txt"), "hidden before\n", "utf8");
  await git(source, "add", "sparse/hidden.txt");
  await git(source, "commit", "-qm", "add sparse fixture");
  const missingInitialBlob = (await git(source, "rev-parse", "HEAD:sparse/hidden.txt")).trim();

  const originParent = await mkdtemp(join(tmpdir(), "agentlens-cli-origin-"));
  roots.push(originParent);
  const origin = join(originParent, "origin.git");
  await git(originParent, "clone", "--bare", source, origin);
  await git(origin, "config", "uploadpack.allowFilter", "true");

  const cloneParent = await mkdtemp(join(tmpdir(), "agentlens-cli-partial-"));
  roots.push(cloneParent);
  await git(
    cloneParent,
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    pathToFileURL(origin).href,
    "clone"
  );
  const root = join(cloneParent, "clone");
  await git(root, "config", "user.email", "fixture@example.test");
  await git(root, "config", "user.name", "AgentLens Fixture");
  await git(root, "sparse-checkout", "set", "--no-cone", "tracked.txt");
  await git(root, "checkout", "-q");
  return { root, missingInitialBlob };
}

async function objectExistsWithoutLazyFetch(cwd: string, object: string): Promise<boolean> {
  return execFile("git", ["cat-file", "-e", object], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }
  }).then(() => true, () => false);
}

async function markerHelper(
  root: string,
  name: string,
  stdout?: string
): Promise<Readonly<{ command: string; marker: string }>> {
  const command = join(root, ".git", `${name}.mjs`);
  const marker = join(root, ".git", `${name}.invoked`);
  await writeFile(command, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "invoked\\n");
${stdout === undefined
    ? "process.stdin.pipe(process.stdout);"
    : `process.stdout.write(${JSON.stringify(stdout)});`}
`, "utf8");
  await chmod(command, 0o755);
  return { command, marker };
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
  it("refuses a configured clean filter before initial status can execute it", async () => {
    const root = await cleanRepository();
    const helper = await markerHelper(root, "clean-filter-helper");
    await writeFile(join(root, ".gitattributes"), "tracked.txt filter=agentlens-test\n", "utf8");
    await git(root, "add", ".gitattributes");
    await git(root, "commit", "-qm", "configure clean filter attributes");
    await git(root, "config", "filter.agentlens-test.clean", helper.command);
    const future = new Date(Date.now() + 120_000);
    await utimes(join(root, "tracked.txt"), future, future);

    const captureError = await captureGitBefore(root).then(
      () => null,
      (error: unknown) => error instanceof Error ? error.message : String(error)
    );
    const helperInvoked = await readFile(helper.marker).then(() => true, () => false);

    expect({ captureError, helperInvoked }).toEqual({
      captureError: unsupportedFilterMessage,
      helperInvoked: false
    });
  });

  it("refuses a configured process filter before final status or diff can execute it", async () => {
    const root = await cleanRepository();
    await writeFile(join(root, ".gitattributes"), "tracked.txt filter=agentlens-test\n", "utf8");
    await git(root, "add", ".gitattributes");
    await git(root, "commit", "-qm", "configure process filter attributes");
    const before = await captureGitBefore(root);
    const helper = await markerHelper(root, "process-filter-helper", "");
    await git(root, "config", "filter.agentlens-test.process", helper.command);
    await writeFile(join(root, "tracked.txt"), "after\n", "utf8");

    const captureError = await captureGitAfter(before).then(
      () => null,
      (error: unknown) => error instanceof Error ? error.message : String(error)
    );
    const helperInvoked = await readFile(helper.marker).then(() => true, () => false);

    expect({ captureError, helperInvoked }).toEqual({
      captureError: unsupportedFilterMessage,
      helperInvoked: false
    });
  });

  it("scrubs inherited Git trace destinations without changing the clean worktree", async () => {
    const outcomes: Array<{
      variable: typeof gitTraceEnvironmentKeys[number];
      captureSucceeded: boolean;
      traceCreated: boolean;
    }> = [];
    for (const variable of gitTraceEnvironmentKeys) {
      const root = await cleanRepository();
      const tracePath = join(root, `${variable.toLowerCase()}.trace`);
      const previous = process.env[variable];
      try {
        process.env[variable] = tracePath;
        const captureSucceeded = await captureGitBefore(root).then(() => true, () => false);
        const traceCreated = await readFile(tracePath).then(() => true, () => false);
        outcomes.push({ variable, captureSucceeded, traceCreated });
      } finally {
        if (previous === undefined) delete process.env[variable];
        else process.env[variable] = previous;
      }
    }

    expect(outcomes).toEqual([
      { variable: "GIT_TRACE", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_FSMONITOR", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_PACK_ACCESS", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_PACKET", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_PACKFILE", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_PERFORMANCE", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_REFS", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_SETUP", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_SHALLOW", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE_CURL", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE2", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE2_EVENT", captureSucceeded: true, traceCreated: false },
      { variable: "GIT_TRACE2_PERF", captureSucceeded: true, traceCreated: false }
    ]);
  });

  it("overrides a global-configured trace2 event target", async () => {
    const root = await cleanRepository();
    const tracePath = join(root, "git-trace2-config.json");
    const globalConfig = join(root, ".git", "test-global-config");
    await git(root, "config", "--file", globalConfig, "trace2.eventTarget", tracePath);
    const previous = process.env.GIT_CONFIG_GLOBAL;
    let captureSucceeded: boolean;
    let traceCreated: boolean;
    try {
      process.env.GIT_CONFIG_GLOBAL = globalConfig;
      captureSucceeded = await captureGitBefore(root).then(() => true, () => false);
      traceCreated = await readFile(tracePath).then(() => true, () => false);
    } finally {
      if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previous;
    }

    expect({ captureSucceeded, traceCreated }).toEqual({
      captureSucceeded: true,
      traceCreated: false
    });
  });

  it("does not lazily fetch a missing promised blob for the final diff", async () => {
    const { root, missingInitialBlob } = await bloblessSparseRepository();
    expect(await git(root, "status", "--porcelain=v1")).toBe("");
    expect(await objectExistsWithoutLazyFetch(root, missingInitialBlob)).toBe(false);
    const before = await captureGitBefore(root);
    expect(await objectExistsWithoutLazyFetch(root, missingInitialBlob)).toBe(false);
    const hiddenPath = Buffer.from("sparse/hidden.txt");
    writeIndexBlob(root, hiddenPath, "hidden after\n");
    markSkipWorktree(root, hiddenPath);
    await git(root, "commit", "-qm", "change sparse fixture");

    const captureSucceeded = await captureGitAfter(before).then(() => true, () => false);
    const missingBlobFetched = await objectExistsWithoutLazyFetch(root, missingInitialBlob);

    expect({ captureSucceeded, missingBlobFetched }).toEqual({
      captureSucceeded: false,
      missingBlobFetched: false
    });
  });

  it("does not refresh index bytes when a clean tracked file mtime changes", async () => {
    const root = await cleanRepository();
    const indexPath = join(root, ".git", "index");
    const indexBefore = await readFile(indexPath);
    const future = new Date(Date.now() + 120_000);
    await utimes(join(root, "tracked.txt"), future, future);

    await captureGitBefore(root);

    expect(await readFile(indexPath)).toEqual(indexBefore);
  });

  it("does not invoke a configured fsmonitor helper during capture", async () => {
    const root = await cleanRepository();
    const helper = await markerHelper(root, "fsmonitor-helper", "fsmonitor-token\\n");
    await git(root, "config", "core.fsmonitor", helper.command);

    await captureGitBefore(root);

    await expect(readFile(helper.marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not invoke a configured textconv helper for the tracked final diff", async () => {
    const root = await cleanRepository();
    const helper = await markerHelper(root, "textconv-helper", "converted\\n");
    await writeFile(join(root, ".gitattributes"), "tracked.txt diff=agentlens-test\n", "utf8");
    await git(root, "add", ".gitattributes");
    await git(root, "commit", "-qm", "configure diff attributes");
    await git(root, "config", "diff.agentlens-test.textconv", helper.command);
    const before = await captureGitBefore(root);
    await writeFile(join(root, "tracked.txt"), "after\n", "utf8");

    await captureGitAfter(before);

    await expect(readFile(helper.marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

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
      [
        "config",
        "--includes",
        "--name-only",
        "--get-regexp",
        "^filter\\..*\\.(clean|process)$"
      ],
      ["rev-parse", "HEAD"],
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      ["status", "--porcelain=v2", "--untracked-files=all", "-z"],
      [
        "config",
        "--includes",
        "--name-only",
        "--get-regexp",
        "^filter\\..*\\.(clean|process)$"
      ],
      ["rev-parse", "HEAD"],
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      ["status", "--porcelain=v2", "--untracked-files=all", "-z"],
      ["diff", "--binary", "--no-ext-diff", "--no-textconv", before.initialHead, "--"],
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
