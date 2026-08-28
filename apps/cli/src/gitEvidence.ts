import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";

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

export interface GitFilesystemAdapter {
  readonly realpath: (path: Buffer) => Promise<Buffer>;
  readonly lstat: (path: Buffer) => Promise<Stats>;
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface GitByteResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number;
}

interface GitStatusCapture {
  readonly display: string;
  readonly recordCount: number;
  readonly untrackedPaths: readonly Buffer[];
}

interface TrackedDiffCapture {
  readonly display: string;
  readonly paths: readonly Buffer[];
}

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
export const UNREPRESENTABLE_GIT_PATH = "[[UNREPRESENTABLE_GIT_PATH]]";

function exitCodeFor(error: Error | null): number {
  return typeof (error as NodeJS.ErrnoException | null)?.code === "number"
    ? (error as NodeJS.ErrnoException & { code: number }).code
    : error ? -1 : 0;
}

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
      ["-c", "core.fsmonitor=false", ...args],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
      },
      (error, stdout, stderr) => {
        const exitCode = exitCodeFor(error);
        if (!acceptedExitCodes.includes(exitCode)) {
          reject(new Error(
            `Git command failed: git ${args.join(" ")} (exit ${exitCode}).`,
            { cause: error }
          ));
          return;
        }
        resolvePromise({ stdout, stderr, exitCode });
      }
    );
  });
}

async function runGitBytes(
  cwd: string,
  args: readonly string[],
  options: GitCaptureOptions,
  acceptedExitCodes: readonly number[] = [0]
): Promise<GitByteResult> {
  options.onCommand?.(args);
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["-c", "core.fsmonitor=false", ...args],
      {
        cwd,
        encoding: null,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
      },
      (error, stdout, stderr) => {
        const exitCode = exitCodeFor(error);
        if (!acceptedExitCodes.includes(exitCode)) {
          reject(new Error(
            `Git command failed: git ${args.join(" ")} (exit ${exitCode}).`,
            { cause: error }
          ));
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

export function decodeGitPathBytes(value: string | Buffer): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  const candidate = value.trim();
  if (!candidate.startsWith('"')) return Buffer.from(candidate, "utf8");
  if (!candidate.endsWith('"')) throw new Error(`Unsupported quoted Git status path: ${candidate}`);

  return decodeQuotedGitPathToken(Buffer.from(candidate, "utf8"));
}

function decodeQuotedGitPathToken(candidate: Buffer): Buffer {
  if (candidate[0] !== 0x22 || candidate[candidate.length - 1] !== 0x22) {
    throw new Error("Malformed quoted Git path.");
  }
  const bytes: number[] = [];
  const escapes: Readonly<Record<number, number>> = {
    0x61: 0x07,
    0x62: 0x08,
    0x74: 0x09,
    0x6e: 0x0a,
    0x76: 0x0b,
    0x66: 0x0c,
    0x72: 0x0d,
    0x22: 0x22,
    0x5c: 0x5c
  };
  for (let index = 1; index < candidate.length - 1; index += 1) {
    const byte = candidate[index];
    if (byte !== 0x5c) {
      if (byte === undefined) throw new Error("Malformed quoted Git path.");
      bytes.push(byte);
      continue;
    }

    const escaped = candidate[++index];
    if (escaped === undefined || index >= candidate.length - 1) {
      throw new Error("Malformed quoted Git path escape.");
    }
    const simple = escapes[escaped];
    if (simple !== undefined) {
      bytes.push(simple);
      continue;
    }
    if (escaped >= 0x30 && escaped <= 0x37) {
      let octal = String.fromCharCode(escaped);
      while (
        octal.length < 3 &&
        candidate[index + 1] !== undefined &&
        candidate[index + 1]! >= 0x30 &&
        candidate[index + 1]! <= 0x37
      ) {
        octal += String.fromCharCode(candidate[++index]!);
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    throw new Error("Unsupported quoted Git path escape.");
  }
  return Buffer.from(bytes);
}

export function displayGitPath(path: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(path);
  } catch {
    return UNREPRESENTABLE_GIT_PATH;
  }
}

export function decodeGitPath(value: string): string {
  return displayGitPath(decodeGitPathBytes(value));
}

function statusDisplayPath(path: Buffer): string {
  const decoded = displayGitPath(path);
  if (decoded === UNREPRESENTABLE_GIT_PATH) return decoded;
  if (!/[\s"\\\u0000-\u001f\u007f]/u.test(decoded)) return decoded;
  return `"${decoded.replace(/["\\\u0000-\u001f\u007f\u2028\u2029]/gu, (character) => {
    if (character === '"') return '\\"';
    if (character === "\\") return "\\\\";
    if (character === "\t") return "\\t";
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    return [...Buffer.from(character, "utf8")]
      .map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
      .join("");
  })}"`;
}

function splitNullRecords(raw: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== 0) continue;
    records.push(raw.subarray(start, index));
    start = index + 1;
  }
  if (start < raw.length) records.push(raw.subarray(start));
  return records;
}

function afterSpaces(record: Buffer, count: number): number {
  let remaining = count;
  for (let index = 0; index < record.length; index += 1) {
    if (record[index] !== 0x20) continue;
    remaining -= 1;
    if (remaining === 0) return index + 1;
  }
  throw new Error("Malformed Git porcelain-v2 status record.");
}

function parseStatus(raw: Buffer): GitStatusCapture {
  const records = splitNullRecords(raw);
  const displayRecords: string[] = [];
  const untrackedPaths: Buffer[] = [];
  let recordCount = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.length === 0) continue;
    recordCount += 1;
    const kind = String.fromCharCode(record[0] ?? 0);
    if (kind === "?" || kind === "!") {
      const path = Buffer.from(record.subarray(2));
      displayRecords.push(`${kind} ${statusDisplayPath(path)}`);
      if (kind === "?") untrackedPaths.push(path);
      continue;
    }
    const pathStart = kind === "1"
      ? afterSpaces(record, 8)
      : kind === "2"
        ? afterSpaces(record, 9)
        : kind === "u"
          ? afterSpaces(record, 10)
          : -1;
    if (pathStart < 0) {
      displayRecords.push("[[UNSUPPORTED_GIT_STATUS_RECORD]]");
      continue;
    }
    const prefix = record.subarray(0, pathStart).toString("ascii");
    const path = record.subarray(pathStart);
    if (kind === "2") {
      const originalPath = records[++index];
      if (originalPath === undefined) throw new Error("Malformed Git rename status record.");
      displayRecords.push(`${prefix}${statusDisplayPath(path)}\t${statusDisplayPath(originalPath)}`);
      continue;
    }
    displayRecords.push(`${prefix}${statusDisplayPath(path)}`);
  }
  return Object.freeze({
    display: displayRecords.length === 0 ? "" : `${displayRecords.join("\n")}\n`,
    recordCount,
    untrackedPaths: Object.freeze(untrackedPaths)
  });
}

function diffHeaderTokens(line: Buffer): readonly Buffer[] {
  const prefix = Buffer.from("diff --git ");
  if (!line.subarray(0, prefix.length).equals(prefix)) return [];
  const tokens: Buffer[] = [];
  let index = prefix.length;
  while (index < line.length && tokens.length < 2) {
    while (line[index] === 0x20) index += 1;
    const start = index;
    if (line[index] === 0x22) {
      index += 1;
      while (index < line.length) {
        if (line[index] === 0x5c) {
          index += 2;
          continue;
        }
        if (line[index] === 0x22) {
          index += 1;
          break;
        }
        index += 1;
      }
    } else {
      while (index < line.length && line[index] !== 0x20) index += 1;
    }
    tokens.push(Buffer.from(line.subarray(start, index)));
  }
  return tokens;
}

function pathBytesFromDiffToken(token: Buffer): Buffer {
  const decoded = token[0] === 0x22 ? decodeQuotedGitPathToken(token) : Buffer.from(token);
  return decoded.length >= 2 && decoded[1] === 0x2f ? decoded.subarray(2) : decoded;
}

function diffBlockHasUnrepresentablePath(block: Buffer): boolean {
  const newline = block.indexOf(0x0a);
  const header = newline < 0 ? block : block.subarray(0, newline);
  const tokens = diffHeaderTokens(header);
  return tokens.length !== 2 || tokens.some((token) =>
    displayGitPath(pathBytesFromDiffToken(token)) === UNREPRESENTABLE_GIT_PATH
  );
}

function safeTrackedDiff(raw: Buffer): TrackedDiffCapture {
  if (raw.length === 0) return Object.freeze({ display: "", paths: Object.freeze([]) });
  const header = Buffer.from("diff --git ");
  const subsequentHeader = Buffer.from("\ndiff --git ");
  const starts: number[] = [];
  if (raw.subarray(0, header.length).equals(header)) starts.push(0);
  let searchFrom = 0;
  while (searchFrom < raw.length) {
    const found = raw.indexOf(subsequentHeader, searchFrom);
    if (found < 0) break;
    starts.push(found + 1);
    searchFrom = found + subsequentHeader.length;
  }
  if (starts.length === 0) {
    return Object.freeze({ display: raw.toString("utf8"), paths: Object.freeze([]) });
  }

  const output: string[] = [];
  const paths: Buffer[] = [];
  if (starts[0]! > 0) output.push(raw.subarray(0, starts[0]).toString("utf8"));
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = starts[index + 1] ?? raw.length;
    const block = raw.subarray(start, end);
    const newline = block.indexOf(0x0a);
    const header = newline < 0 ? block : block.subarray(0, newline);
    paths.push(...diffHeaderTokens(header).map(pathBytesFromDiffToken));
    output.push(diffBlockHasUnrepresentablePath(block)
      ? "[[EXCLUDED:unrepresentable-git-path]]\n"
      : block.toString("utf8"));
  }
  return Object.freeze({ display: output.join(""), paths: Object.freeze(paths) });
}

function quotedTokenEnd(raw: Buffer, start: number): number | undefined {
  if (raw[start] !== 0x22) return undefined;
  for (let index = start + 1; index < raw.length; index += 1) {
    if (raw[index] === 0x5c) {
      index += 1;
      continue;
    }
    if (raw[index] === 0x22) return index + 1;
  }
  return undefined;
}

function matchingDiffCheckPath(
  raw: Buffer,
  start: number,
  paths: readonly Buffer[]
): Readonly<{ path: Buffer; encodedEnd: number }> | undefined {
  for (const path of [...paths].sort((left, right) => right.length - left.length)) {
    const end = start + path.length;
    if (raw.subarray(start, end).equals(path) && raw[end] === 0x3a) {
      return Object.freeze({ path, encodedEnd: end });
    }
  }
  const quotedEnd = quotedTokenEnd(raw, start);
  if (quotedEnd === undefined || raw[quotedEnd] !== 0x3a) return undefined;
  const decoded = decodeQuotedGitPathToken(raw.subarray(start, quotedEnd));
  const path = paths.find((candidate) => candidate.equals(decoded));
  return path === undefined ? undefined : Object.freeze({ path, encodedEnd: quotedEnd });
}

function safeDiffCheckOutput(raw: Buffer, paths: readonly Buffer[]): string {
  const output: string[] = [];
  let start = 0;
  while (start < raw.length) {
    const matched = matchingDiffCheckPath(raw, start, paths);
    if (matched !== undefined) {
      const headerEnd = raw.indexOf(0x0a, matched.encodedEnd);
      const suffixEnd = headerEnd < 0 ? raw.length : headerEnd;
      const suffix = raw.subarray(matched.encodedEnd, suffixEnd).toString("utf8");
      if (/^:\d+:\s.*$/u.test(suffix)) {
        const detailStart = headerEnd < 0 ? raw.length : headerEnd + 1;
        const detailEnd = raw.indexOf(0x0a, detailStart);
        const detailLimit = detailEnd < 0 ? raw.length : detailEnd;
        const hasDetail = raw[detailStart] === 0x2b;
        if (displayGitPath(matched.path) === UNREPRESENTABLE_GIT_PATH) {
          output.push("[[EXCLUDED:unrepresentable-git-path]]\n");
        } else {
          output.push(`${statusDisplayPath(matched.path)}${suffix}`);
          if (headerEnd >= 0) output.push("\n");
          if (hasDetail) {
            output.push(raw.subarray(detailStart, detailLimit).toString("utf8"));
            if (detailEnd >= 0) output.push("\n");
          }
        }
        start = hasDetail ? (detailEnd < 0 ? raw.length : detailEnd + 1) : detailStart;
        continue;
      }
    }
    const newline = raw.indexOf(0x0a, start);
    const end = newline < 0 ? raw.length : newline;
    output.push(raw.subarray(start, end).toString("utf8"));
    if (newline < 0) break;
    output.push("\n");
    start = newline + 1;
  }
  return output.join("");
}

const defaultFilesystem: GitFilesystemAdapter = Object.freeze({
  realpath: async (path: Buffer) => {
    const resolved = await realpath(path, { encoding: "buffer" });
    return Buffer.isBuffer(resolved) ? resolved : Buffer.from(resolved);
  },
  lstat: async (path: Buffer) => lstat(path)
});

function isContained(root: Buffer, candidate: Buffer): boolean {
  if (candidate.equals(root)) return true;
  if (candidate.length <= root.length || !candidate.subarray(0, root.length).equals(root)) {
    return false;
  }
  return root[root.length - 1] === 0x2f || candidate[root.length] === 0x2f;
}

function validateRelativePath(path: Buffer): void {
  if (path.length === 0 || path[0] === 0x2f || path.includes(0)) {
    throw new Error("Git reported an invalid untracked path.");
  }
  for (const segment of path.toString("binary").split("/")) {
    if (segment === "..") {
      throw new Error("Git reported an untracked path outside the repository root.");
    }
  }
}

export async function untrackedMetadataForPathBytes(
  repositoryRoot: string,
  paths: readonly Buffer[],
  filesystem: GitFilesystemAdapter = defaultFilesystem
): Promise<UntrackedFileMetadata[]> {
  const rootBytes = Buffer.from(repositoryRoot, "utf8");
  const canonicalRoot = await filesystem.realpath(rootBytes);
  const results: UntrackedFileMetadata[] = [];
  for (const path of paths) {
    validateRelativePath(path);
    const separator = rootBytes[rootBytes.length - 1] === 0x2f ? Buffer.alloc(0) : Buffer.from("/");
    const absolutePath = Buffer.concat([rootBytes, separator, path]);
    const lastSeparator = path.lastIndexOf(0x2f);
    const parentPath = lastSeparator < 0
      ? rootBytes
      : Buffer.concat([rootBytes, separator, path.subarray(0, lastSeparator)]);
    const canonicalParent = await filesystem.realpath(parentPath);
    if (!isContained(canonicalRoot, canonicalParent)) {
      throw new Error("Untracked path parent escapes the repository root.");
    }
    const metadata = await filesystem.lstat(absolutePath);
    const type = metadata.isSymbolicLink()
      ? "symlink"
      : metadata.isFile()
        ? "file"
        : metadata.isDirectory() ? "directory" : "other";
    results.push(Object.freeze({ path: displayGitPath(path), type, size: metadata.size }));
  }
  return results;
}

async function captureStatus(
  repositoryRoot: string,
  options: GitCaptureOptions
): Promise<GitStatusCapture> {
  const raw = (
    await runGitBytes(
      repositoryRoot,
      ["status", "--porcelain=v2", "--untracked-files=all", "-z"],
      options
    )
  ).stdout;
  return parseStatus(raw);
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
  const initialStatus = await captureStatus(repositoryRoot, options);
  if (initialStatus.recordCount > 0) {
    throw new Error("AgentLens record requires a clean Git repository before child spawn.");
  }
  return Object.freeze({
    repositoryRoot,
    initialHead,
    initialBranch,
    initialStatus: initialStatus.display
  });
}

export async function captureGitAfter(
  before: GitBeforeEvidence,
  options: GitCaptureOptions = {}
): Promise<GitAfterEvidence> {
  const finalHead = (await runGit(before.repositoryRoot, ["rev-parse", "HEAD"], options)).stdout.trimEnd();
  const finalBranch = await branch(before.repositoryRoot, options);
  const finalStatus = await captureStatus(before.repositoryRoot, options);
  const trackedFinalDiff = safeTrackedDiff((
    await runGitBytes(
      before.repositoryRoot,
      ["diff", "--binary", "--no-ext-diff", "--no-textconv", before.initialHead, "--"],
      options
    )
  ).stdout);
  const diffCheckResult = await runGitBytes(
    before.repositoryRoot,
    ["diff", "--check", before.initialHead, "--"],
    options,
    [0, 2]
  );
  const diffCheckOutput = safeDiffCheckOutput(
    Buffer.concat([diffCheckResult.stdout, diffCheckResult.stderr]),
    trackedFinalDiff.paths
  );
  return Object.freeze({
    finalHead,
    finalBranch,
    finalStatus: finalStatus.display,
    trackedFinalDiff: trackedFinalDiff.display,
    diffCheck: Object.freeze({ passed: diffCheckResult.exitCode === 0, output: diffCheckOutput }),
    untrackedMetadata: Object.freeze(
      await untrackedMetadataForPathBytes(before.repositoryRoot, finalStatus.untrackedPaths)
    ),
    headChanged: finalHead !== before.initialHead,
    branchChanged: finalBranch !== before.initialBranch
  });
}
