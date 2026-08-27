import { createHash } from "node:crypto";
import { mkdtemp, stat } from "node:fs/promises";
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
