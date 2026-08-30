import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ReadOnlyDatabaseError } from "@agentlens/storage";

interface ReadOnlyDataRootPaths {
  readonly dataRoot: string;
  readonly databasePath: string;
}

export type LocatedReadOnlyDataRoot =
  | (ReadOnlyDataRootPaths & Readonly<{ state: "missing" }>)
  | (ReadOnlyDataRootPaths & Readonly<{ state: "existing" }>);

type LocatedPathKind = "data root" | "database" | "WAL sidecar" | "SHM sidecar";

function locationError(kind: LocatedPathKind, path: string): Error {
  const expectedDirectory = kind === "data root";
  return new Error(
    `Read-only AgentLens ${kind} must be an existing non-symbolic ${
      expectedDirectory ? "directory" : "regular file"
    }: ${path}`
  );
}

async function validatePath(
  path: string,
  kind: LocatedPathKind
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
  const databaseExists = await validatePath(databasePath, "database");
  const walExists = await validatePath(`${databasePath}-wal`, "WAL sidecar");
  await validatePath(`${databasePath}-shm`, "SHM sidecar");
  if (walExists) throw new ReadOnlyDatabaseError("wal_present");
  if (!databaseExists) {
    return { state: "missing", dataRoot, databasePath };
  }
  return { state: "existing", dataRoot, databasePath };
}
