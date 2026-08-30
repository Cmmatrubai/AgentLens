import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { TraceEventV1 } from "@agentlens/core";
import type { RunDetail, StoredArtifact } from "@agentlens/storage";
import { inspectJson } from "../src/format.js";
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

function nativeDetail(artifact: StoredArtifact): RunDetail {
  const event: TraceEventV1 = {
    id: "native-event",
    runId: "native-run",
    sequence: 1,
    receivedAt: new Date(1).toISOString(),
    kind: "source.unknown",
    status: "completed",
    provenance: "observed",
    source: { provider: "codex-exec", eventType: "future.fixture" },
    relationships: [],
    summary: "native fixture",
    nativePayload: { storage: "artifact", artifactId: artifact.id }
  };
  return {
    run: {
      id: "native-run",
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "unknown",
      status: "completed",
      capturePolicy: "standard",
      capturePolicyVersion: "1",
      redactionVersion: "1",
      repositoryFingerprint: "fixture",
      repositoryDisplay: "fixture",
      startedAt: 1,
      endedAt: 2,
      childPid: null,
      exitCode: 0,
      terminatingSignal: null,
      providerTerminalKind: "completed",
      terminalReason: "fixture",
      contradictionCodes: []
    },
    ownership: null,
    events: [event],
    artifacts: [{ ...artifact, runId: "native-run" }],
    redactionAudits: [],
    gitEvidence: null
  };
}

const nativeProjection = {
  summary: null as never,
  ownership: { storedCondition: null, diagnosis: "unavailable" as const },
  reviewerNote: { state: "absent" as const, contentAvailable: false as const }
};

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
    ["negative length", { byteLength: -1 }],
    ["fractional length", { originalByteLength: 16.5 }],
    ["truncated length", { truncated: true, originalByteLength: 16 }],
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

  it.each([
    ["invalid UTF-8", Buffer.from([0xff, 0xfe, 0xfd]), /invalid UTF-8/i],
    ["invalid JSON", Buffer.from("{", "utf8"), /invalid JSON/i]
  ] as const)("rejects %s through the native-payload consumer", async (_label, bytes, error) => {
    const fixture = await artifactFixture(bytes);

    await expect(inspectJson(
      nativeDetail(fixture.artifact),
      true,
      fixture.artifactRoot,
      nativeProjection
    )).rejects.toThrow(error);
  });

  it("projects only a bounded envelope for truncated native payload content", async () => {
    const fixture = await artifactFixture(Buffer.from('{"partial":', "utf8"), {
      truncated: true,
      originalByteLength: 100
    });

    const inspected = await inspectJson(
      nativeDetail(fixture.artifact),
      true,
      fixture.artifactRoot,
      nativeProjection
    );

    expect(inspected.events[0]?.nativeContent).toEqual({
      state: "truncated",
      truncated: true,
      storedByteLength: fixture.artifact.byteLength,
      originalByteLength: 100
    });
  });
});
