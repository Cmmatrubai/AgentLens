import { createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  rename as fsRename,
  stat,
  unlink
} from "node:fs/promises";
import { join } from "node:path";
import type { NativePayloadRefV1 } from "./events.js";
import {
  RedactedBytes,
  type RedactedJsonResult,
  type RedactionResult
} from "./redaction.js";

const INLINE_NATIVE_BYTES = 32 * 1024;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const TRUNCATION_MARKER = Buffer.from("\n[[TRUNCATED:artifact:max-bytes:10485760]]\n", "utf8");
const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP"]);

type Rename = (oldPath: string, newPath: string) => Promise<void>;

export interface ArtifactStoreOptions {
  rename?: Rename;
}

export interface WriteRedactedArtifact {
  runId: string;
  kind: string;
  redactedBytes: RedactedBytes;
  mediaType: string;
}

export interface CompletedArtifact {
  id: string;
  runId: string;
  kind: string;
  mediaType: string;
  path: string;
  sha256: string;
  byteLength: number;
  redactionState: "redacted";
  truncated: boolean;
  originalByteLength: number;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function cappedArtifactBytes(redactedBytes: RedactedBytes): {
  bytes: Buffer;
  truncated: boolean;
  originalByteLength: number;
} {
  const source = redactedBytes.copy();
  if (source.byteLength <= MAX_ARTIFACT_BYTES) {
    return { bytes: source, truncated: false, originalByteLength: source.byteLength };
  }

  const retainedLength = MAX_ARTIFACT_BYTES - TRUNCATION_MARKER.byteLength;
  return {
    bytes: Buffer.concat([source.subarray(0, retainedLength), TRUNCATION_MARKER]),
    truncated: true,
    originalByteLength: source.byteLength
  };
}

async function ensureOwnerOnlyDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function fsyncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!isNodeError(error) || !error.code || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(error.code)) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

export function redactedTextBytes(result: RedactionResult): RedactedBytes {
  return RedactedBytes.fromText(result);
}

export class ArtifactStore {
  readonly #dataRoot: string;
  readonly #rename: Rename;

  constructor(dataRoot: string, options: ArtifactStoreOptions = {}) {
    this.#dataRoot = dataRoot;
    this.#rename = options.rename ?? fsRename;
  }

  pathForArtifactId(artifactId: string): string {
    if (!/^[0-9a-f]{64}$/.test(artifactId)) throw new Error("Artifact ID must be a SHA-256 hex digest.");
    return join(this.#dataRoot, "artifacts", "sha256", artifactId.slice(0, 2), artifactId);
  }

  async writeRedacted(input: WriteRedactedArtifact): Promise<CompletedArtifact> {
    const capped = cappedArtifactBytes(input.redactedBytes);
    const sha256 = createHash("sha256").update(capped.bytes).digest("hex");
    const artifactRoot = join(this.#dataRoot, "artifacts");
    const tempDirectory = join(artifactRoot, "tmp");
    const finalDirectory = join(artifactRoot, "sha256", sha256.slice(0, 2));
    const finalPath = this.pathForArtifactId(sha256);
    const tempPath = join(tempDirectory, `${sha256}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);

    await ensureOwnerOnlyDirectory(tempDirectory);
    await ensureOwnerOnlyDirectory(finalDirectory);

    let handle;
    let renamed = false;
    try {
      handle = await open(tempPath, "wx", 0o600);
      await handle.writeFile(capped.bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#rename(tempPath, finalPath);
      renamed = true;
      await chmod(finalPath, 0o600);
      await fsyncDirectory(finalDirectory);
      await access(finalPath);
      const finalStat = await stat(finalPath);
      if (!finalStat.isFile() || finalStat.size !== capped.bytes.byteLength) {
        throw new Error(`Completed artifact validation failed for ${finalPath}.`);
      }

      return {
        id: sha256,
        runId: input.runId,
        kind: input.kind,
        mediaType: input.mediaType,
        path: finalPath,
        sha256,
        byteLength: capped.bytes.byteLength,
        redactionState: "redacted",
        truncated: capped.truncated,
        originalByteLength: capped.originalByteLength
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!renamed) await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
}

export async function prepareNativePayload(
  redactedJson: RedactedJsonResult,
  artifactStore: ArtifactStore
): Promise<NativePayloadRefV1> {
  if (redactedJson.storage === "omitted") {
    return { storage: "omitted", reason: redactedJson.reason };
  }

  if (redactedJson.redactedBytes.byteLength <= INLINE_NATIVE_BYTES) {
    return { storage: "inline", redacted: redactedJson.redacted };
  }

  const artifact = await artifactStore.writeRedacted({
    runId: redactedJson.runId,
    kind: "native-payload",
    redactedBytes: redactedJson.redactedBytes,
    mediaType: "application/json"
  });
  return { storage: "artifact", artifactId: artifact.id };
}
