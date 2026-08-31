import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const maximumManifestBytes = 256 * 1024;
const maximumAssetBytes = 8 * 1024 * 1024;
const noFollowOpenFlag = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;

export interface StaticAsset {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface StaticAssets {
  readonly entryUrl: string;
  read(pathname: string): Promise<StaticAsset | null>;
}

export interface StaticFileHandle {
  stat(): Promise<Stats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<Readonly<{ bytesRead: number }>>;
  close(): Promise<void>;
}

export interface StaticFileAccess {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<StaticFileHandle>;
}

const nodeFileAccess: StaticFileAccess = {
  lstat,
  realpath,
  open: (path, flags) => open(path, flags)
};

function safeAssetPath(value: string): boolean {
  return value.startsWith("assets/")
    && !value.includes("\\")
    && !value.includes("\0")
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

async function hasNoSymlinkComponents(
  root: string,
  candidate: string,
  fileAccess: StaticFileAccess
): Promise<boolean> {
  if (!isContained(root, candidate)) return false;
  const components = relative(root, candidate).split(sep).filter((component) => component !== "");
  let current = root;
  for (const component of components) {
    current = resolve(current, component);
    if ((await fileAccess.lstat(current)).isSymbolicLink()) return false;
  }
  return true;
}

function isSameFile(
  before: Stats,
  after: Stats
): boolean {
  return before.dev === after.dev && before.ino === after.ino;
}

async function readBoundedRegularFile(
  root: string,
  path: string,
  maximumBytes: number,
  fileAccess: StaticFileAccess
): Promise<Buffer | null> {
  if (!isContained(root, path)
    || !(await hasNoSymlinkComponents(root, path, fileAccess))) return null;
  const canonicalPath = await fileAccess.realpath(path);
  if (!isContained(root, canonicalPath)) return null;
  const before = await fileAccess.lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) return null;

  let handle: StaticFileHandle | undefined;
  try {
    handle = await fileAccess.open(path, constants.O_RDONLY | noFollowOpenFlag);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximumBytes || !isSameFile(before, opened)) return null;
    const canonicalAfterOpen = await fileAccess.realpath(path);
    const pathAfterOpen = await fileAccess.lstat(path);
    if (!isContained(root, canonicalAfterOpen)
      || !(await hasNoSymlinkComponents(root, path, fileAccess))
      || pathAfterOpen.isSymbolicLink()
      || pathAfterOpen.size !== opened.size
      || !isSameFile(pathAfterOpen, opened)) {
      return null;
    }

    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > maximumBytes || offset !== opened.size) return null;
    const finalState = await handle.stat();
    if (!finalState.isFile()
      || finalState.size > maximumBytes
      || finalState.size !== opened.size
      || !isSameFile(opened, finalState)) return null;
    return bytes.subarray(0, offset);
  } finally {
    await handle?.close();
  }
}

function collectManifestAssets(manifest: object): Readonly<{
  entry: string;
  allowlist: ReadonlySet<string>;
}> {
  const allowlist = new Set<string>();
  let entry: string | undefined;
  for (const value of Object.values(manifest)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (typeof record.file === "string" && safeAssetPath(record.file)) {
      allowlist.add(record.file);
      if (record.isEntry === true) {
        if (entry !== undefined) throw new Error("AgentLens web manifest has multiple entry modules.");
        entry = record.file;
      }
    }
    for (const key of ["css", "assets"] as const) {
      if (!Array.isArray(record[key])) continue;
      for (const candidate of record[key]) {
        if (typeof candidate === "string" && safeAssetPath(candidate)) allowlist.add(candidate);
      }
    }
  }
  if (entry === undefined) throw new Error("AgentLens web manifest has no entry module.");
  return { entry, allowlist };
}

export async function loadStaticAssets(
  webRoot: string,
  fileAccess: StaticFileAccess = nodeFileAccess
): Promise<StaticAssets> {
  const canonicalRoot = await fileAccess.realpath(webRoot);
  const manifestPath = resolve(canonicalRoot, ".vite", "manifest.json");
  const manifestBytes = await readBoundedRegularFile(
    canonicalRoot,
    manifestPath,
    maximumManifestBytes,
    fileAccess
  );
  if (manifestBytes === null) throw new Error("AgentLens web manifest is unavailable.");
  const parsed = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AgentLens web manifest is invalid.");
  }
  const { entry, allowlist } = collectManifestAssets(parsed);

  return {
    entryUrl: `/${entry}`,
    async read(pathname) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        return null;
      }
      const candidate = decoded.startsWith("/") ? decoded.slice(1) : decoded;
      if (!allowlist.has(candidate) || !safeAssetPath(candidate)) return null;
      const unresolved = resolve(canonicalRoot, candidate);
      try {
        const bytes = await readBoundedRegularFile(
          canonicalRoot,
          unresolved,
          maximumAssetBytes,
          fileAccess
        );
        return bytes === null ? null : { bytes, contentType: contentType(unresolved) };
      } catch {
        return null;
      }
    }
  };
}
