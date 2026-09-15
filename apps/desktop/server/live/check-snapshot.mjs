import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  lstat,
  readFile,
  writeFile,
  realpath,
  chmod,
} from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = async (cwd, args) =>
  (
    await exec(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
      {
        cwd,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      },
    )
  ).stdout;
const files = async (root) =>
  [
    ...new Set(
      (
        await git(root, [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
        ])
      )
        .split("\0")
        .filter(
          (path) =>
            path &&
            !path
              .split("/")
              .some((part) =>
                ["node_modules", ".pnpm-store", ".venv"].includes(part),
              ),
        ),
    ),
  ].sort();
async function content(root, path) {
  const parts = path.split("/");
  if (isAbsolute(path) || parts.some((p) => !p || p === ".." || p === ".git"))
    throw Error("check_snapshot_unsupported");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error("check_snapshot_unsupported");
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  const stat = await lstat(current);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
    throw Error("check_snapshot_unsupported");
  const bytes = await readFile(current);
  if (bytes.length > 16 * 1024 * 1024)
    throw Error("check_snapshot_unsupported");
  return { bytes, mode: stat.mode & 0o111 ? 0o755 : 0o644 };
}
export async function snapshotAttempt(source, destination, signal) {
  source = await realpath(source);
  const rel = relative(source, destination);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw Error("check_snapshot_unsupported");
  const paths = await files(source);
  if (paths.length > 10000) throw Error("check_snapshot_unsupported");
  const head = (await git(source, ["rev-parse", "HEAD"])).trim();
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const manifest = [];
  let total = 0;
  for (const path of paths) {
    if (signal?.aborted) throw Error("check_cancelled");
    const item = await content(source, path);
    if (!item) {
      manifest.push([path, "deleted"]);
      continue;
    }
    total += item.bytes.length;
    if (total > 64 * 1024 * 1024) throw Error("check_snapshot_unsupported");
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, item.bytes, { flag: "wx", mode: item.mode });
    await chmod(target, item.mode);
    manifest.push([path, sha(item.bytes), item.mode]);
  }
  // Refuse a mixed snapshot if the original changes while it is being copied.
  if (
    head !== (await git(source, ["rev-parse", "HEAD"])).trim() ||
    JSON.stringify(paths) !== JSON.stringify(await files(source))
  )
    throw Error("check_snapshot_changed");
  for (const [path, hash, mode] of manifest) {
    if (signal?.aborted) throw Error("check_cancelled");
    const item = await content(source, path);
    if (
      (item ? sha(item.bytes) : "deleted") !== hash ||
      (item && item.mode !== mode)
    )
      throw Error("check_snapshot_changed");
  }
  return {
    hash: sha(JSON.stringify({ head, files: manifest })),
    head,
    files: manifest,
    bytes: total,
  };
}
