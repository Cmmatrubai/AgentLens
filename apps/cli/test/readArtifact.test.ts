import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { StoredArtifact } from "@agentlens/storage";
import { readValidatedArtifact } from "../src/readArtifact.js";

const roots: string[] = [];

async function artifactFixture(
  bytes = Buffer.from('{"fixture":true}', "utf8"),
  overrides: Partial<StoredArtifact> = {}
): Promise<{ root: string; artifactRoot: string; artifact: StoredArtifact }> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-read-artifact-"));
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

    const result = await readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: true
    });

    expect(result).toEqual({
      bytes: Buffer.from('{"fixture":true}', "utf8"),
      truncated: false,
      storedByteLength: 16,
      originalByteLength: 16
    });
  });

  it.each([
    ["id", { id: "not-a-digest" }],
    ["sha", { sha256: "0".repeat(64) }],
    ["kind", { kind: "assessment-note" }],
    ["media", { mediaType: "text/plain" }],
    ["redaction", { redactionState: "unredacted" as never }],
    ["stored length", { byteLength: 15 }],
    ["complete length", { originalByteLength: 17 }],
    ["canonical path", { path: "/tmp/noncanonical-agentlens-artifact" }]
  ] as const)("rejects invalid %s metadata without exposing bytes", async (_name, overrides) => {
    const fixture = await artifactFixture(undefined, overrides);

    await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: true
    })).rejects.toThrow(/artifact validation failed/i);
  });

  it.each(["symlink", "digest", "mode"] as const)(
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

  it("validates truncated bytes but refuses them for complete-content consumers", async () => {
    const fixture = await artifactFixture(Buffer.from('{"preview":1}', "utf8"), {
      truncated: true,
      originalByteLength: 40_000
    });

    await expect(readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: true
    })).rejects.toThrow(/artifact validation failed/i);

    const bounded = await readValidatedArtifact(fixture.artifact, fixture.artifactRoot, {
      expectedKind: "native-payload",
      expectedMediaType: "application/json",
      requireComplete: false
    });
    expect(bounded).toMatchObject({
      truncated: true,
      storedByteLength: fixture.artifact.byteLength,
      originalByteLength: 40_000
    });
  });
});
