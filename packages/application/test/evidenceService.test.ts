import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CapturePolicy, CompletedArtifact, TraceEventV1 } from "@agentlens/core";
import { RunRepository, openDatabase } from "@agentlens/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  EvidenceServiceError,
  createEvidenceService,
  parseGitDiff
} from "../src/index.js";

const roots: string[] = [];
const receivedAt = "2026-08-31T12:00:00.000Z";

function trace(
  runId: string,
  id: string,
  sequence: number,
  overrides: Partial<TraceEventV1> = {}
): TraceEventV1 {
  return {
    id,
    runId,
    sequence,
    receivedAt,
    kind: "message.agent",
    status: "completed",
    provenance: "observed",
    source: { provider: "codex-exec", itemId: id, eventType: "item.completed" },
    relationships: [],
    summary: "redacted fixture",
    normalizedPayload: { text: "redacted message" },
    nativePayload: { storage: "inline", redacted: { message: "redacted native" } },
    ...overrides
  };
}

async function completedArtifact(
  artifactRoot: string,
  runId: string,
  kind: string,
  mediaType: string,
  text: string | Buffer,
  overrides: Partial<CompletedArtifact> = {}
): Promise<CompletedArtifact> {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8");
  const id = createHash("sha256").update(bytes).digest("hex");
  const directory = join(artifactRoot, id.slice(0, 2));
  const path = join(directory, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  return {
    id,
    runId,
    kind,
    mediaType,
    path,
    sha256: id,
    byteLength: bytes.byteLength,
    redactionState: "redacted",
    truncated: false,
    originalByteLength: bytes.byteLength,
    ...overrides
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentlens-evidence-"));
  roots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(root, "agentlens.sqlite");
  const database = openDatabase(databasePath);
  const repository = new RunRepository(database, { artifactRoot });
  const createRun = (id: string, capturePolicy: CapturePolicy) => repository.createRun({
    id,
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "fixture",
    capturePolicy,
    capturePolicyVersion: "1",
    redactionVersion: "1",
    repositoryFingerprint: `repo-${id}`,
    repositoryDisplay: "fixture repository",
    startedAt: 1
  }, {
    recorderInstanceId: `recorder-${id}`,
    recorderPid: 4242,
    recorderStartToken: `token-${id}`,
    heartbeatAt: 1
  });
  return { root, artifactRoot, databasePath, database, repository, createRun };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Task 7.7 evidence projection", () => {
  it("parses a structured Git diff without producing markup", () => {
    const parsed = parseGitDiff([
      "diff --git \"a/src/old name.ts\" \"b/src/new name.ts\"",
      "similarity index 90%",
      "rename from src/old name.ts",
      "rename to src/new name.ts",
      "--- \"a/src/old name.ts\"",
      "+++ \"b/src/new name.ts\"",
      "@@ -1,2 +1,3 @@ heading",
      " same",
      "-old",
      "+new",
      "+[[EXCLUDED:sensitive-path]]",
      "\\ No newline at end of file",
      ""
    ].join("\n"), false);

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      kind: "diff",
      truncated: false,
      malformed: false,
      files: [{
        oldPath: "src/old name.ts",
        newPath: "src/new name.ts",
        metadata: [
          { type: "similarity", text: "similarity index 90%" },
          { type: "rename_from", text: "rename from src/old name.ts" },
          { type: "rename_to", text: "rename to src/new name.ts" }
        ],
        hunks: [{
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 3,
          lines: [
            { type: "context", oldLineNumber: 1, newLineNumber: 1, text: "same" },
            { type: "delete", oldLineNumber: 2, newLineNumber: null, text: "old" },
            { type: "add", oldLineNumber: null, newLineNumber: 2, text: "new" },
            { type: "excluded", oldLineNumber: null, newLineNumber: 3, text: "[[EXCLUDED:sensitive-path]]" },
            { type: "no_newline", oldLineNumber: null, newLineNumber: null, text: "No newline at end of file" }
          ]
        }]
      }]
    });
    expect(JSON.stringify(parsed)).not.toContain("<script");
    expect(Object.hasOwn(parsed, "html")).toBe(false);
  });

  it("represents empty, binary, malformed, and truncated diffs explicitly", () => {
    expect(parseGitDiff("", false)).toEqual({
      schemaVersion: 1,
      kind: "diff",
      files: [],
      preamble: [],
      truncated: false,
      malformed: false
    });
    expect(parseGitDiff("Binary files a/a.bin and b/a.bin differ\n", false)).toMatchObject({
      malformed: true,
      preamble: ["Binary files a/a.bin and b/a.bin differ"]
    });
    expect(parseGitDiff("diff --git a/a.bin b/a.bin\nBinary files a/a.bin and b/a.bin differ\n", true))
      .toMatchObject({
        truncated: true,
        malformed: false,
        files: [{ metadata: [{ type: "binary", text: "Binary files a/a.bin and b/a.bin differ" }] }]
      });
  });

  it("preserves a producer-emitted sensitive-path exclusion marker as valid data", () => {
    expect(parseGitDiff("[[EXCLUDED:sensitive-path.env]]\n", false)).toEqual({
      schemaVersion: 1,
      kind: "diff",
      files: [],
      preamble: ["[[EXCLUDED:sensitive-path.env]]"],
      truncated: false,
      malformed: false
    });
  });

  it("decodes Git quoted-path octets as UTF-8", () => {
    expect(parseGitDiff([
      "diff --git \"a/src/caf\\303\\251.ts\" \"b/src/caf\\303\\251.ts\"",
      "--- \"a/src/caf\\303\\251.ts\"",
      "+++ \"b/src/caf\\303\\251.ts\"",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), false)).toMatchObject({
      malformed: false,
      files: [{ oldPath: "src/café.ts", newPath: "src/café.ts" }]
    });
  });

  it("represents an over-limit diff header as malformed instead of throwing", () => {
    const overlongPath = `src/${"x".repeat(4_096)}`;
    expect(parseGitDiff(`diff --git a/${overlongPath} b/${overlongPath}\n`, false)).toEqual({
      schemaVersion: 1,
      kind: "diff",
      files: [],
      preamble: [`diff --git a/${overlongPath} b/${overlongPath}`],
      truncated: false,
      malformed: true
    });
  });

  it("exposes a typed unavailable error instead of accepting invalid service identifiers", async () => {
    const service = createEvidenceService({
      databasePath: "/definitely/missing/agentlens.sqlite",
      artifactRoot: "/definitely/missing/artifacts"
    });
    await expect(service.eventContent("", "event"))
      .rejects.toEqual(expect.objectContaining<EvidenceServiceError>({ code: "invalid_request" }));
  });

  it("reads only authoritative same-run standard evidence for every explicit role", async () => {
    const setup = await fixture();
    setup.createRun("run-evidence", "standard");
    setup.repository.appendEvent(trace("run-evidence", "message-event", 0));
    setup.repository.appendEvent(trace("run-evidence", "unknown-event", 1, {
      kind: "future.provider.kind",
      normalizedPayload: { arbitrary: "MUST_NOT_CROSS" }
    }));

    const native = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "native-payload",
      "application/json",
      JSON.stringify({ value: "redacted native artifact" })
    );
    await setup.repository.commitArtifactMetadata(native);
    setup.repository.appendEvent(trace("run-evidence", "native-event", 2, {
      nativePayload: { storage: "artifact", artifactId: native.id }
    }));

    const initialStatus = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "git-initial-status",
      "text/plain",
      `1 .M N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} src/old.ts\n`
    );
    const finalStatus = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "git-final-status",
      "text/plain",
      "? new.txt\n[[EXCLUDED:sensitive-path.env]]\n"
    );
    const diff = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "git-tracked-final-diff",
      "text/x-diff",
      "diff --git a/src/old.ts b/src/new.ts\n--- a/src/old.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-old\n+new\n"
    );
    const diffCheck = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "git-diff-check",
      "application/json",
      JSON.stringify({ passed: true, output: "" })
    );
    const untracked = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "git-untracked-file-metadata",
      "application/json",
      JSON.stringify([{ path: "new.txt", type: "file", size: 12 }])
    );
    for (const artifact of [initialStatus, finalStatus, diff, diffCheck, untracked]) {
      await setup.repository.commitArtifactMetadata(artifact);
    }
    setup.repository.saveGitEvidence("run-evidence", {
      initialHead: "a".repeat(40),
      finalHead: "b".repeat(40),
      initialBranch: "main",
      finalBranch: "task",
      initialStatus: { state: "artifact", artifactId: initialStatus.id },
      finalStatus: { state: "artifact", artifactId: finalStatus.id },
      trackedFinalDiff: { state: "artifact", artifactId: diff.id },
      diffCheck: { state: "artifact", artifactId: diffCheck.id },
      diffCheckPassed: true,
      untrackedMetadata: { state: "artifact", artifactId: untracked.id },
      headChanged: true,
      branchChanged: true,
      capturedAt: 2
    });

    const olderNote = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "assessment-note",
      "text/plain; charset=utf-8",
      "older redacted note"
    );
    const currentNote = await completedArtifact(
      setup.artifactRoot,
      "run-evidence",
      "assessment-note",
      "text/plain; charset=utf-8",
      "current redacted note"
    );
    await setup.repository.updateAssessment({
      runId: "run-evidence", eventId: "assessment-old", receivedAt,
      verdict: "partial", taskCompleted: "uncertain",
      note: { state: "artifact", artifact: olderNote }
    });
    await setup.repository.updateAssessment({
      runId: "run-evidence", eventId: "assessment-current",
      receivedAt: "2026-08-31T12:00:01.000Z",
      verdict: "success", taskCompleted: "yes",
      note: { state: "artifact", artifact: currentNote }
    });
    setup.database.close();

    const service = createEvidenceService({
      databasePath: setup.databasePath,
      artifactRoot: setup.artifactRoot
    });
    await expect(service.eventContent("run-evidence", "message-event")).resolves.toMatchObject({
      eventId: "message-event",
      content: { kind: "message", text: "redacted message" }
    });
    await expect(service.eventNative("run-evidence", "native-event")).resolves.toMatchObject({
      eventId: "native-event",
      content: { format: "json", text: JSON.stringify({ value: "redacted native artifact" }) }
    });
    await expect(service.assessmentNote("run-evidence", "assessment-old"))
      .resolves.toMatchObject({ content: "older redacted note" });
    await expect(service.assessmentNote("run-evidence", "assessment-current"))
      .resolves.toMatchObject({ content: "current redacted note" });
    await expect(service.gitStatus("run-evidence", "initial")).resolves.toMatchObject({
      entries: [{ code: ".M", path: "src/old.ts" }]
    });
    await expect(service.gitStatus("run-evidence", "final")).resolves.toMatchObject({
      entries: [
        { code: "??", path: "new.txt" },
        { code: "excluded", path: "[[EXCLUDED:sensitive-path.env]]" }
      ]
    });
    await expect(service.gitDiff("run-evidence")).resolves.toMatchObject({
      files: [{ oldPath: "src/old.ts", newPath: "src/new.ts" }]
    });
    await expect(service.gitDiffCheck("run-evidence")).resolves.toEqual({
      schemaVersion: 1, kind: "diff_check", passed: true, output: ""
    });
    await expect(service.gitUntracked("run-evidence")).resolves.toMatchObject({
      entries: [{ path: "new.txt", type: "file", size: 12 }]
    });
    await expect(service.eventContent("run-evidence", "unknown-event"))
      .rejects.toMatchObject({ code: "content_unavailable" });

    const serialized = JSON.stringify(await Promise.all([
      service.eventContent("run-evidence", "message-event"),
      service.eventNative("run-evidence", "native-event"),
      service.gitDiff("run-evidence"),
      service.gitUntracked("run-evidence")
    ]));
    for (const forbidden of [
      "MUST_NOT_CROSS", setup.databasePath, setup.artifactRoot,
      native.id, native.path, "sessionId", "artifactId"
    ]) expect(serialized).not.toContain(forbidden);
  });

  it("fails closed for cross-run events, wrong provenance, wrong roles, and restrictive capture", async () => {
    const setup = await fixture();
    setup.createRun("standard-run", "standard");
    setup.createRun("other-run", "standard");
    setup.createRun("metadata-run", "metadata-only");
    setup.createRun("strict-run", "strict");
    setup.repository.appendEvent(trace("standard-run", "standard-event", 0));
    setup.repository.appendEvent(trace("other-run", "other-event", 0));
    setup.repository.appendEvent(trace("standard-run", "derived-native", 1, {
      provenance: "derived",
      relationships: [{ type: "derived_from", eventId: "standard-event" }],
      derivation: { name: "fixture", version: "1", sourceEventIds: ["standard-event"] }
    }));
    for (const [runId, policy] of [["metadata-run", "metadata-only"], ["strict-run", "strict"]] as const) {
      setup.repository.appendEvent(trace(runId, `${policy}-event`, 0, {
        normalizedPayload: { text: `${policy.toUpperCase()}_CONTENT_SENTINEL` },
        nativePayload: { storage: "omitted", reason: policy }
      }));
      setup.repository.saveGitEvidence(runId, {
        initialHead: "a".repeat(40), finalHead: "a".repeat(40),
        initialBranch: null, finalBranch: null,
        initialStatus: { state: "omitted", reason: policy },
        finalStatus: { state: "omitted", reason: policy },
        trackedFinalDiff: { state: "omitted", reason: policy },
        diffCheck: { state: "omitted", reason: policy },
        diffCheckPassed: true,
        untrackedMetadata: { state: "omitted", reason: policy },
        headChanged: false, branchChanged: false, capturedAt: 2
      });
    }
    setup.database.close();
    const service = createEvidenceService({
      databasePath: setup.databasePath,
      artifactRoot: setup.artifactRoot
    });

    await expect(service.eventContent("standard-run", "other-event"))
      .rejects.toMatchObject({ code: "event_not_found" });
    await expect(service.eventNative("standard-run", "derived-native"))
      .rejects.toMatchObject({ code: "content_unavailable" });
    await expect(service.assessmentNote("standard-run", "standard-event"))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
    for (const [runId, eventId] of [
      ["metadata-run", "metadata-only-event"],
      ["strict-run", "strict-event"]
    ] as const) {
      await expect(service.eventContent(runId, eventId)).rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.eventNative(runId, eventId)).rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.assessmentNote(runId, eventId)).rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.gitDiff(runId)).rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.gitStatus(runId, "initial")).rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.gitDiffCheck(runId)).rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.gitUntracked(runId)).rejects.toMatchObject({ code: "content_unavailable" });
    }
  });

  it("rejects artifact metadata beyond the route limit before file bytes are read", async () => {
    const setup = await fixture();
    setup.createRun("oversized-run", "standard");
    const artifact = await completedArtifact(
      setup.artifactRoot,
      "oversized-run",
      "native-payload",
      "application/json",
      JSON.stringify({ redacted: true })
    );
    await setup.repository.commitArtifactMetadata(artifact);
    setup.repository.appendEvent(trace("oversized-run", "oversized-native", 0, {
      nativePayload: { storage: "artifact", artifactId: artifact.id }
    }));
    setup.database.close();
    const original = await readFile(artifact.path);
    const { createRequire } = await import("node:module");
    const storageRequire = createRequire(new URL("../../storage/package.json", import.meta.url));
    const Database = storageRequire("better-sqlite3") as new (path: string) => {
      prepare(sql: string): { run(...parameters: unknown[]): unknown };
      close(): void;
    };
    const writable = new Database(setup.databasePath);
    writable.prepare("UPDATE artifacts SET byte_length = ? WHERE run_id = ? AND id = ?")
      .run(256 * 1024 + 1, "oversized-run", artifact.id);
    writable.close();
    await writeFile(artifact.path, Buffer.concat([original, Buffer.from("MUST_NOT_BE_READ")]), { mode: 0o600 });

    const service = createEvidenceService({ databasePath: setup.databasePath, artifactRoot: setup.artifactRoot });
    await expect(service.eventNative("oversized-run", "oversized-native"))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it("checks restrictive run capture policy before reading corruptly bound Git artifact bytes", async () => {
    const setup = await fixture();
    setup.createRun("metadata-git", "metadata-only");
    const status = await completedArtifact(
      setup.artifactRoot,
      "metadata-git",
      "git-initial-status",
      "text/plain",
      " M POLICY_BYPASS_SENTINEL\n"
    );
    const finalStatus = await completedArtifact(
      setup.artifactRoot, "metadata-git", "git-final-status", "text/plain", ""
    );
    const diffCheck = await completedArtifact(
      setup.artifactRoot, "metadata-git", "git-diff-check", "application/json",
      JSON.stringify({ passed: true, output: "" })
    );
    for (const artifact of [status, finalStatus, diffCheck]) {
      await setup.repository.commitArtifactMetadata(artifact);
    }
    setup.repository.saveGitEvidence("metadata-git", {
      initialHead: "a".repeat(40), finalHead: "a".repeat(40),
      initialBranch: null, finalBranch: null,
      initialStatus: { state: "artifact", artifactId: status.id },
      finalStatus: { state: "artifact", artifactId: finalStatus.id },
      trackedFinalDiff: { state: "absent" },
      diffCheck: { state: "artifact", artifactId: diffCheck.id },
      diffCheckPassed: true,
      untrackedMetadata: { state: "absent" },
      headChanged: false, branchChanged: false, capturedAt: 2
    });
    setup.database.close();
    const service = createEvidenceService({ databasePath: setup.databasePath, artifactRoot: setup.artifactRoot });
    await expect(service.gitStatus("metadata-git", "initial"))
      .rejects.toMatchObject({ code: "content_unavailable" });
  });

  it.each(["metadata-only", "strict"] as const)(
    "checks %s capture policy before decoding durable event content bytes",
    async (capturePolicy) => {
      const setup = await fixture();
      const runId = `${capturePolicy}-corrupt-event`;
      const eventId = `${capturePolicy}-event`;
      setup.createRun(runId, capturePolicy);
      setup.repository.appendEvent(trace(runId, eventId, 0));
      setup.database.close();

      const { createRequire } = await import("node:module");
      const storageRequire = createRequire(new URL("../../storage/package.json", import.meta.url));
      const Database = storageRequire("better-sqlite3") as new (path: string) => {
        prepare(sql: string): { run(...parameters: unknown[]): unknown };
        close(): void;
      };
      const writable = new Database(setup.databasePath);
      writable.prepare(`
        UPDATE events
        SET normalized_payload_json = '{', native_payload_inline_json = '{'
        WHERE run_id = ? AND id = ?
      `).run(runId, eventId);
      writable.close();

      const service = createEvidenceService({
        databasePath: setup.databasePath,
        artifactRoot: setup.artifactRoot
      });
      await expect(service.eventContent(runId, eventId))
        .rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.eventNative(runId, eventId))
        .rejects.toMatchObject({ code: "content_unavailable" });
      await expect(service.assessmentNote(runId, eventId))
        .rejects.toMatchObject({ code: "content_unavailable" });
    }
  );

  it("fails closed on invalid decoders and forbidden truncation for every artifact role", async () => {
    const setup = await fixture();
    setup.createRun("invalid-evidence", "standard");

    const native = await completedArtifact(
      setup.artifactRoot, "invalid-evidence", "native-payload", "application/json", "{"
    );
    await setup.repository.commitArtifactMetadata(native);
    setup.repository.appendEvent(trace("invalid-evidence", "invalid-native", 0, {
      nativePayload: { storage: "artifact", artifactId: native.id }
    }));

    const note = await completedArtifact(
      setup.artifactRoot,
      "invalid-evidence",
      "assessment-note",
      "text/plain; charset=utf-8",
      Buffer.from([0xff, 0xfe])
    );
    await setup.repository.updateAssessment({
      runId: "invalid-evidence",
      eventId: "invalid-note",
      receivedAt,
      verdict: "partial",
      taskCompleted: "uncertain",
      note: { state: "artifact", artifact: note }
    });

    const initialStatus = await completedArtifact(
      setup.artifactRoot,
      "invalid-evidence",
      "git-initial-status",
      "text/plain",
      Buffer.from([0xff])
    );
    const finalStatus = await completedArtifact(
      setup.artifactRoot,
      "invalid-evidence",
      "git-final-status",
      "text/plain",
      "? truncated.txt\n",
      { truncated: true, originalByteLength: 100 }
    );
    const diff = await completedArtifact(
      setup.artifactRoot,
      "invalid-evidence",
      "git-tracked-final-diff",
      "text/x-diff",
      Buffer.from([0xfe])
    );
    const diffCheck = await completedArtifact(
      setup.artifactRoot, "invalid-evidence", "git-diff-check", "application/json", "not-json"
    );
    const untracked = await completedArtifact(
      setup.artifactRoot, "invalid-evidence", "git-untracked-file-metadata", "application/json", "[{}]"
    );
    for (const artifact of [initialStatus, finalStatus, diff, diffCheck, untracked]) {
      await setup.repository.commitArtifactMetadata(artifact);
    }
    setup.repository.saveGitEvidence("invalid-evidence", {
      initialHead: "a".repeat(40),
      finalHead: "a".repeat(40),
      initialBranch: null,
      finalBranch: null,
      initialStatus: { state: "artifact", artifactId: initialStatus.id },
      finalStatus: { state: "artifact", artifactId: finalStatus.id },
      trackedFinalDiff: { state: "artifact", artifactId: diff.id },
      diffCheck: { state: "artifact", artifactId: diffCheck.id },
      diffCheckPassed: true,
      untrackedMetadata: { state: "artifact", artifactId: untracked.id },
      headChanged: false,
      branchChanged: false,
      capturedAt: 2
    });
    setup.database.close();

    const service = createEvidenceService({
      databasePath: setup.databasePath,
      artifactRoot: setup.artifactRoot
    });
    for (const read of [
      () => service.eventNative("invalid-evidence", "invalid-native"),
      () => service.assessmentNote("invalid-evidence", "invalid-note"),
      () => service.gitStatus("invalid-evidence", "initial"),
      () => service.gitStatus("invalid-evidence", "final"),
      () => service.gitDiff("invalid-evidence"),
      () => service.gitDiffCheck("invalid-evidence"),
      () => service.gitUntracked("invalid-evidence")
    ]) await expect(read()).rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it("reads both clean status phases when content addressing deduplicates their empty bytes", async () => {
    const setup = await fixture();
    setup.createRun("clean-status", "standard");
    const sharedStatus = await completedArtifact(
      setup.artifactRoot, "clean-status", "git-initial-status", "text/plain", ""
    );
    const diffCheck = await completedArtifact(
      setup.artifactRoot,
      "clean-status",
      "git-diff-check",
      "application/json",
      JSON.stringify({ passed: true, output: "" })
    );
    await setup.repository.commitArtifactMetadata(sharedStatus);
    await setup.repository.commitArtifactMetadata(diffCheck);
    setup.repository.saveGitEvidence("clean-status", {
      initialHead: "a".repeat(40),
      finalHead: "a".repeat(40),
      initialBranch: "main",
      finalBranch: "main",
      initialStatus: { state: "artifact", artifactId: sharedStatus.id },
      finalStatus: { state: "artifact", artifactId: sharedStatus.id },
      trackedFinalDiff: { state: "absent" },
      diffCheck: { state: "artifact", artifactId: diffCheck.id },
      diffCheckPassed: true,
      untrackedMetadata: { state: "absent" },
      headChanged: false,
      branchChanged: false,
      capturedAt: 2
    });
    setup.database.close();

    const service = createEvidenceService({
      databasePath: setup.databasePath,
      artifactRoot: setup.artifactRoot
    });
    await expect(service.gitStatus("clean-status", "initial")).resolves.toEqual({
      schemaVersion: 1, kind: "status", entries: []
    });
    await expect(service.gitStatus("clean-status", "final")).resolves.toEqual({
      schemaVersion: 1, kind: "status", entries: []
    });
  });

  it("maps a structured-diff decoder bound failure to the stable binding error", async () => {
    const setup = await fixture();
    setup.createRun("bounded-diff", "standard");
    const initialStatus = await completedArtifact(
      setup.artifactRoot, "bounded-diff", "git-initial-status", "text/plain", ""
    );
    const finalStatus = await completedArtifact(
      setup.artifactRoot, "bounded-diff", "git-final-status", "text/plain", "? changed.txt\n"
    );
    const diff = await completedArtifact(
      setup.artifactRoot,
      "bounded-diff",
      "git-tracked-final-diff",
      "text/x-diff",
      "malformed\n".repeat(1_001)
    );
    const diffCheck = await completedArtifact(
      setup.artifactRoot,
      "bounded-diff",
      "git-diff-check",
      "application/json",
      JSON.stringify({ passed: true, output: "" })
    );
    for (const artifact of [initialStatus, finalStatus, diff, diffCheck]) {
      await setup.repository.commitArtifactMetadata(artifact);
    }
    setup.repository.saveGitEvidence("bounded-diff", {
      initialHead: "a".repeat(40), finalHead: "a".repeat(40),
      initialBranch: "main", finalBranch: "main",
      initialStatus: { state: "artifact", artifactId: initialStatus.id },
      finalStatus: { state: "artifact", artifactId: finalStatus.id },
      trackedFinalDiff: { state: "artifact", artifactId: diff.id },
      diffCheck: { state: "artifact", artifactId: diffCheck.id },
      diffCheckPassed: true,
      untrackedMetadata: { state: "absent" },
      headChanged: false, branchChanged: false, capturedAt: 2
    });
    setup.database.close();

    const service = createEvidenceService({
      databasePath: setup.databasePath,
      artifactRoot: setup.artifactRoot
    });
    await expect(service.gitDiff("bounded-diff"))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });
});
