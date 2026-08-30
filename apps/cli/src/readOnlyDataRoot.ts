import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";

interface ReadOnlyDataRootPaths {
  readonly dataRoot: string;
  readonly databasePath: string;
}

export type LocatedReadOnlyDataRoot =
  | (ReadOnlyDataRootPaths & Readonly<{ state: "missing" }>)
  | (ReadOnlyDataRootPaths & Readonly<{ state: "existing" }>);

function locationError(kind: "data root" | "database", path: string): Error {
  return new Error(
    `Read-only AgentLens ${kind} must be an existing non-symbolic ${
      kind === "data root" ? "directory" : "regular file"
    }: ${path}`
  );
}

async function validatePath(
  path: string,
  kind: "data root" | "database"
): Promise<boolean> {
  const expectedDirectory = kind === "data root";
  let pathStat;
  try {
    pathStat = await lstat(path);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw new Error(locationError(kind, path).message, { cause });
  }
  if (
    pathStat.isSymbolicLink() ||
    (expectedDirectory ? !pathStat.isDirectory() : !pathStat.isFile())
  ) {
    throw locationError(kind, path);
  }

  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        (expectedDirectory ? constants.O_DIRECTORY : 0)
    );
  } catch (cause) {
    throw new Error(locationError(kind, path).message, { cause });
  }
  try {
    const handleStat = await handle.stat();
    if (
      (expectedDirectory ? !handleStat.isDirectory() : !handleStat.isFile()) ||
      handleStat.dev !== pathStat.dev ||
      handleStat.ino !== pathStat.ino
    ) {
      throw locationError(kind, path);
    }
  } finally {
    await handle.close();
  }
  return true;
}

export async function locateReadOnlyDataRoot(
  requestedDataRoot: string
): Promise<LocatedReadOnlyDataRoot> {
  const dataRoot = resolve(requestedDataRoot);
  const databasePath = join(dataRoot, "agentlens.sqlite");
  if (!await validatePath(dataRoot, "data root")) {
    return { state: "missing", dataRoot, databasePath };
  }
  if (!await validatePath(databasePath, "database")) {
    return { state: "missing", dataRoot, databasePath };
  }
  return { state: "existing", dataRoot, databasePath };
}
