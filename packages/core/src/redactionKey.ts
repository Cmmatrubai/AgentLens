import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

const KEY_BYTES = 32;
const READ_ATTEMPTS = 20;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readCompleteKey(keyPath: string): Promise<Buffer> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    const key = await readFile(keyPath);
    if (key.byteLength === KEY_BYTES) return key;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Invalid AgentLens redaction key length at ${keyPath}; expected ${KEY_BYTES} bytes.`);
}

export async function loadOrCreateRedactionKey(dataRoot: string): Promise<Buffer> {
  const secretsDirectory = join(dataRoot, "secrets");
  const keyPath = join(secretsDirectory, "redaction-hmac.key");

  await mkdir(secretsDirectory, { recursive: true, mode: 0o700 });
  await chmod(secretsDirectory, 0o700);

  const candidate = randomBytes(KEY_BYTES);
  let handle;

  try {
    handle = await open(keyPath, "wx", 0o600);
    await handle.writeFile(candidate);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(keyPath, 0o600);
    return candidate;
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }

  const key = await readCompleteKey(keyPath);
  await chmod(keyPath, 0o600);
  return key;
}
