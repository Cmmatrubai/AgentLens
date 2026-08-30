import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { StoredArtifact } from "@agentlens/storage";

export interface ArtifactReadRequirements {
  readonly expectedKind: string;
  readonly expectedMediaType: string;
  readonly requireComplete: boolean;
}

export interface ValidatedArtifactRead {
  readonly bytes: Buffer;
  readonly truncated: boolean;
  readonly storedByteLength: number;
  readonly originalByteLength: number;
}

function artifactError(reason: string, cause?: unknown): Error {
  return cause === undefined
    ? new Error(`Artifact validation failed (${reason}).`)
    : new Error(`Artifact validation failed (${reason}).`, { cause });
}

export async function readValidatedArtifact(
  artifact: StoredArtifact,
  artifactRoot: string,
  requirements: ArtifactReadRequirements
): Promise<ValidatedArtifactRead> {
  if (
    !/^[0-9a-f]{64}$/.test(artifact.id) ||
    artifact.sha256 !== artifact.id ||
    artifact.redactionState !== "redacted" ||
    !Number.isInteger(artifact.byteLength) ||
    artifact.byteLength < 0 ||
    !Number.isInteger(artifact.originalByteLength) ||
    artifact.originalByteLength < 0 ||
    (artifact.truncated
      ? artifact.originalByteLength <= artifact.byteLength
      : artifact.originalByteLength !== artifact.byteLength)
  ) throw artifactError("invalid_metadata");
  if (artifact.kind !== requirements.expectedKind) throw artifactError("kind_mismatch");
  if (artifact.mediaType !== requirements.expectedMediaType) {
    throw artifactError("media_type_mismatch");
  }
  if (requirements.requireComplete && artifact.truncated) {
    throw artifactError("truncated_content");
  }

  const configuredRoot = resolve(artifactRoot);
  const bucketPath = join(configuredRoot, artifact.id.slice(0, 2));
  const expectedPath = join(bucketPath, artifact.id);
  if (artifact.path !== expectedPath || resolve(artifact.path) !== expectedPath) {
    throw artifactError("canonical_path");
  }

  let pathStat;
  try {
    pathStat = await lstat(expectedPath);
  } catch (cause) {
    throw artifactError("unavailable", cause);
  }
  if (pathStat.isSymbolicLink()) throw artifactError("symbolic_path");
  if (!pathStat.isFile()) throw artifactError("non_regular_file");

  try {
    const [rootStat, bucketStat, canonicalRoot, canonicalBucket, canonicalPath] = await Promise.all([
      lstat(configuredRoot),
      lstat(bucketPath),
      realpath(configuredRoot),
      realpath(bucketPath),
      realpath(expectedPath)
    ]);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      bucketStat.isSymbolicLink() ||
      !bucketStat.isDirectory() ||
      canonicalBucket !== join(canonicalRoot, artifact.id.slice(0, 2)) ||
      canonicalPath !== join(canonicalBucket, artifact.id)
    ) throw artifactError("canonical_path");
  } catch (cause) {
    if (cause instanceof Error && /Artifact validation failed/.test(cause.message)) throw cause;
    throw artifactError("canonical_path", cause);
  }

  let handle;
  try {
    handle = await open(expectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (cause) {
    throw artifactError("no_follow_open", cause);
  }
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== pathStat.dev ||
      stat.ino !== pathStat.ino
    ) throw artifactError("file_identity");
    if (stat.size !== artifact.byteLength) throw artifactError("byte_length");
    const bytes = await handle.readFile();
    if (bytes.byteLength !== artifact.byteLength) throw artifactError("byte_length");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== artifact.id) throw artifactError("digest");
    return Object.freeze({
      bytes,
      truncated: artifact.truncated,
      storedByteLength: artifact.byteLength,
      originalByteLength: artifact.originalByteLength
    });
  } finally {
    await handle.close();
  }
}
