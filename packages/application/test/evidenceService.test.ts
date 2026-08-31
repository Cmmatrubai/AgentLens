import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CapturePolicy, CompletedArtifact, TraceEventV1 } from "@agentlens/core";
import { RunRepository, openDatabase } from "@agentlens/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

const artifactOpenRace = vi.hoisted(() => ({
  beforeOpen: null as null | ((path: string) => Promise<void>)
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const beforeOpen = artifactOpenRace.beforeOpen;
      artifactOpenRace.beforeOpen = null;
      if (beforeOpen !== null) await beforeOpen(String(args[0]));
      return actual.open(...args);
    }
  };
});

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

type ArtifactEvidenceRoute = "native" | "note" | "diff" | "status" | "diff-check" | "untracked";

const artifactRouteKinds: Readonly<Record<ArtifactEvidenceRoute, string>> = {
  native: "native-payload",
  note: "assessment-note",
  diff: "git-tracked-final-diff",
  status: "git-initial-status",
  "diff-check": "git-diff-check",
  untracked: "git-untracked-file-metadata"
};

const artifactRouteMedia: Readonly<Record<ArtifactEvidenceRoute, string>> = {
  native: "application/json",
  note: "text/plain; charset=utf-8",
  diff: "text/x-diff",
  status: "text/plain",
  "diff-check": "application/json",
  untracked: "application/json"
};

const artifactRouteLimits: Readonly<Record<ArtifactEvidenceRoute, number>> = {
  native: 256 * 1024,
  note: 16 * 1024,
  diff: 2 * 1024 * 1024,
  status: 256 * 1024,
  "diff-check": 256 * 1024,
  untracked: 512 * 1024
};

const artifactRoutes = Object.freeze(
  Object.keys(artifactRouteKinds) as ArtifactEvidenceRoute[]
);

const defaultRouteContent: Readonly<Record<ArtifactEvidenceRoute, string | Buffer>> = {
  native: JSON.stringify({ value: "matrix native" }),
  note: "matrix note",
  diff: "diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-old\n+new\n",
  status: "",
  "diff-check": JSON.stringify({ passed: true, output: "matrix check" }),
  untracked: JSON.stringify([{ path: "matrix.txt", type: "file", size: 12 }])
};

type MatrixFixture = Awaited<ReturnType<typeof artifactEvidenceFixture>>;

async function unsafeDatabase(databasePath: string) {
  const { createRequire } = await import("node:module");
  const storageRequire = createRequire(new URL("../../storage/package.json", import.meta.url));
  const Database = storageRequire("better-sqlite3") as new (path: string) => {
    pragma(value: string): unknown;
    prepare(sql: string): { run(...parameters: unknown[]): unknown };
    close(): void;
  };
  return new Database(databasePath);
}

async function artifactEvidenceFixture(
  targetRoute: ArtifactEvidenceRoute,
  options: Readonly<{
    targetContent?: string | Buffer;
    targetOverrides?: Partial<CompletedArtifact>;
    nativeSource?: TraceEventV1["source"];
  }> = {}
) {
  const setup = await fixture();
  const runId = "matrix-run";
  setup.createRun(runId, "standard");
  const make = async (route: ArtifactEvidenceRoute, content = defaultRouteContent[route]) =>
    completedArtifact(
      setup.artifactRoot,
      runId,
      artifactRouteKinds[route],
      artifactRouteMedia[route],
      route === targetRoute && options.targetContent !== undefined ? options.targetContent : content,
      route === targetRoute ? options.targetOverrides : undefined
    );

  const native = await make("native");
  await setup.repository.commitArtifactMetadata(native);
  setup.repository.appendEvent(trace(runId, "matrix-native", 0, {
    ...(options.nativeSource === undefined ? {} : { source: options.nativeSource }),
    nativePayload: { storage: "artifact", artifactId: native.id }
  }));
  setup.repository.appendEvent(trace(runId, "matrix-message", 1, {
    nativePayload: { storage: "omitted", reason: "not_captured" }
  }));

  const note = await make("note");
  await setup.repository.updateAssessment({
    expectedRevision: { state: "unconditional" },
    runId,
    eventId: "matrix-note",
    receivedAt,
    verdict: "partial",
    taskCompleted: "uncertain",
    note: { state: "artifact", artifact: note }
  });

  const status = await make("status");
  const finalStatus = await completedArtifact(
    setup.artifactRoot, runId, "git-final-status", "text/plain", "? final-matrix.txt\n"
  );
  const diff = await make("diff");
  const diffCheck = await make("diff-check");
  const untracked = await make("untracked");
  for (const artifact of [status, finalStatus, diff, diffCheck, untracked]) {
    await setup.repository.commitArtifactMetadata(artifact);
  }
  setup.repository.saveGitEvidence(runId, {
    initialHead: "a".repeat(40),
    finalHead: "b".repeat(40),
    initialBranch: "main",
    finalBranch: "main",
    initialStatus: { state: "artifact", artifactId: status.id },
    finalStatus: { state: "artifact", artifactId: finalStatus.id },
    trackedFinalDiff: { state: "artifact", artifactId: diff.id },
    diffCheck: { state: "artifact", artifactId: diffCheck.id },
    diffCheckPassed: true,
    untrackedMetadata: { state: "artifact", artifactId: untracked.id },
    headChanged: true,
    branchChanged: false,
    capturedAt: 2
  });
  setup.createRun("matrix-other", "standard");
  const otherMediaType = targetRoute === "native" && options.targetOverrides?.mediaType !== undefined
    ? options.targetOverrides.mediaType
    : artifactRouteMedia[targetRoute];
  const otherArtifact = await completedArtifact(
    setup.artifactRoot,
    "matrix-other",
    artifactRouteKinds[targetRoute],
    otherMediaType,
    otherMediaType === "application/json"
      ? JSON.stringify({ other: targetRoute })
      : `other ${targetRoute}\n`
  );
  await setup.repository.commitArtifactMetadata(otherArtifact);
  setup.repository.appendEvent(trace("matrix-other", "matrix-other-event", 0, {
    ...(targetRoute === "native"
      ? { nativePayload: { storage: "artifact" as const, artifactId: otherArtifact.id } }
      : {})
  }));
  setup.database.close();
  return {
    ...setup,
    runId,
    artifacts: { native, note, diff, status, "diff-check": diffCheck, untracked },
    otherArtifact
  };
}

function matrixService(setup: MatrixFixture) {
  return createEvidenceService({ databasePath: setup.databasePath, artifactRoot: setup.artifactRoot });
}

function readMatrixRoute(
  setup: MatrixFixture,
  route: ArtifactEvidenceRoute,
  runId = setup.runId,
  eventId?: string
) {
  const service = matrixService(setup);
  switch (route) {
    case "native":
      return service.eventNative(runId, eventId ?? "matrix-native");
    case "note":
      return service.assessmentNote(runId, eventId ?? "matrix-note");
    case "diff":
      return service.gitDiff(runId);
    case "status":
      return service.gitStatus(runId, "initial");
    case "diff-check":
      return service.gitDiffCheck(runId);
    case "untracked":
      return service.gitUntracked(runId);
  }
}

async function updateArtifact(
  setup: MatrixFixture,
  route: ArtifactEvidenceRoute,
  assignment: string,
  value: unknown
): Promise<void> {
  const database = await unsafeDatabase(setup.databasePath);
  database.prepare(`UPDATE artifacts SET ${assignment} = ? WHERE run_id = ? AND id = ?`)
    .run(value, setup.runId, setup.artifacts[route].id);
  database.close();
}

const gitReferenceColumn: Readonly<Partial<Record<ArtifactEvidenceRoute, string>>> = {
  diff: "tracked_final_diff_artifact_id",
  status: "initial_status_artifact_id",
  "diff-check": "diff_check_artifact_id",
  untracked: "untracked_metadata_artifact_id"
};

async function rebindRouteArtifact(
  setup: MatrixFixture,
  route: ArtifactEvidenceRoute,
  artifactId: string
): Promise<void> {
  const database = await unsafeDatabase(setup.databasePath);
  database.pragma("foreign_keys = OFF");
  if (route === "native") {
    database.prepare(`
      UPDATE events SET native_payload_artifact_id = ?
      WHERE run_id = ? AND id = 'matrix-native'
    `).run(artifactId, setup.runId);
  } else if (route === "note") {
    database.prepare(`
      UPDATE event_artifact_bindings SET artifact_id = ?
      WHERE run_id = ? AND event_id = 'matrix-note' AND role = 'assessment_note'
    `).run(artifactId, setup.runId);
  } else {
    database.prepare(`UPDATE git_evidence SET ${gitReferenceColumn[route]} = ? WHERE run_id = ?`)
      .run(artifactId, setup.runId);
  }
  database.close();
}

async function replaceAssessmentRole(setup: MatrixFixture, role: string): Promise<void> {
  const database = await unsafeDatabase(setup.databasePath);
  database.pragma("ignore_check_constraints = ON");
  database.prepare(`
    UPDATE event_artifact_bindings SET role = ?
    WHERE run_id = ? AND event_id = 'matrix-note' AND role = 'assessment_note'
  `).run(role, setup.runId);
  database.close();
}

async function updateRunCapturePolicy(setup: MatrixFixture, capturePolicy: CapturePolicy): Promise<void> {
  const database = await unsafeDatabase(setup.databasePath);
  database.prepare("UPDATE runs SET capture_policy = ? WHERE id = ?")
    .run(capturePolicy, setup.runId);
  database.close();
}

function physicalRouteContent(route: ArtifactEvidenceRoute): string | Buffer {
  if (route === "status") {
    return `1 .M N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} matrix.ts\n`;
  }
  return defaultRouteContent[route];
}

function invalidRouteContent(route: ArtifactEvidenceRoute): string | Buffer {
  switch (route) {
    case "native":
    case "diff-check":
      return "{";
    case "untracked":
      return "[{}]";
    case "note":
    case "diff":
    case "status":
      return Buffer.from([0xff, 0xfe]);
  }
}

function oversizedRouteContent(route: ArtifactEvidenceRoute): string | Buffer {
  const limit = artifactRouteLimits[route];
  switch (route) {
    case "native":
      return JSON.stringify({ value: "x".repeat(limit) });
    case "diff-check":
      return JSON.stringify({ passed: true, output: "x".repeat(limit) });
    case "untracked":
      return JSON.stringify([{ path: "x".repeat(limit), type: "file", size: 1 }]);
    case "note":
    case "diff":
    case "status":
      return "x".repeat(limit + 1);
  }
}

function responseLimitRouteContent(route: ArtifactEvidenceRoute): string {
  const limit = artifactRouteLimits[route];
  switch (route) {
    case "native":
      return JSON.stringify({ value: "x".repeat(limit - 32) });
    case "note":
      return "x".repeat(limit);
    case "diff": {
      const lines = Array.from({ length: 45_000 }, () => "+x").join("\n");
      return [
        "diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -0,0 +1,45000 @@", lines, ""
      ].join("\n");
    }
    case "status":
      return Array.from({ length: 10_000 }, (_, index) => `? file-${index}.txt`).join("\n") + "\n";
    case "diff-check":
      return JSON.stringify({ passed: true, output: "x".repeat(limit - 40) });
    case "untracked":
      return JSON.stringify(Array.from({ length: 9_070 }, (_, index) => ({
        path: `file-${index}-${"x".repeat(index === 0 ? 410 : 10)}`,
        type: "file",
        size: index
      })));
  }
}

afterEach(async () => {
  artifactOpenRace.beforeOpen = null;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Task 7.7 evidence projection", () => {
  it("prefers bounded terminal command output while retaining command fallback", async () => {
    const setup = await fixture();
    setup.createRun("command-content", "standard");
    setup.repository.appendEvent(trace("command-content", "command-terminal", 0, {
      kind: "command",
      normalizedPayload: {
        commandEvidence: { state: "available", redactedCommand: "pnpm test" },
        aggregatedOutput: "15 tests passed",
        exitCode: 0
      }
    }));
    setup.repository.appendEvent(trace("command-content", "command-started", 1, {
      kind: "command",
      status: "in_progress",
      normalizedPayload: {
        commandEvidence: { state: "available", redactedCommand: "pnpm test" }
      }
    }));
    setup.database.close();

    const service = createEvidenceService({
      databasePath: setup.databasePath,
      artifactRoot: setup.artifactRoot
    });
    await expect(service.eventContent("command-content", "command-terminal")).resolves.toEqual({
      schemaVersion: 1,
      eventId: "command-terminal",
      content: { kind: "command_output", output: "15 tests passed" }
    });
    await expect(service.eventContent("command-content", "command-started")).resolves.toEqual({
      schemaVersion: 1,
      eventId: "command-started",
      content: { kind: "command", command: "pnpm test", exitCode: null }
    });
  });

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

  it.each([
    ["old", ["diff --git a/a.ts b/a.ts", "+++ b/a.ts"]],
    ["new", ["diff --git a/a.ts b/a.ts", "--- a/a.ts"]]
  ] as const)("marks a text hunk missing its %s file header malformed", (_missing, headers) => {
    const parsed = parseGitDiff([
      ...headers,
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), false);
    expect(parsed.malformed).toBe(true);
  });

  it.each([
    ["under-consumed old", "@@ -1,2 +1 @@", ["-old", "+new"]],
    ["under-consumed new", "@@ -1 +1,2 @@", ["-old", "+new"]],
    ["over-consumed old", "@@ -1 +0,0 @@", ["-one", "-two"]],
    ["over-consumed new", "@@ -0,0 +1 @@", ["+one", "+two"]]
  ] as const)("marks %s hunk counts malformed", (_name, hunk, lines) => {
    const parsed = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", hunk, ...lines, ""
    ].join("\n"), false);
    expect(parsed.malformed).toBe(true);
    if (_name.startsWith("over-consumed")) {
      expect(parsed.files[0]?.hunks[0]?.lines).toHaveLength(1);
    }
  });

  it.each([
    ["old start", "@@ -9007199254740992 +1 @@"],
    ["new start", "@@ -1 +9007199254740992 @@"],
    ["old count", "@@ -1,9007199254740992 +1 @@"],
    ["new count", "@@ -1 +1,9007199254740992 @@"]
  ] as const)("rejects an unsafe hunk %s without appending the hunk", (_component, header) => {
    const parsed = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      header, "-old", "+new", ""
    ].join("\n"), false);
    expect(parsed.malformed).toBe(true);
    expect(parsed.files[0]?.hunks).toEqual([]);
  });

  it("accepts exact MAX_SAFE_INTEGER hunk coordinates and counts", () => {
    const maximum = "9007199254740991";
    const coordinates = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      `@@ -${maximum} +${maximum} @@`, "-old", "+new", ""
    ].join("\n"), false);
    expect(coordinates).toMatchObject({
      malformed: false,
      files: [{ hunks: [{
        oldStart: Number.MAX_SAFE_INTEGER,
        newStart: Number.MAX_SAFE_INTEGER,
        lines: [
          { type: "delete", oldLineNumber: Number.MAX_SAFE_INTEGER },
          { type: "add", newLineNumber: Number.MAX_SAFE_INTEGER }
        ]
      }] }]
    });

    const counts = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      `@@ -1,${maximum} +1,${maximum} @@`, ""
    ].join("\n"), true);
    expect(counts).toMatchObject({
      truncated: true,
      malformed: false,
      files: [{ hunks: [{
        oldCount: Number.MAX_SAFE_INTEGER,
        newCount: Number.MAX_SAFE_INTEGER
      }] }]
    });
  });

  it("fails closed before emitting coordinates whose arithmetic exceeds MAX_SAFE_INTEGER", () => {
    const maximum = "9007199254740991";
    const parsed = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      `@@ -${maximum},2 +${maximum},2 @@`,
      "-old-one", "+new-one", "-old-two", "+new-two", ""
    ].join("\n"), false);
    expect(parsed.malformed).toBe(true);
    expect(parsed.files[0]?.hunks[0]?.lines).toEqual([
      { type: "delete", oldLineNumber: Number.MAX_SAFE_INTEGER, newLineNumber: null, text: "old-one" },
      { type: "add", oldLineNumber: null, newLineNumber: Number.MAX_SAFE_INTEGER, text: "new-one" }
    ]);
    for (const line of parsed.files[0]?.hunks[0]?.lines ?? []) {
      if (line.oldLineNumber !== null) expect(Number.isSafeInteger(line.oldLineNumber)).toBe(true);
      if (line.newLineNumber !== null) expect(Number.isSafeInteger(line.newLineNumber)).toBe(true);
    }
  });

  it("contains an unsafe hunk and resumes at a later valid hunk", () => {
    const parsed = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      "@@ -9007199254740992 +1 @@", "-ignored", "+ignored",
      "@@ -2 +2 @@", "-old", "+new", ""
    ].join("\n"), false);
    expect(parsed.malformed).toBe(true);
    expect(parsed.files[0]?.hunks).toHaveLength(1);
    expect(parsed.files[0]?.hunks[0]).toMatchObject({
      oldStart: 2,
      newStart: 2,
      lines: [
        { type: "delete", oldLineNumber: 2, text: "old" },
        { type: "add", newLineNumber: 2, text: "new" }
      ]
    });
  });

  it("does not excuse an earlier incomplete hunk when only the final hunk is truncated", () => {
    const parsed = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      "@@ -1,2 +1 @@", "-old", "+new",
      "@@ -5,2 +5,2 @@", " context",
      ""
    ].join("\n"), true);
    expect(parsed).toMatchObject({ truncated: true, malformed: true });
  });

  it.each([
    ["addition", "@@ -0,0 +1,2 @@", ["+one", "+two"], [1, 2]],
    ["deletion", "@@ -1,2 +0,0 @@", ["-one", "-two"], [1, 2]]
  ] as const)("accepts valid zero-count %s hunks", (kind, hunk, lines, expectedNumbers) => {
    const parsed = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", hunk, ...lines, ""
    ].join("\n"), false);
    expect(parsed.malformed).toBe(false);
    expect(parsed.files[0]?.hunks[0]?.lines.map((line) =>
      kind === "addition" ? line.newLineNumber : line.oldLineNumber
    )).toEqual(expectedNumbers);
  });

  it("allows only an incomplete final hunk when the artifact is explicitly truncated", () => {
    const text = [
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      "@@ -1,2 +1,2 @@", " context", ""
    ].join("\n");
    expect(parseGitDiff(text, true)).toMatchObject({ truncated: true, malformed: false });
    expect(parseGitDiff(text, false)).toMatchObject({ truncated: false, malformed: true });
  });

  it("parses header-looking deleted and added content inside an active hunk", () => {
    const parsed = parseGitDiff([
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
      "@@ -1 +1 @@", "--- old marker", "+++ new marker", ""
    ].join("\n"), false);
    expect(parsed).toMatchObject({
      malformed: false,
      files: [{
        oldPath: "a.ts",
        newPath: "a.ts",
        hunks: [{
          lines: [
            { type: "delete", oldLineNumber: 1, newLineNumber: null, text: "-- old marker" },
            { type: "add", oldLineNumber: null, newLineNumber: 1, text: "++ new marker" }
          ]
        }]
      }]
    });
  });

  it("keeps a bounded Git binary patch block as opaque binary metadata", () => {
    const parsed = parseGitDiff([
      "diff --git a/blob.bin b/blob.bin",
      "new file mode 100644",
      "index 0000000..0123456",
      "GIT binary patch",
      "literal 3",
      "KcmZQzU|?VbYybcN",
      "literal 0",
      "HcmV?d00001",
      ""
    ].join("\n"), false);
    expect(parsed).toMatchObject({
      malformed: false,
      files: [{
        oldPath: "blob.bin",
        newPath: "blob.bin",
        hunks: [],
        metadata: [
          { type: "mode", text: "new file mode 100644" },
          { type: "index", text: "index 0000000..0123456" },
          { type: "binary", text: "GIT binary patch" },
          { type: "binary", text: "literal 3" },
          { type: "binary", text: "KcmZQzU|?VbYybcN" },
          { type: "binary", text: "literal 0" },
          { type: "binary", text: "HcmV?d00001" }
        ]
      }]
    });
  });

  it.each([
    ["an unpaired old header", ["--- a/a.ts"]],
    ["an unpaired new header", ["+++ b/a.ts"]],
    ["reversed text headers", ["+++ b/a.ts", "--- a/a.ts"]],
    ["duplicate old headers", ["--- a/a.ts", "--- a/a.ts", "+++ b/a.ts"]]
  ] as const)("marks a non-truncated file with %s malformed", (_name, headers) => {
    const parsed = parseGitDiff(["diff --git a/a.ts b/a.ts", ...headers, ""].join("\n"), false);
    expect(parsed.malformed).toBe(true);
  });

  it("bounds an oversized Git binary patch metadata block as malformed", () => {
    const payload = Array.from({ length: 1_001 }, (_, index) => `opaque-${index}`);
    const parsed = parseGitDiff([
      "diff --git a/blob.bin b/blob.bin", "GIT binary patch", ...payload, ""
    ].join("\n"), false);
    expect(parsed.malformed).toBe(true);
    expect(parsed.files[0]?.metadata).toHaveLength(1_000);
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
      expectedRevision: { state: "unconditional" },
      runId: "run-evidence", eventId: "assessment-old", receivedAt,
      verdict: "partial", taskCompleted: "uncertain",
      note: { state: "artifact", artifact: olderNote }
    });
    await setup.repository.updateAssessment({
      expectedRevision: { state: "unconditional" },
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
      expectedRevision: { state: "unconditional" },
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

  it("maps malformed and over-limit standard normalized content to content unavailable", async () => {
    const setup = await fixture();
    setup.createRun("invalid-content", "standard");
    setup.repository.appendEvent(trace("invalid-content", "malformed-content", 0));
    setup.repository.appendEvent(trace("invalid-content", "over-limit-content", 1, {
      normalizedPayload: { text: "x".repeat(256 * 1024 + 1) }
    }));
    setup.database.close();
    const database = await unsafeDatabase(setup.databasePath);
    database.prepare(`
      UPDATE events SET normalized_payload_json = '{'
      WHERE run_id = 'invalid-content' AND id = 'malformed-content'
    `).run();
    database.close();

    const service = createEvidenceService({
      databasePath: setup.databasePath,
      artifactRoot: setup.artifactRoot
    });
    await expect(service.eventContent("invalid-content", "malformed-content"))
      .rejects.toMatchObject({ code: "content_unavailable" });
    await expect(service.eventContent("invalid-content", "over-limit-content"))
      .rejects.toMatchObject({ code: "content_unavailable" });
  });
});

describe("Task 7.7 bound artifact route matrix", () => {
  it.each(artifactRoutes)("reads valid authoritative %s evidence", async (route) => {
    const setup = await artifactEvidenceFixture(route);
    await expect(readMatrixRoute(setup, route)).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it.each(artifactRoutes)("rejects a cross-run artifact rebound into the %s role", async (route) => {
    const setup = await artifactEvidenceFixture(route);
    await rebindRouteArtifact(setup, route, setup.otherArtifact.id);
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects a same-run artifact from the wrong %s evidence role", async (route) => {
    const setup = await artifactEvidenceFixture(route);
    const wrongRoleArtifact = route === "native" ? setup.artifacts.note : setup.artifacts.native;
    await rebindRouteArtifact(setup, route, wrongRoleArtifact.id);
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(["native", "note"] as const)("rejects the wrong event for %s evidence", async (route) => {
    const setup = await artifactEvidenceFixture(route);
    await expect(readMatrixRoute(setup, route, setup.runId, "matrix-message"))
      .rejects.toMatchObject({
        code: route === "native" ? "content_unavailable" : "evidence_binding_mismatch"
      });
  });

  it("rejects an assessment artifact bound under the wrong role", async () => {
    const setup = await artifactEvidenceFixture("note");
    await replaceAssessmentRole(setup, "future_note_role");
    await expect(readMatrixRoute(setup, "note"))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("checks capture policy before touching corrupt %s bytes", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: physicalRouteContent(route) });
    await updateRunCapturePolicy(setup, "metadata-only");
    await rm(setup.artifacts[route].path);
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "content_unavailable" });
  });

  it.each(artifactRoutes)("rejects wrong %s artifact kind metadata", async (route) => {
    const setup = await artifactEvidenceFixture(route);
    await updateArtifact(setup, route, "kind", "wrong-evidence-kind");
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects wrong %s artifact media metadata", async (route) => {
    const setup = await artifactEvidenceFixture(route);
    await updateArtifact(setup, route, "media_type", "application/octet-stream");
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects a non-canonical %s artifact path", async (route) => {
    const setup = await artifactEvidenceFixture(route);
    await updateArtifact(setup, route, "path", join(setup.root, `outside-${route}`));
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects a %s artifact replaced by a symlink", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: physicalRouteContent(route) });
    const artifact = setup.artifacts[route];
    const bytes = await readFile(artifact.path);
    const externalPath = join(setup.root, `external-${route}`);
    await writeFile(externalPath, bytes, { mode: 0o600 });
    await rm(artifact.path);
    await symlink(externalPath, artifact.path);
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects a %s artifact inode swap between validation and open", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: physicalRouteContent(route) });
    const artifact = setup.artifacts[route];
    const replacement = `${artifact.path}.replacement`;
    await writeFile(replacement, await readFile(artifact.path), { mode: 0o600 });
    artifactOpenRace.beforeOpen = async (openedPath) => {
      expect(openedPath).toBe(artifact.path);
      await rename(replacement, artifact.path);
    };
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects a %s artifact with a changed byte length", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: physicalRouteContent(route) });
    const artifact = setup.artifacts[route];
    const bytes = await readFile(artifact.path);
    await writeFile(artifact.path, Buffer.concat([bytes, Buffer.from("x")]), { mode: 0o600 });
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects a %s artifact with a changed digest", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: physicalRouteContent(route) });
    const artifact = setup.artifacts[route];
    const bytes = await readFile(artifact.path);
    const changed = Buffer.from(bytes.length === 0 ? "x" : bytes);
    if (bytes.length === 0) {
      await updateArtifact(setup, route, "byte_length", 1);
      await updateArtifact(setup, route, "original_byte_length", 1);
    } else {
      changed[0] = changed[0] === 0x78 ? 0x79 : 0x78;
    }
    await writeFile(artifact.path, changed, { mode: 0o600 });
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects non-owner-only permissions for %s evidence", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: physicalRouteContent(route) });
    await chmod(setup.artifacts[route].path, 0o644);
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(["native", "diff"] as const)("allows declared truncation for %s evidence", async (route) => {
    const setup = await artifactEvidenceFixture(route, {
      targetOverrides: { truncated: true, originalByteLength: 9_999_999 }
    });
    await expect(readMatrixRoute(setup, route)).resolves.toMatchObject(
      route === "native" ? { content: { truncated: true } } : { truncated: true }
    );
  });

  it.each(["note", "status", "diff-check", "untracked"] as const)(
    "rejects forbidden truncation for %s evidence",
    async (route) => {
      const setup = await artifactEvidenceFixture(route, {
        targetOverrides: { truncated: true, originalByteLength: 9_999_999 }
      });
      await expect(readMatrixRoute(setup, route))
        .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
    }
  );

  it.each(artifactRoutes)("rejects invalid UTF-8 or JSON for %s evidence", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: invalidRouteContent(route) });
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects %s source metadata over the route limit", async (route) => {
    const setup = await artifactEvidenceFixture(route, { targetContent: oversizedRouteContent(route) });
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(artifactRoutes)("rejects a %s projection over the response limit", async (route) => {
    const content = responseLimitRouteContent(route);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(artifactRouteLimits[route]);
    const setup = await artifactEvidenceFixture(route, { targetContent: content });
    await expect(readMatrixRoute(setup, route))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });
});

describe("Task 7.7 native UTF-8 text evidence", () => {
  const textSource = {
    provider: "codex-exec" as const,
    sessionId: "TEXT_SOURCE_SESSION",
    itemId: "TEXT_SOURCE_ITEM",
    eventType: "item.completed"
  };
  const textMediaType = "text/plain; charset=utf-8";

  it.each([
    ["complete", false],
    ["truncated", true]
  ] as const)("reads and source-masks %s native text evidence", async (_name, truncated) => {
    const setup = await artifactEvidenceFixture("native", {
      targetContent: "before TEXT_SOURCE_SESSION nested-TEXT_SOURCE_ITEM after inspectable text",
      targetOverrides: {
        mediaType: textMediaType,
        ...(truncated ? { truncated: true, originalByteLength: 1_000_000 } : {})
      },
      nativeSource: textSource
    });
    const result = await readMatrixRoute(setup, "native");
    expect(result).toEqual({
      schemaVersion: 1,
      eventId: "matrix-native",
      content: {
        format: "text",
        text: "before [[AGENTLENS_RESPONSE_REDACTED:SESSION_ID]] nested-[[AGENTLENS_RESPONSE_REDACTED:ITEM_ID]] after inspectable text",
        truncated
      }
    });
  });

  it("rejects invalid UTF-8 native text", async () => {
    const setup = await artifactEvidenceFixture("native", {
      targetContent: Buffer.from([0xff, 0xfe]),
      targetOverrides: { mediaType: textMediaType },
      nativeSource: textSource
    });
    await expect(readMatrixRoute(setup, "native"))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it("rejects native text media outside the exact allowlist", async () => {
    const setup = await artifactEvidenceFixture("native", {
      targetContent: "inspectable text",
      targetOverrides: { mediaType: "text/plain" },
      nativeSource: textSource
    });
    await expect(readMatrixRoute(setup, "native"))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });

  it.each(["cross-run", "wrong-role"] as const)(
    "rejects %s rebinding before reading native text",
    async (tamper) => {
      const setup = await artifactEvidenceFixture("native", {
        targetContent: "inspectable text",
        targetOverrides: { mediaType: textMediaType },
        nativeSource: textSource
      });
      await rebindRouteArtifact(
        setup,
        "native",
        tamper === "cross-run" ? setup.otherArtifact.id : setup.artifacts.note.id
      );
      await expect(readMatrixRoute(setup, "native"))
        .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
    }
  );

  it("rejects native text whose source masking expands beyond the response bound", async () => {
    const setup = await artifactEvidenceFixture("native", {
      targetContent: "SRC".repeat(7_000),
      targetOverrides: { mediaType: textMediaType },
      nativeSource: { provider: "codex-exec", sessionId: "SRC" }
    });
    await expect(readMatrixRoute(setup, "native"))
      .rejects.toMatchObject({ code: "evidence_binding_mismatch" });
  });
});
