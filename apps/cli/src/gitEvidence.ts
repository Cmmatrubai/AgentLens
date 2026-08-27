import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface GitCaptureOptions {
  readonly onCommand?: (args: readonly string[]) => void;
}

export interface GitBeforeEvidence {
  readonly repositoryRoot: string;
  readonly initialHead: string;
  readonly initialBranch: string | null;
  readonly initialStatus: string;
}

export interface UntrackedFileMetadata {
  readonly path: string;
  readonly type: "file" | "directory" | "symlink" | "other";
  readonly size: number;
}

export interface GitAfterEvidence {
  readonly finalHead: string;
  readonly finalBranch: string | null;
  readonly finalStatus: string;
  readonly trackedFinalDiff: string;
  readonly diffCheck: Readonly<{ passed: boolean; output: string }>;
  readonly untrackedMetadata: readonly UntrackedFileMetadata[];
  readonly headChanged: boolean;
  readonly branchChanged: boolean;
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

async function runGit(
  cwd: string,
  args: readonly string[],
  options: GitCaptureOptions,
  acceptedExitCodes: readonly number[] = [0]
): Promise<GitResult> {
  options.onCommand?.(args);
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        const exitCode = typeof (error as NodeJS.ErrnoException | null)?.code === "number"
          ? (error as NodeJS.ErrnoException & { code: number }).code
          : error ? -1 : 0;
        if (!acceptedExitCodes.includes(exitCode)) {
          reject(new Error(`Git command failed: git ${args.join(" ")}\n${stderr}`, { cause: error }));
          return;
        }
        resolvePromise({ stdout, stderr, exitCode });
      }
    );
  });
}

async function branch(cwd: string, options: GitCaptureOptions): Promise<string | null> {
  const result = await runGit(
    cwd,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    options,
    [0, 1]
  );
  return result.exitCode === 0 ? result.stdout.trimEnd() : null;
}

export function decodeGitPath(value: string): string {
  const candidate = value.trim();
  if (!candidate.startsWith('"')) return candidate;
  if (!candidate.endsWith('"')) throw new Error(`Unsupported quoted Git status path: ${candidate}`);

  const bytes: number[] = [];
  const escapes: Readonly<Record<string, number>> = {
    a: 0x07,
    b: 0x08,
    t: 0x09,
    n: 0x0a,
    v: 0x0b,
    f: 0x0c,
    r: 0x0d,
    '"': 0x22,
    "\\": 0x5c
  };
  for (let index = 1; index < candidate.length - 1; index += 1) {
    const character = candidate[index];
    if (character !== "\\") {
      const codePoint = candidate.codePointAt(index);
      if (codePoint === undefined) throw new Error(`Unsupported quoted Git status path: ${candidate}`);
      bytes.push(...Buffer.from(String.fromCodePoint(codePoint), "utf8"));
      if (codePoint > 0xffff) index += 1;
      continue;
    }

    const escaped = candidate[++index];
    if (escaped === undefined || index >= candidate.length - 1) {
      throw new Error(`Unsupported quoted Git status path: ${candidate}`);
    }
    const simple = escapes[escaped];
    if (simple !== undefined) {
      bytes.push(simple);
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/.test(candidate[index + 1] ?? "")) {
        octal += candidate[++index];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    throw new Error(`Unsupported quoted Git status escape: \\${escaped}`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch (error) {
    throw new Error(`Git status path is not valid UTF-8: ${candidate}`, { cause: error });
  }
}

function untrackedPaths(status: string): string[] {
  return status
    .split("\n")
    .filter((line) => line.startsWith("? "))
    .map((line) => decodeGitPath(line.slice(2)));
}

async function untrackedMetadata(
  repositoryRoot: string,
  status: string
): Promise<UntrackedFileMetadata[]> {
  const canonicalRoot = await realpath(repositoryRoot);
  const results: UntrackedFileMetadata[] = [];
  for (const path of untrackedPaths(status)) {
    if (isAbsolute(path)) throw new Error("Git reported an absolute untracked path.");
    const absolutePath = resolve(repositoryRoot, path);
    const relativePath = relative(repositoryRoot, absolutePath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Git reported an untracked path outside the repository root.");
    }
    const parent = resolve(absolutePath, "..");
    const canonicalParent = await realpath(parent);
    if (canonicalParent !== canonicalRoot && !canonicalParent.startsWith(`${canonicalRoot}/`)) {
      throw new Error("Untracked path parent escapes the repository root.");
    }
    const metadata = await lstat(absolutePath);
    const type = metadata.isSymbolicLink()
      ? "symlink"
      : metadata.isFile()
        ? "file"
        : metadata.isDirectory() ? "directory" : "other";
    results.push(Object.freeze({ path, type, size: metadata.size }));
  }
  return results;
}

export async function captureGitBefore(
  cwd: string,
  options: GitCaptureOptions = {}
): Promise<GitBeforeEvidence> {
  let repositoryRoot: string;
  try {
    repositoryRoot = (await runGit(cwd, ["rev-parse", "--show-toplevel"], options)).stdout.trimEnd();
  } catch (error) {
    throw new Error("AgentLens record requires a Git repository.", { cause: error });
  }
  const initialHead = (await runGit(repositoryRoot, ["rev-parse", "HEAD"], options)).stdout.trimEnd();
  const initialBranch = await branch(repositoryRoot, options);
  const initialStatus = (
    await runGit(repositoryRoot, ["status", "--porcelain=v2", "--untracked-files=all"], options)
  ).stdout;
  if (initialStatus.length > 0) {
    throw new Error("AgentLens record requires a clean Git repository before child spawn.");
  }
  return Object.freeze({ repositoryRoot, initialHead, initialBranch, initialStatus });
}

export async function captureGitAfter(
  before: GitBeforeEvidence,
  options: GitCaptureOptions = {}
): Promise<GitAfterEvidence> {
  const finalHead = (await runGit(before.repositoryRoot, ["rev-parse", "HEAD"], options)).stdout.trimEnd();
  const finalBranch = await branch(before.repositoryRoot, options);
  const finalStatus = (
    await runGit(
      before.repositoryRoot,
      ["status", "--porcelain=v2", "--untracked-files=all"],
      options
    )
  ).stdout;
  const trackedFinalDiff = (
    await runGit(
      before.repositoryRoot,
      ["diff", "--binary", "--no-ext-diff", before.initialHead, "--"],
      options
    )
  ).stdout;
  const diffCheckResult = await runGit(
    before.repositoryRoot,
    ["diff", "--check", before.initialHead, "--"],
    options,
    [0, 2]
  );
  const diffCheckOutput = `${diffCheckResult.stdout}${diffCheckResult.stderr}`;
  return Object.freeze({
    finalHead,
    finalBranch,
    finalStatus,
    trackedFinalDiff,
    diffCheck: Object.freeze({ passed: diffCheckResult.exitCode === 0, output: diffCheckOutput }),
    untrackedMetadata: Object.freeze(await untrackedMetadata(before.repositoryRoot, finalStatus)),
    headChanged: finalHead !== before.initialHead,
    branchChanged: finalBranch !== before.initialBranch
  });
}
