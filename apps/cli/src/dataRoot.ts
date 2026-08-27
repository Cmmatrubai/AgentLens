import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";

function pathError(path: string): Error {
  return new Error(`AgentLens storage path cannot be a symbolic link or non-regular file: ${path}`);
}

async function ownerOnlyRegularFile(path: string, create: boolean): Promise<void> {
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing?.isSymbolicLink() || (existing !== undefined && !existing.isFile())) {
    throw pathError(path);
  }
  if (!create && existing === undefined) return;

  const flags = constants.O_NOFOLLOW | constants.O_RDONLY | (create ? constants.O_CREAT : 0);
  let handle;
  try {
    handle = await open(path, flags, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw pathError(path);
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) throw pathError(path);
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export async function ownerOnlyDatabaseFiles(databasePath: string): Promise<void> {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    await ownerOnlyRegularFile(path, false);
  }
}

export async function prepareDataRoot(dataRoot: string): Promise<string> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(dataRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw pathError(dataRoot);
  let rootHandle;
  try {
    rootHandle = await open(
      dataRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw pathError(dataRoot);
    throw error;
  }
  try {
    if (!(await rootHandle.stat()).isDirectory()) throw pathError(dataRoot);
    await rootHandle.chmod(0o700);
  } finally {
    await rootHandle.close();
  }
  const databasePath = join(dataRoot, "agentlens.sqlite");
  await ownerOnlyRegularFile(databasePath, true);
  await ownerOnlyDatabaseFiles(databasePath);
  return databasePath;
}
