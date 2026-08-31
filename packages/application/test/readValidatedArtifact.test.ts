import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readValidatedArtifact } from "@agentlens/application";
import type { StoredArtifact } from "@agentlens/storage";

const roots: string[] = [];

async function artifactFixture(
  bytes = Buffer.from('{"fixture":true}', "utf8"),
  overrides: Partial<StoredArtifact> = {}
): Promise<{ root: string; artifactRoot: string; artifact: StoredArtifact }> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-application-artifact-"));
  roots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  const id = createHash("sha256").update(bytes).digest("hex");
  const path = join(artifactRoot, id.slice(0, 2), id);
  await mkdir(join(artifactRoot, id.slice(0, 2)), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  return {
    root,
    artifactRoot,
    artifact: {
      id,
      runId: "artifact-run",
      kind: "native-payload",
      mediaType: "application/json",
      path,
      sha256: id,
      byteLength: bytes.byteLength,
      redactionState: "redacted",
      truncated: false,
      originalByteLength: bytes.byteLength,
      createdAt: 1,
      ...overrides
    }
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readValidatedArtifact", () => {
  it("returns bytes only after validating the canonical complete artifact boundary", async () => {
    const fixture = await artifactFixture();

    await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: true
    })).resolves.toEqual({
      bytes: Buffer.from('{"fixture":true}', "utf8"),
      truncated: false,
      storedByteLength: 16,
      originalByteLength: 16
    });
  });

  it.each([
    ["id", { id: "not-a-digest" }, /invalid_metadata/],
    ["sha", { sha256: "0".repeat(64) }, /invalid_metadata/],
    ["kind", { kind: "assessment-note" }, /kind_mismatch/],
    ["media", { mediaType: "text/plain" }, /media_type_mismatch/],
    ["redaction", { redactionState: "unredacted" as never }, /invalid_metadata/],
    ["stored length", { byteLength: 15 }, /invalid_metadata/],
    ["complete length", { originalByteLength: 17 }, /invalid_metadata/],
    ["negative length", { byteLength: -1 }, /invalid_metadata/],
    ["fractional length", { originalByteLength: 16.5 }, /invalid_metadata/],
    ["truncated length", { truncated: true, originalByteLength: 16 }, /invalid_metadata/],
    ["canonical path", { path: "/tmp/noncanonical-agentlens-artifact" }, /canonical_path/]
  ] as const)("rejects invalid %s metadata with the existing error reason", async (_name, overrides, error) => {
    const fixture = await artifactFixture(undefined, overrides);

    await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: true
    })).rejects.toThrow(error);
  });

  it.each(["symlink", "digest", "non-regular"] as const)(
    "rejects %s replacement before returning artifact bytes",
    async (tamper) => {
      const fixture = await artifactFixture();
      if (tamper === "symlink") {
        const target = join(fixture.root, "outside.json");
        await writeFile(target, '{"outside":true}', "utf8");
        await rm(fixture.artifact.path);
        await symlink(target, fixture.artifact.path);
      } else if (tamper === "digest") {
        await writeFile(fixture.artifact.path, '{"fixture":fals}', "utf8");
      } else {
        await chmod(fixture.artifact.path, 0o600);
        await rm(fixture.artifact.path);
        await mkdir(fixture.artifact.path);
      }

      await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
        expectedKind: "native-payload",
        expectedMediaType: "application/json",
        requireComplete: true
      })).rejects.toThrow(/artifact validation failed/i);
    }
  );

  it("rejects artifact files readable by group or other users", async () => {
    const fixture = await artifactFixture();
    await chmod(fixture.artifact.path, 0o644);

    await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: true,
      requireOwnerOnly: true
    })).rejects.toThrow(/artifact validation failed \(owner_only\)/i);
  });

  it.each(["alternate", "colliding"] as const)(
    "rejects a %s metadata path even when it stays inside the artifact root",
    async (tamper) => {
      const fixture = await artifactFixture();
      const bucket = join(fixture.artifactRoot, fixture.artifact.id.slice(0, 2));
      const path = tamper === "alternate"
        ? `${bucket}/../${fixture.artifact.id.slice(0, 2)}/${fixture.artifact.id}`
        : join(bucket, "0".repeat(64));

      await expect(readValidatedArtifact(
        { ...fixture.artifact, path },
        fixture.artifactRoot,
        {
          expectedKind: "native-payload",
          expectedMediaType: "application/json",
          requireComplete: true
        }
      )).rejects.toThrow(/artifact validation failed \(canonical_path\)/i);
    }
  );

  it.each(["root", "bucket"] as const)(
    "rejects a %s symlink before returning artifact bytes",
    async (tamper) => {
      const fixture = await artifactFixture();
      let artifactRoot = fixture.artifactRoot;
      let artifact = fixture.artifact;
      if (tamper === "root") {
        artifactRoot = join(fixture.root, "artifact-root-alias");
        await symlink(fixture.artifactRoot, artifactRoot);
        artifact = {
          ...fixture.artifact,
          path: join(artifactRoot, fixture.artifact.id.slice(0, 2), fixture.artifact.id)
        };
      } else {
        const bucket = join(fixture.artifactRoot, fixture.artifact.id.slice(0, 2));
        const externalBucket = join(fixture.root, "external-bucket");
        await rename(bucket, externalBucket);
        await symlink(externalBucket, bucket);
      }

      await expect(readValidatedArtifact(artifact, artifactRoot, {
        expectedKind: "native-payload",
        expectedMediaType: "application/json",
        requireComplete: true
      })).rejects.toThrow(/artifact validation failed \(canonical_path\)/i);
    }
  );

  it("validates truncated bytes but refuses them for complete-content consumers", async () => {
    const fixture = await artifactFixture(Buffer.from('{"preview":1}', "utf8"), {
      truncated: true,
      originalByteLength: 40_000
    });

    await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: true
    })).rejects.toThrow(/artifact validation failed \(truncated_content\)/i);

    await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: false
    })).resolves.toMatchObject({
      bytes: Buffer.from('{"preview":1}', "utf8"),
      truncated: true,
      storedByteLength: fixture.artifact.byteLength,
      originalByteLength: 40_000
    });
  });
});
