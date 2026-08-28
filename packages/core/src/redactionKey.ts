import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";

const KEY_BYTES = 32;
const READ_ATTEMPTS = 20;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function pathError(path: string): Error {
  return new Error(`AgentLens secret path cannot be a symbolic link or invalid file: ${path}`);
}

async function ensureSecretsDirectory(path: string): Promise<void> {
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing === undefined) {
    await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  const directoryStat = await lstat(path);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw pathError(path);

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error) && error.code === "ELOOP") throw pathError(path);
    throw error;
  }
  try {
    if (!(await handle.stat()).isDirectory()) throw pathError(path);
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

async function readCompleteKey(keyPath: string): Promise<Buffer> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    let handle;
    try {
      handle = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isNodeError(error) && error.code === "ELOOP") throw pathError(keyPath);
      throw error;
    }
    try {
      if (!(await handle.stat()).isFile()) throw pathError(keyPath);
      const key = await handle.readFile();
      if (key.byteLength === KEY_BYTES) {
        await handle.chmod(0o600);
        return key;
      }
    } finally {
      await handle.close();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Invalid AgentLens redaction key length at ${keyPath}; expected ${KEY_BYTES} bytes.`);
}

export async function loadOrCreateRedactionKey(dataRoot: string): Promise<Buffer> {
  const secretsDirectory = join(dataRoot, "secrets");
  const keyPath = join(secretsDirectory, "redaction-hmac.key");

  await ensureSecretsDirectory(secretsDirectory);

  const existingKey = await lstat(keyPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existingKey?.isSymbolicLink() || (existingKey !== undefined && !existingKey.isFile())) {
    throw pathError(keyPath);
  }

  const candidate = randomBytes(KEY_BYTES);
  let handle;

  try {
    handle = await open(
      keyPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(candidate);
    await handle.sync();
    await handle.chmod(0o600);
    await handle.close();
    handle = undefined;
    return candidate;
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }

  const key = await readCompleteKey(keyPath);
  return key;
}
