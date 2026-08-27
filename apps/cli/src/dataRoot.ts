import { chmod, mkdir, open } from "node:fs/promises";
import { join } from "node:path";

export async function ownerOnlyDatabaseFiles(databasePath: string): Promise<void> {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    await chmod(path, 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function prepareDataRoot(dataRoot: string): Promise<string> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await chmod(dataRoot, 0o700);
  const databasePath = join(dataRoot, "agentlens.sqlite");
  const databaseFile = await open(databasePath, "a", 0o600);
  await databaseFile.close();
  await ownerOnlyDatabaseFiles(databasePath);
  return databasePath;
}
