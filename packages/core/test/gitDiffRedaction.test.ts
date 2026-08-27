import { describe, expect, it } from "vitest";
import { redactGitDiff, shouldExcludePath } from "../src/gitDiffRedaction.js";

const standardContext = {
  policy: "standard" as const,
  key: Buffer.alloc(32, 0x41),
  contentClass: "git-diff" as const
};

describe("sensitive path policy", () => {
  it.each([
    [".env", "sensitive-path.env"],
    ["config/.env.production", "sensitive-path.env"],
    ["certs/client.pem", "sensitive-path.key"],
    ["home/.ssh/id_ed25519", "sensitive-path.ssh"],
    [".aws/credentials", "sensitive-path.aws"]
  ])("excludes %s", (path, reason) => {
    expect(shouldExcludePath(path, "standard")).toEqual({ exclude: true, reason });
  });

  it("retains ordinary source paths", () => {
    expect(shouldExcludePath("src/safe.ts", "standard")).toEqual({ exclude: false });
  });

  it("applies configured deny globs", () => {
    expect(
      shouldExcludePath("private/generated/session.txt", {
        capture: "standard",
        denyGlobs: ["private/**"]
      })
    ).toEqual({ exclude: true, reason: "sensitive-path.configured" });
  });

  it.each([
    ["private/file.txt", "**/private/**"],
    ["nested/private/file.txt", "**/private/**"],
    ["a/b", "a/**/b"],
    ["a/x/y/b", "a/**/b"]
  ])("lets globstar match zero or more path segments: %s against %s", (path, glob) => {
    expect(
      shouldExcludePath(path, {
        capture: "standard",
        denyGlobs: [glob]
      })
    ).toEqual({ exclude: true, reason: "sensitive-path.configured" });
  });
});

describe("Git diff redaction", () => {
  it("threads configured sensitive path globs through whole-block diff filtering", () => {
    const input = [
      "diff --git a/private/session.txt b/private/session.txt",
      "--- a/private/session.txt",
      "+++ b/private/session.txt",
      "@@ -1 +1 @@",
      "-CUSTOM_GLOB_OLD_SENTINEL",
      "+CUSTOM_GLOB_NEW_SENTINEL",
      "diff --git a/src/safe.ts b/src/safe.ts",
      "--- a/src/safe.ts",
      "+++ b/src/safe.ts",
      "@@ -1 +1 @@",
      "-const safe = 1;",
      "+const safe = 2;",
      ""
    ].join("\n");

    const result = redactGitDiff(input, {
      ...standardContext,
      sensitivePathPolicy: { capture: "standard", denyGlobs: ["private/**"] }
    });

    expect(result.text).not.toContain("private/session.txt");
    expect(result.text).not.toContain("CUSTOM_GLOB_OLD_SENTINEL");
    expect(result.text).not.toContain("CUSTOM_GLOB_NEW_SENTINEL");
    expect(result.text).toContain("[[EXCLUDED:sensitive-path.configured]]");
    expect(result.text).toContain("diff --git a/src/safe.ts b/src/safe.ts");
  });

  it("removes an entire sensitive-path diff block before token redaction", () => {
    const input = [
      "diff --git a/.env.production b/.env.production",
      "index 1111111..2222222 100644",
      "--- a/.env.production",
      "+++ b/.env.production",
      "@@ -1 +1 @@",
      "-DATABASE_PASSWORD=old-secret",
      "+DATABASE_PASSWORD=DIFF_SECRET_SENTINEL",
      "diff --git a/src/safe.ts b/src/safe.ts",
      "index 3333333..4444444 100644",
      "--- a/src/safe.ts",
      "+++ b/src/safe.ts",
      "@@ -1 +1 @@",
      "-const value = 'old';",
      "+const value = 'safe';",
      ""
    ].join("\n");

    const result = redactGitDiff(input, standardContext);

    expect(result.text).not.toContain("DATABASE_PASSWORD");
    expect(result.text).not.toContain("DIFF_SECRET_SENTINEL");
    expect(result.text).not.toContain("diff --git a/.env.production");
    expect(result.text).toContain("diff --git a/src/safe.ts b/src/safe.ts");
    expect(result.text).toContain("[[EXCLUDED:sensitive-path.env]]");
  });

  it.each([
    ["rename", "rename from src/safe.ts\nrename to secrets/renamed.txt"],
    ["copy", "copy from src/safe.ts\ncopy to credentials.backup"]
  ])("filters a block when its %s destination is sensitive", (_operation, headers) => {
    const input = [
      "diff --git a/src/safe.ts b/src/safe.ts",
      "similarity index 100%",
      headers,
      "--- a/src/safe.ts",
      "+++ b/src/safe.ts",
      "@@ -1 +1 @@",
      "-SOURCE_HEADER_SENTINEL",
      "+DESTINATION_CONTENT_SENTINEL",
      ""
    ].join("\n");

    const result = redactGitDiff(input, standardContext);

    expect(result.text).not.toContain("SOURCE_HEADER_SENTINEL");
    expect(result.text).not.toContain("DESTINATION_CONTENT_SENTINEL");
    expect(result.text).not.toContain("src/safe.ts");
    expect(result.text).toMatch(/^\[\[EXCLUDED:sensitive-path\.(?:credentials|secrets)\]\]\n?$/);
  });

  it("applies value redaction to retained diff blocks", () => {
    const input = [
      "diff --git a/src/safe.ts b/src/safe.ts",
      "--- a/src/safe.ts",
      "+++ b/src/safe.ts",
      "@@ -1 +1 @@",
      "-Authorization: Bearer old-token",
      "+Authorization: Bearer SAFE_DIFF_TOKEN_SENTINEL",
      ""
    ].join("\n");

    const result = redactGitDiff(input, standardContext);

    expect(result.text).toContain("diff --git a/src/safe.ts b/src/safe.ts");
    expect(result.text).not.toContain("SAFE_DIFF_TOKEN_SENTINEL");
    expect(result.text).toMatch(/\[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/);
  });
});
