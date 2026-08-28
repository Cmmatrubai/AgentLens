import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rename as fsRename,
  unlink as fsUnlink
} from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import type { NativePayloadRefV1 } from "./events.js";
import {
  RedactedBytes,
  type ImmutableJsonValue,
  type RedactedJsonResult,
  type RedactionResult
} from "./redaction.js";

const INLINE_NATIVE_BYTES = 32 * 1024;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const TRUNCATION_MARKER = Buffer.from("\n[[TRUNCATED:artifact:max-bytes:10485760]]\n", "utf8");
const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type Rename = (oldPath: string, newPath: string) => Promise<void>;
type Unlink = (path: string) => Promise<void>;

export interface ArtifactStoreOptions {
  readonly rename?: Rename;
  readonly unlink?: Unlink;
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

type NativePayloadCompatible<T extends NativePayloadRefV1> = T;

export type PreparedNativePayloadRefV1 = NativePayloadCompatible<
  | Readonly<{ storage: "inline"; redacted: ImmutableJsonValue }>
  | Readonly<{ storage: "artifact"; artifactId: string }>
  | Readonly<{ storage: "omitted"; reason: string }>
>;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function artifactPathError(path: string): Error {
  return new Error(`AgentLens artifact path cannot be a symbolic link or invalid file: ${path}`);
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function jsonPreviewEnvelope(
  sourceText: string,
  originalByteLength: number,
  previewLength: number
): Buffer {
  let safePreviewLength = previewLength;
  const finalCodeUnit = sourceText.charCodeAt(safePreviewLength - 1);
  const nextCodeUnit = sourceText.charCodeAt(safePreviewLength);
  if (
    finalCodeUnit >= 0xd800 &&
    finalCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  ) {
    safePreviewLength -= 1;
  }

  return Buffer.from(
    JSON.stringify({
      $agentlens: {
        kind: "truncated-json-artifact",
        reason: "artifact-max-bytes",
        truncated: true,
        maxByteLength: MAX_ARTIFACT_BYTES,
        originalByteLength
      },
      preview: sourceText.slice(0, safePreviewLength)
    }),
    "utf8"
  );
}

function validatedJsonText(source: Buffer): string {
  try {
    const sourceText = UTF8_DECODER.decode(source);
    JSON.parse(sourceText);
    return sourceText;
  } catch (cause) {
    throw new TypeError("application/json artifacts require valid UTF-8 JSON.", { cause });
  }
}

function cappedJsonArtifact(sourceText: string, originalByteLength: number): Buffer {
  let lower = 0;
  let upper = sourceText.length;
  let best = jsonPreviewEnvelope(sourceText, originalByteLength, 0);
  while (lower <= upper) {
    const candidateLength = Math.floor((lower + upper) / 2);
    const candidate = jsonPreviewEnvelope(sourceText, originalByteLength, candidateLength);
    if (candidate.byteLength <= MAX_ARTIFACT_BYTES) {
      best = candidate;
      lower = candidateLength + 1;
    } else {
      upper = candidateLength - 1;
    }
  }
  return best;
}

function cappedArtifactBytes(redactedBytes: RedactedBytes, mediaType: string): {
  bytes: Buffer;
  truncated: boolean;
  originalByteLength: number;
} {
  const source = redactedBytes.copy();
  const jsonSourceText = isJsonMediaType(mediaType) ? validatedJsonText(source) : undefined;
  if (source.byteLength <= MAX_ARTIFACT_BYTES) {
    return { bytes: source, truncated: false, originalByteLength: source.byteLength };
  }

  if (jsonSourceText !== undefined) {
    return {
      bytes: cappedJsonArtifact(jsonSourceText, source.byteLength),
      truncated: true,
      originalByteLength: source.byteLength
    };
  }

  const retainedLength = MAX_ARTIFACT_BYTES - TRUNCATION_MARKER.byteLength;
  return {
    bytes: Buffer.concat([source.subarray(0, retainedLength), TRUNCATION_MARKER]),
    truncated: true,
    originalByteLength: source.byteLength
  };
}

async function ensureOwnerOnlyDirectory(path: string): Promise<void> {
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing === undefined) {
    await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  const pathStat = await lstat(path);
  if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) throw artifactPathError(path);

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error) && error.code === "ELOOP") throw artifactPathError(path);
    throw error;
  }
  try {
    if (!(await handle.stat()).isDirectory()) throw artifactPathError(path);
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isDirectory()) throw artifactPathError(path);
    try {
      await handle.sync();
    } catch (error) {
      if (!isNodeError(error) || !error.code || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(error.code)) {
        throw error;
      }
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ELOOP") throw artifactPathError(path);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function validateArtifactFile(
  path: string,
  expectedBytes: Buffer,
  expectedDigest: string
): Promise<void> {
  const pathStat = await lstat(path);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) throw artifactPathError(path);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error) && error.code === "ELOOP") throw artifactPathError(path);
    throw error;
  }
  try {
    const handleStat = await handle.stat();
    if (
      !handleStat.isFile() ||
      handleStat.dev !== pathStat.dev ||
      handleStat.ino !== pathStat.ino ||
      handleStat.size !== expectedBytes.byteLength
    ) throw new Error(`Completed artifact validation failed for ${path}.`);
    const digest = createHash("sha256").update(await handle.readFile()).digest("hex");
    if (digest !== expectedDigest) throw new Error(`Completed artifact digest validation failed for ${path}.`);
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export function redactedTextBytes(result: RedactionResult): RedactedBytes {
  return RedactedBytes.fromText(result);
}

function immutableJsonSnapshot(value: unknown): ImmutableJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(immutableJsonSnapshot));
  if (typeof value === "object") {
    const snapshot: Record<string, ImmutableJsonValue> = Object.create(null);
    for (const [key, entry] of Object.entries(value)) snapshot[key] = immutableJsonSnapshot(entry);
    return Object.freeze(snapshot);
  }
  throw new TypeError("Redacted native payload bytes must decode to JSON.");
}

export class ArtifactStore {
  readonly #dataRoot: string;
  readonly #rename: Rename;
  readonly #unlink: Unlink;

  constructor(dataRoot: string, options: ArtifactStoreOptions = {}) {
    this.#dataRoot = dataRoot;
    this.#rename = options.rename ?? fsRename;
    this.#unlink = options.unlink ?? fsUnlink;
  }

  pathForArtifactId(artifactId: string): string {
    if (!/^[0-9a-f]{64}$/.test(artifactId)) throw new Error("Artifact ID must be a SHA-256 hex digest.");
    return join(this.#dataRoot, "artifacts", "sha256", artifactId.slice(0, 2), artifactId);
  }

  async writeRedacted(input: WriteRedactedArtifact): Promise<CompletedArtifact> {
    const capped = cappedArtifactBytes(input.redactedBytes, input.mediaType);
    const sha256 = createHash("sha256").update(capped.bytes).digest("hex");
    const artifactRoot = join(this.#dataRoot, "artifacts");
    const tempDirectory = join(artifactRoot, "tmp");
    const hashDirectory = join(artifactRoot, "sha256");
    const finalDirectory = join(hashDirectory, sha256.slice(0, 2));
    const finalPath = this.pathForArtifactId(sha256);
    const tempPath = join(tempDirectory, `${sha256}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);

    await ensureOwnerOnlyDirectory(artifactRoot);
    await ensureOwnerOnlyDirectory(tempDirectory);
    await ensureOwnerOnlyDirectory(hashDirectory);
    await ensureOwnerOnlyDirectory(finalDirectory);

    const existingFinal = await lstat(finalPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existingFinal !== undefined) {
      if (existingFinal.isSymbolicLink()) throw artifactPathError(finalPath);
      await validateArtifactFile(finalPath, capped.bytes, sha256);
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
    }

    let handle;
    let tempCreated = false;
    let renamed = false;
    try {
      handle = await open(
        tempPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      tempCreated = true;
      await handle.writeFile(capped.bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#rename(tempPath, finalPath);
      renamed = true;
      await validateArtifactFile(finalPath, capped.bytes, sha256);
      await fsyncDirectory(finalDirectory);

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
      const cleanupFailures: unknown[] = [];
      if (handle) {
        try {
          await handle.close();
        } catch (cleanupFailure) {
          cleanupFailures.push(cleanupFailure);
        }
      }
      if (tempCreated && !renamed) {
        try {
          await this.#unlink(tempPath);
        } catch (cleanupFailure) {
          cleanupFailures.push(cleanupFailure);
        }
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          "Artifact write failed and temporary-file cleanup also failed.",
          { cause: error }
        );
      }
      throw error;
    }
  }
}

export async function prepareNativePayload(
  redactedJson: RedactedJsonResult,
  artifactStore: ArtifactStore
): Promise<PreparedNativePayloadRefV1> {
  if (redactedJson.storage === "omitted") {
    return Object.freeze({ storage: "omitted" as const, reason: redactedJson.reason });
  }

  if (redactedJson.redactedBytes.byteLength <= INLINE_NATIVE_BYTES) {
    const snapshot = immutableJsonSnapshot(
      JSON.parse(redactedJson.redactedBytes.copy().toString("utf8")) as unknown
    );
    return Object.freeze({ storage: "inline" as const, redacted: snapshot });
  }

  const artifact = await artifactStore.writeRedacted({
    runId: redactedJson.runId,
    kind: "native-payload",
    redactedBytes: redactedJson.redactedBytes,
    mediaType: "application/json"
  });
  return Object.freeze({ storage: "artifact" as const, artifactId: artifact.id });
}
