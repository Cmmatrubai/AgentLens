import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { CompletedArtifact } from "@agentlens/core";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import { RunRepository } from "../src/runRepository.js";

const temporaryRoots: string[] = [];
const runId = "run-artifact";

function setup(): { root: string; artifactRoot: string; repository: RunRepository; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-artifact-"));
  temporaryRoots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const database = openDatabase(join(root, "agentlens.sqlite"));
  const repository = new RunRepository(database, { artifactRoot });
  repository.createRun({
    id: runId,
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "0.149.0-alpha.4",
    capturePolicy: "standard",
    capturePolicyVersion: "1",
    redactionVersion: "1",
    repositoryFingerprint: "repo-fingerprint",
    repositoryDisplay: "fixture-repository",
    startedAt: 1_777_777_777_000
  });
  return { root, artifactRoot, repository, close: () => database.close() };
}

function completedArtifact(root: string, body = "already redacted artifact"): CompletedArtifact {
  const bytes = Buffer.from(body, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const path = join(root, "artifacts", "sha256", digest.slice(0, 2), digest);
  mkdirSync(join(root, "artifacts", "sha256", digest.slice(0, 2)), { recursive: true, mode: 0o700 });
  return {
    id: digest,
    runId,
    kind: "native-payload",
    mediaType: "application/json",
    path,
    sha256: digest,
    byteLength: bytes.byteLength,
    redactionState: "redacted",
    truncated: false,
    originalByteLength: bytes.byteLength
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("artifact metadata ordering", () => {
  it("commits metadata only after the completed file identity and digest verify", async () => {
    const { root, repository, close } = setup();
    try {
      const artifact = completedArtifact(root);
      writeFileSync(artifact.path, "already redacted artifact", { mode: 0o600 });
      const committed = await repository.commitArtifactMetadata(
        artifact,
        [{ reason: "auth-bearer", count: 1 }],
        1_777_777_777_500
      );
      expect(committed).toMatchObject({
        id: artifact.id,
        path: artifact.path,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength
      });
      expect(basename(committed.path)).toBe(committed.id);
      expect(repository.getRunDetail(runId).artifacts).toEqual([committed]);
      expect(repository.getRunDetail(runId).redactionAudits).toContainEqual({
        eventId: null,
        artifactId: artifact.id,
        reason: "auth-bearer",
        count: 1
      });
    } finally {
      close();
    }
  });

  it("rejects missing, truncated, or digest-mismatched files without inserting a row", async () => {
    const { root, repository, close } = setup();
    try {
      const missing = completedArtifact(root);
      await expect(repository.commitArtifactMetadata(missing)).rejects.toThrow(/artifact/i);
      expect(repository.getRunDetail(runId).artifacts).toEqual([]);

      writeFileSync(missing.path, "wrong bytes", { mode: 0o600 });
      await expect(repository.commitArtifactMetadata(missing)).rejects.toThrow(/byte length|digest/i);
      expect(repository.getRunDetail(runId).artifacts).toEqual([]);
    } finally {
      close();
    }
  });

  it("tolerates an orphan artifact when the database opens and recovery runs", () => {
    const { root, artifactRoot, repository, close } = setup();
    const orphan = join(root, "orphan-redacted-artifact");
    writeFileSync(orphan, "orphan bytes", { mode: 0o600 });
    close();

    const reopened = openDatabase(join(root, "agentlens.sqlite"));
    try {
      const reopenedRepository = new RunRepository(reopened, { artifactRoot });
      expect(reopenedRepository.appendRecoveryForOpenEvents(runId, {
        receivedAt: "2026-08-26T20:03:00.000Z",
        eventIdFor: (openEvent) => `recovery-${openEvent.id}`
      })).toEqual([]);
      expect(reopenedRepository.getRunDetail(runId).artifacts).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("rejects a valid digest outside the configured content-addressed artifact root", async () => {
    const { root, repository, close } = setup();
    try {
      const artifact = completedArtifact(root);
      const outsidePath = join(root, "outside", artifact.id);
      mkdirSync(join(root, "outside"), { recursive: true, mode: 0o700 });
      writeFileSync(outsidePath, "already redacted artifact", { mode: 0o600 });
      await expect(repository.commitArtifactMetadata({ ...artifact, path: outsidePath })).rejects.toThrow(
        /artifact root|content-addressed layout|outside/i
      );
      expect(repository.getRunDetail(runId).artifacts).toEqual([]);
    } finally {
      close();
    }
  });

  it("rejects symlinks and traversal aliases even when bytes and digest match", async () => {
    const { root, repository, close } = setup();
    try {
      const artifact = completedArtifact(root);
      const target = join(root, "outside-target");
      writeFileSync(target, "already redacted artifact", { mode: 0o600 });
      symlinkSync(target, artifact.path);
      await expect(repository.commitArtifactMetadata(artifact)).rejects.toThrow(/symbolic|symlink/i);
      expect(repository.getRunDetail(runId).artifacts).toEqual([]);
    } finally {
      close();
    }

    const second = setup();
    try {
      const artifact = completedArtifact(second.root);
      writeFileSync(artifact.path, "already redacted artifact", { mode: 0o600 });
      const prefix = artifact.id.slice(0, 2);
      const traversalAlias = `${second.artifactRoot}/${prefix}/../${prefix}/${artifact.id}`;
      await expect(
        second.repository.commitArtifactMetadata({ ...artifact, path: traversalAlias })
      ).rejects.toThrow(/canonical|traversal|layout/i);
      expect(second.repository.getRunDetail(runId).artifacts).toEqual([]);
    } finally {
      second.close();
    }
  });
});
