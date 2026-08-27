import { access, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactStore,
  prepareNativePayload,
  redactedTextBytes
} from "../src/artifactStore.js";
import { RedactedBytes, redactJson, redactText } from "../src/redaction.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentlens-artifacts-"));
  temporaryRoots.push(root);
  return root;
}

async function readEveryFile(root: string): Promise<Buffer[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(entry.parentPath, entry.name)))
  );
}

describe("ArtifactStore", () => {
  it("does not expose an arbitrary JSON-to-redacted-bytes escape hatch", () => {
    expect("fromJson" in RedactedBytes).toBe(false);
  });

  it("rejects an unbranded object at the redacted-byte boundary", () => {
    expect(() =>
      RedactedBytes.fromText({ text: "unredacted", audits: [] } as never)
    ).toThrow("RedactedBytes require an in-memory redaction result");
  });

  it("cannot persist text mutated after redaction", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot);
    const redacted = redactText("Bearer ORIGINAL_IMMUTABILITY_SECRET", {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "output"
    });

    try {
      (redacted as { text: string }).text = "POST_REDACTION_TEXT_SENTINEL";
    } catch {
      // Frozen results reject the adversarial mutation in strict mode.
    }

    const completed = await store.writeRedacted({
      runId: "run-immutable-text",
      kind: "command-output",
      redactedBytes: redactedTextBytes(redacted),
      mediaType: "text/plain"
    });
    const stored = await readFile(completed.path, "utf8");

    expect(stored).not.toContain("POST_REDACTION_TEXT_SENTINEL");
    expect(stored).not.toContain("ORIGINAL_IMMUTABILITY_SECRET");
    expect(Object.isFrozen(redacted)).toBe(true);
  });

  it("prepares inline native payloads from an immutable byte snapshot", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot);
    const redacted = redactJson(
      { future: { nested: "safe" }, token: "NATIVE_IMMUTABILITY_SECRET" },
      {
        policy: "standard",
        key: Buffer.alloc(32, 0x41),
        contentClass: "native",
        runId: "run-immutable-native"
      }
    );
    if (redacted.storage !== "content") throw new Error("expected redacted JSON content");

    try {
      (redacted.redacted as { future: { nested: string } }).future.nested =
        "NESTED_PREPARE_SENTINEL";
    } catch {
      // Deep-frozen JSON rejects the adversarial mutation in strict mode.
    }
    try {
      (redacted as { redacted: unknown }).redacted = {
        future: { nested: "REPLACED_PREPARE_SENTINEL" }
      };
    } catch {
      // Frozen result objects reject replacement in strict mode.
    }

    const nativePayload = await prepareNativePayload(redacted, store);
    expect(nativePayload.storage).toBe("inline");
    if (nativePayload.storage !== "inline") throw new Error("expected inline native payload");

    try {
      (nativePayload.redacted as { future: { nested: string } }).future.nested =
        "POST_PREPARE_SENTINEL";
    } catch {
      // Prepared inline JSON is also deeply frozen.
    }

    const serialized = JSON.stringify(nativePayload);
    expect(serialized).not.toContain("NESTED_PREPARE_SENTINEL");
    expect(serialized).not.toContain("REPLACED_PREPARE_SENTINEL");
    expect(serialized).not.toContain("POST_PREPARE_SENTINEL");
    expect(serialized).not.toContain("NATIVE_IMMUTABILITY_SECRET");
    expect(Object.isFrozen(redacted)).toBe(true);
    expect(Object.isFrozen(redacted.redacted)).toBe(true);
    expect(Object.isFrozen(nativePayload)).toBe(true);
    expect(Object.isFrozen(nativePayload.redacted)).toBe(true);
  });

  it("writes only explicitly redacted bytes and resolves after the owner-only final file exists", async () => {
    const dataRoot = await createRoot();
    const sourceSentinel = "ORIGINAL_ARTIFACT_SENTINEL";
    const redacted = redactText(`Bearer ${sourceSentinel}`, {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "output"
    });
    const store = new ArtifactStore(dataRoot);

    const completed = await store.writeRedacted({
      runId: "run-artifact",
      kind: "command-output",
      redactedBytes: redactedTextBytes(redacted),
      mediaType: "text/plain"
    });

    await expect(access(completed.path)).resolves.toBeUndefined();
    expect((await stat(completed.path)).mode & 0o777).toBe(0o600);
    expect(await readFile(completed.path, "utf8")).toBe(redacted.text);
    const allDurableBytes = Buffer.concat(await readEveryFile(dataRoot)).toString("utf8");
    expect(allDurableBytes).not.toContain(sourceSentinel);
  });

  it("keeps small redacted native JSON inline", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot);
    const redacted = redactJson(
      { future: { nested: 7 }, token: "SMALL_NATIVE_SENTINEL" },
      {
        policy: "standard",
        key: Buffer.alloc(32, 0x41),
        contentClass: "native",
        runId: "run-small-native"
      }
    );

    const nativePayload = await prepareNativePayload(redacted, store);

    expect(nativePayload).toMatchObject({ storage: "inline", redacted: { future: { nested: 7 } } });
    expect(JSON.stringify(nativePayload)).not.toContain("SMALL_NATIVE_SENTINEL");
  });

  it("externalizes large redacted native JSON only after its artifact exists", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot);
    const redacted = redactJson(
      { future: "x".repeat(33 * 1024), token: "LARGE_NATIVE_SENTINEL" },
      {
        policy: "standard",
        key: Buffer.alloc(32, 0x41),
        contentClass: "native",
        runId: "run-large-native"
      }
    );

    const nativePayload = await prepareNativePayload(redacted, store);

    expect(nativePayload.storage).toBe("artifact");
    if (nativePayload.storage !== "artifact") throw new Error("expected external native payload");
    const artifactPath = store.pathForArtifactId(nativePayload.artifactId);
    await expect(access(artifactPath)).resolves.toBeUndefined();
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
    const allDurableBytes = Buffer.concat(await readEveryFile(dataRoot)).toString("utf8");
    expect(allDurableBytes).not.toContain("LARGE_NATIVE_SENTINEL");
  });

  it.each(["metadata-only", "strict"] as const)(
    "returns an explicit omitted native payload for %s",
    async (policy) => {
      const dataRoot = await createRoot();
      const store = new ArtifactStore(dataRoot);
      const redacted = redactJson(
        { source: "OMITTED_NATIVE_SENTINEL" },
        {
          policy,
          key: Buffer.alloc(32, 0x41),
          contentClass: "native",
          runId: "run-omitted"
        }
      );

      await expect(prepareNativePayload(redacted, store)).resolves.toEqual({
        storage: "omitted",
        reason: policy
      });
      expect(await readEveryFile(dataRoot)).toHaveLength(0);
    }
  );

  it("returns no completed artifact and removes its temporary file when rename fails", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot, {
      rename: async () => {
        throw new Error("injected rename failure");
      }
    });
    const redacted = redactText("safe redacted content", {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "output"
    });

    await expect(
      store.writeRedacted({
        runId: "run-rename-failure",
        kind: "command-output",
        redactedBytes: redactedTextBytes(redacted),
        mediaType: "text/plain"
      })
    ).rejects.toThrow("injected rename failure");

    const files = await readEveryFile(dataRoot);
    expect(files).toHaveLength(0);
    await expect(access(join(dataRoot, "artifacts", "tmp"))).resolves.toBeUndefined();
    expect((await readdir(join(dataRoot, "artifacts", "tmp"))).length).toBe(0);
  });

  it("surfaces a temporary-file cleanup failure without returning a completed artifact", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot, {
      rename: async () => {
        throw new Error("injected primary rename failure");
      },
      unlink: async () => {
        throw new Error("injected temp cleanup failure");
      }
    });
    const redacted = redactText("safe redacted content", {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "output"
    });

    let failure: unknown;
    try {
      await store.writeRedacted({
        runId: "run-cleanup-failure",
        kind: "command-output",
        redactedBytes: redactedTextBytes(redacted),
        mediaType: "text/plain"
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toBe(
      "Artifact write failed and temporary-file cleanup also failed."
    );
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "injected primary rename failure" }),
      expect.objectContaining({ message: "injected temp cleanup failure" })
    ]);
  });

  it("places temporary and final artifact paths on the same filesystem tree", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot);
    const redacted = redactText("safe", {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "output"
    });

    const completed = await store.writeRedacted({
      runId: "run-same-filesystem",
      kind: "test",
      redactedBytes: redactedTextBytes(redacted),
      mediaType: "text/plain"
    });

    expect(dirname(dirname(dirname(completed.path)))).toBe(join(dataRoot, "artifacts"));
  });

  it("caps redacted artifacts at 10 MiB with a visible truncation marker", async () => {
    const dataRoot = await createRoot();
    const store = new ArtifactStore(dataRoot);
    const oversizedText = "x".repeat(10 * 1024 * 1024 + 100);
    const redacted = redactText(oversizedText, {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "output"
    });

    const completed = await store.writeRedacted({
      runId: "run-truncated",
      kind: "command-output",
      redactedBytes: redactedTextBytes(redacted),
      mediaType: "text/plain"
    });

    expect(completed.truncated).toBe(true);
    expect(completed.originalByteLength).toBe(10 * 1024 * 1024 + 100);
    expect(completed.byteLength).toBe(10 * 1024 * 1024);
    expect(await readFile(completed.path, "utf8")).toMatch(
      /\n\[\[TRUNCATED:artifact:max-bytes:10485760\]\]\n$/
    );
  });
});
