import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const maximumManifestBytes = 256 * 1024;
const maximumAssetBytes = 8 * 1024 * 1024;

export interface StaticAsset {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface StaticAssets {
  readonly entryUrl: string;
  read(pathname: string): Promise<StaticAsset | null>;
}

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

export async function loadStaticAssets(webRoot: string): Promise<StaticAssets> {
  const canonicalRoot = await realpath(webRoot);
  const manifestPath = resolve(canonicalRoot, ".vite", "manifest.json");
  const manifestInfo = await lstat(manifestPath);
  const canonicalManifestPath = await realpath(manifestPath);
  if (!isContained(canonicalRoot, canonicalManifestPath)
    || !manifestInfo.isFile()
    || manifestInfo.isSymbolicLink()
    || manifestInfo.size > maximumManifestBytes) {
    throw new Error("AgentLens web manifest is unavailable.");
  }
  const parsed = JSON.parse(await readFile(canonicalManifestPath, "utf8")) as unknown;
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
      if (!isContained(canonicalRoot, unresolved)) return null;
      let canonicalPath: string;
      try {
        canonicalPath = await realpath(unresolved);
      } catch {
        return null;
      }
      if (!isContained(canonicalRoot, canonicalPath)) return null;
      const info = await lstat(canonicalPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maximumAssetBytes) return null;
      return { bytes: await readFile(canonicalPath), contentType: contentType(canonicalPath) };
    }
  };
}
