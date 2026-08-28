import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fixedMetadataText,
  redactJson,
  redactText,
  type ContentClass,
  type RedactionContext
} from "../src/redaction.js";
import { loadOrCreateRedactionKey } from "../src/redactionKey.js";

const temporaryRoots: string[] = [];
const standardContext: RedactionContext = {
  policy: "standard",
  key: Buffer.alloc(32, 0x41),
  contentClass: "output"
};

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("redaction key", () => {
  it("creates one stable 32-byte owner-only machine key", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "agentlens-redaction-key-"));
    temporaryRoots.push(dataRoot);

    const [first, second] = await Promise.all([
      loadOrCreateRedactionKey(dataRoot),
      loadOrCreateRedactionKey(dataRoot)
    ]);

    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
    expect((await stat(join(dataRoot, "secrets"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dataRoot, "secrets", "redaction-hmac.key"))).mode & 0o777).toBe(0o600);
  });

  it("rejects a symlinked secrets directory without mutating its external target", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-redaction-key-symlink-"));
    temporaryRoots.push(root);
    const dataRoot = join(root, "data");
    const outside = join(root, "outside-secrets");
    const sentinel = join(outside, "sentinel.txt");
    await mkdir(dataRoot);
    await mkdir(outside, { mode: 0o755 });
    await writeFile(sentinel, "OUTSIDE_SECRETS_SENTINEL", { mode: 0o644 });
    await symlink(outside, join(dataRoot, "secrets"));

    await expect(loadOrCreateRedactionKey(dataRoot)).rejects.toThrow(/symbolic|symlink/i);

    expect(await readFile(sentinel, "utf8")).toBe("OUTSIDE_SECRETS_SENTINEL");
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
    expect((await stat(sentinel)).mode & 0o777).toBe(0o644);
    await expect(readFile(join(outside, "redaction-hmac.key"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects a symlinked key without reading or chmodding its external target", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-redaction-key-file-symlink-"));
    temporaryRoots.push(root);
    const dataRoot = join(root, "data");
    const secrets = join(dataRoot, "secrets");
    const outsideKey = join(root, "outside.key");
    const outsideBytes = Buffer.alloc(32, 0x5a);
    await mkdir(secrets, { recursive: true });
    await writeFile(outsideKey, outsideBytes, { mode: 0o644 });
    await symlink(outsideKey, join(secrets, "redaction-hmac.key"));

    await expect(loadOrCreateRedactionKey(dataRoot)).rejects.toThrow(/symbolic|symlink/i);

    expect(await readFile(outsideKey)).toEqual(outsideBytes);
    expect((await stat(outsideKey)).mode & 0o777).toBe(0o644);
  });
});

describe("text redaction", () => {
  it("keeps the redacted result and audit records immutable", () => {
    const result = redactText("Bearer IMMUTABLE_AUDIT_SOURCE", standardContext);

    try {
      (result.audits as RedactionResultMutation["audits"]).push({
        reason: "MUTATED_AUDIT_SENTINEL",
        count: 99
      });
    } catch {
      // Frozen results reject the adversarial mutation in strict mode.
    }
    try {
      (result.audits[0] as { reason: string }).reason = "MUTATED_REASON_SENTINEL";
    } catch {
      // Frozen audit entries reject the adversarial mutation in strict mode.
    }

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.audits)).toBe(true);
    expect(result.audits.every((audit) => Object.isFrozen(audit))).toBe(true);
    expect(result.audits).toEqual([{ reason: "auth-bearer", count: 1 }]);
  });

  it("uses a stable keyed HMAC marker without exposing an ordinary digest", () => {
    const first = redactText("Bearer SENTINEL_TOKEN_91", standardContext);
    const second = redactText("Bearer SENTINEL_TOKEN_91", standardContext);

    expect(first.text).toBe(second.text);
    expect(first.text).toMatch(
      /\[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/
    );
    expect(first.text).not.toContain("SENTINEL_TOKEN_91");
    expect(first.text).not.toContain(
      createHash("sha256").update("SENTINEL_TOKEN_91").digest("hex").slice(0, 32)
    );
  });

  it("binds stable markers to the machine key", () => {
    const first = redactText("Bearer SAME_SECRET", standardContext);
    const second = redactText("Bearer SAME_SECRET", {
      ...standardContext,
      key: Buffer.alloc(32, 0x42)
    });

    expect(first.text).not.toBe(second.text);
  });

  it("reduces risk from conventional prefixed secret assignments", () => {
    const result = redactText(
      "DATABASE_PASSWORD=PASSWORD_ASSIGNMENT_SENTINEL OPENAI_API_KEY=API_KEY_ASSIGNMENT_SENTINEL",
      standardContext
    );

    expect(result.text).not.toContain("PASSWORD_ASSIGNMENT_SENTINEL");
    expect(result.text).not.toContain("API_KEY_ASSIGNMENT_SENTINEL");
    expect(result.text).toMatch(
      /DATABASE_PASSWORD=\[\[REDACTED:assignment-password:hmac-sha256:[0-9a-f]{32}\]\]/
    );
    expect(result.text).toMatch(
      /OPENAI_API_KEY=\[\[REDACTED:assignment-api-key:hmac-sha256:[0-9a-f]{32}\]\]/
    );
  });

  const omittedClasses = [
    "summary",
    "prompt",
    "message",
    "command",
    "output",
    "tool",
    "git-diff",
    "native",
    "stderr"
  ] as const satisfies readonly ContentClass[];

  it.each(omittedClasses)("metadata-only emits fixed content-free %s metadata", (contentClass) => {
    const result = redactText("UNIQUE_METADATA_SENTINEL", {
      policy: "metadata-only",
      key: Buffer.alloc(32, 0x41),
      contentClass
    });

    expect(result.text).toBe(fixedMetadataText[contentClass]);
    expect(result.text).not.toContain("UNIQUE_METADATA_SENTINEL");
  });

  it.each(["command", "path"] as const)(
    "strict HMAC-tokenizes a %s label without retaining source bytes",
    (contentClass) => {
      const result = redactText("STRICT_LABEL_SENTINEL", {
        policy: "strict",
        key: Buffer.alloc(32, 0x41),
        contentClass
      });

      expect(result.text).toMatch(
        new RegExp(`^\\[\\[REDACTED:strict-${contentClass}-label:hmac-sha256:[0-9a-f]{32}\\]\\]$`)
      );
      expect(result.text).not.toContain("STRICT_LABEL_SENTINEL");
    }
  );
});

interface RedactionResultMutation {
  audits: Array<{ reason: string; count: number }>;
}

describe("JSON redaction", () => {
  it.each(["metadata-only", "strict"] as const)(
    "%s omits native JSON instead of serializing source content",
    (policy) => {
      const result = redactJson(
        { future: { token: "UNIQUE_NATIVE_SENTINEL" } },
        {
          policy,
          key: Buffer.alloc(32, 0x41),
          contentClass: "native",
          runId: "run-privacy"
        }
      );

      expect(result).toEqual({ storage: "omitted", reason: policy, runId: "run-privacy" });
      expect(JSON.stringify(result)).not.toContain("UNIQUE_NATIVE_SENTINEL");
    }
  );

  it("preserves unknown structure while redacting sensitive JSON values in memory", () => {
    const result = redactJson(
      {
        future: { nested: 7 },
        authorization: "Bearer JSON_BEARER_SENTINEL",
        password: "JSON_PASSWORD_SENTINEL"
      },
      {
        policy: "standard",
        key: Buffer.alloc(32, 0x41),
        contentClass: "native",
        runId: "run-json"
      }
    );

    expect(result.storage).toBe("content");
    if (result.storage !== "content") throw new Error("expected redacted JSON content");
    expect(result.redacted).toMatchObject({ future: { nested: 7 } });
    expect(JSON.stringify(result.redacted)).not.toContain("JSON_BEARER_SENTINEL");
    expect(JSON.stringify(result.redacted)).not.toContain("JSON_PASSWORD_SENTINEL");
    expect(JSON.stringify(result.redacted)).toMatch(/hmac-sha256:[0-9a-f]{32}/);
  });

  it("preserves hostile provider keys as own properties without mutating prototypes", () => {
    const input = JSON.parse(
      '{"__proto__":{"provider":"proto"},"constructor":{"provider":"constructor"},"prototype":{"provider":"prototype"}}'
    ) as unknown;
    const result = redactJson(input, {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "native",
      runId: "run-hostile-keys"
    });

    expect(result.storage).toBe("content");
    if (result.storage !== "content") throw new Error("expected redacted JSON content");
    expect(Object.getPrototypeOf(result.redacted)).toBeNull();
    expect(Object.keys(result.redacted)).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.hasOwn(result.redacted, "__proto__")).toBe(true);
    expect(JSON.stringify(result.redacted)).toBe(JSON.stringify(input));
    expect((Object.prototype as Record<string, unknown>).provider).toBeUndefined();
  });

  it("caps deeply nested native JSON before descent with a content-free marker and audit", () => {
    let input: unknown = { leaf: "UNREDACTED_DEEP_SENTINEL" };
    for (let depth = 0; depth < 20_000; depth += 1) input = { next: input };

    const result = redactJson(input, {
      policy: "standard",
      key: Buffer.alloc(32, 0x41),
      contentClass: "native",
      runId: "run-depth-cap"
    });

    expect(result.storage).toBe("content");
    if (result.storage !== "content") throw new Error("expected redacted JSON content");
    const serialized = result.redactedBytes.copy().toString("utf8");
    expect(serialized).toContain("[[REDACTED:json-max-depth]]");
    expect(serialized).not.toContain("UNREDACTED_DEEP_SENTINEL");
    expect(result.audits).toEqual([{ reason: "json-max-depth", count: 1 }]);
  });

  it("does not recursively serialize a deeply nested sensitive native value", () => {
    let deepSecret: unknown = { leaf: "UNREDACTED_DEEP_SECRET_SENTINEL" };
    for (let depth = 0; depth < 20_000; depth += 1) deepSecret = [deepSecret];

    const result = redactJson(
      { token: deepSecret },
      {
        policy: "standard",
        key: Buffer.alloc(32, 0x41),
        contentClass: "native",
        runId: "run-sensitive-depth-cap"
      }
    );

    expect(result.storage).toBe("content");
    if (result.storage !== "content") throw new Error("expected redacted JSON content");
    const serialized = result.redactedBytes.copy().toString("utf8");
    expect(serialized).toContain("[[REDACTED:json-max-depth]]");
    expect(serialized).not.toContain("UNREDACTED_DEEP_SECRET_SENTINEL");
    expect(result.audits).toEqual([{ reason: "json-max-depth", count: 1 }]);
  });

  it("uses a fixed audit rule ID instead of deriving it from a native property name", () => {
    const result = redactJson(
      { password_UNTRUSTED_PROPERTY_SUFFIX: "PROPERTY_VALUE_SENTINEL" },
      {
        policy: "standard",
        key: Buffer.alloc(32, 0x41),
        contentClass: "native",
        runId: "run-fixed-rule"
      }
    );

    expect(result.storage).toBe("content");
    if (result.storage !== "content") throw new Error("expected redacted JSON content");
    expect(result.redacted).toEqual({
      password_UNTRUSTED_PROPERTY_SUFFIX: expect.stringMatching(
        /^\[\[REDACTED:json-password:hmac-sha256:[0-9a-f]{32}\]\]$/
      )
    });
    expect(result.audits).toEqual([{ reason: "json-password", count: 1 }]);
  });
});
