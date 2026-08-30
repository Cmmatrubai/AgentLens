import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { codexExecCapabilities, type TraceEventV1 } from "@agentlens/core";
import type { CurrentAssessment, RunDetail, StoredArtifact } from "@agentlens/storage";
import { projectRunSummary } from "../src/projectRunSummary.js";

const roots: string[] = [];

function detail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    run: {
      id: "summary-run",
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
      startedAt: 1_000,
      endedAt: 1_100,
      childPid: 123,
      exitCode: 0,
      terminatingSignal: null,
      providerTerminalKind: "completed",
      terminalReason: "fixture",
      contradictionCodes: []
    },
    ownership: null,
    events: [],
    artifacts: [],
    redactionAudits: [],
    gitEvidence: null,
    ...overrides
  };
}

function assessment(state: "projected" | "explicit"): CurrentAssessment {
  return state === "projected"
    ? {
        runId: "summary-run",
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        state: "projected",
        provenance: null,
        currentEventId: null,
        reviewedAt: null,
        updatedAt: null
      }
    : {
        runId: "summary-run",
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        state: "explicit",
        provenance: "human",
        currentEventId: "assessment-event",
        reviewedAt: 1_050,
        updatedAt: 1_050
      };
}

function repository(current: CurrentAssessment) {
  return { getCurrentAssessment: () => current };
}

async function untrackedArtifact(
  artifactRoot: string,
  value: unknown
): Promise<StoredArtifact> {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  const id = createHash("sha256").update(bytes).digest("hex");
  const path = join(artifactRoot, id.slice(0, 2), id);
  await mkdir(join(artifactRoot, id.slice(0, 2)), { recursive: true });
  await writeFile(path, bytes);
  return {
    id,
    runId: "summary-run",
    kind: "git-untracked-file-metadata",
    mediaType: "application/json",
    path,
    sha256: id,
    byteLength: bytes.byteLength,
    redactionState: "redacted",
    truncated: false,
    originalByteLength: bytes.byteLength,
    createdAt: 1
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("projectRunSummary", () => {
  it("maps projected storage assessment to the null-provenance frozen projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-project-summary-"));
    roots.push(root);
    const summary = await projectRunSummary(
      detail(),
      repository(assessment("projected")),
      join(root, "artifacts", "sha256")
    );

    expect(summary.assessment).toMatchObject({
      verdict: "unreviewed",
      state: "projected",
      provenance: null,
      currentEventId: null
    });
    expect(summary.likelyTests.state).toBe("none_detected");
    expect(summary.providerCapabilityLimitations.value).toEqual(expect.arrayContaining([
      { capability: "file_reads", availability: codexExecCapabilities.fileReads }
    ]));
  });

  it("preserves explicit unreviewed as human evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-project-summary-"));
    roots.push(root);
    const summary = await projectRunSummary(
      detail(),
      repository(assessment("explicit")),
      join(root, "artifacts", "sha256")
    );

    expect(summary.assessment).toMatchObject({
      verdict: "unreviewed",
      state: "explicit",
      provenance: "human",
      currentEventId: "assessment-event"
    });
  });

  it("counts only a complete validated untracked metadata array and never exposes paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-project-summary-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "sha256");
    const artifact = await untrackedArtifact(artifactRoot, [
      { path: "private-one", type: "file", size: 1 },
      { path: "private-two", type: "symlink", size: 0 }
    ]);
    const summary = await projectRunSummary(detail({
      artifacts: [artifact],
      gitEvidence: {
        runId: "summary-run",
        initialHead: "a",
        finalHead: "a",
        initialBranch: "main",
        finalBranch: "main",
        initialStatus: { state: "omitted", reason: "legacy-unspecified" },
        finalStatus: { state: "omitted", reason: "legacy-unspecified" },
        trackedFinalDiff: { state: "absent" },
        diffCheck: { state: "omitted", reason: "legacy-unspecified" },
        diffCheckPassed: true,
        untrackedMetadata: { state: "artifact", artifactId: artifact.id },
        headChanged: false,
        branchChanged: false,
        capturedAt: 1
      }
    }), repository(assessment("projected")), artifactRoot);

    expect(summary.untrackedFiles).toMatchObject({
      value: 2,
      availability: "available",
      provenance: "git_recovered",
      supportingArtifactIds: [artifact.id]
    });
    expect(JSON.stringify(summary)).not.toContain("private-one");
    expect(JSON.stringify(summary)).not.toContain("private-two");
  });

  it.each([
    { value: {}, label: "non-array" },
    { value: [{ path: 1, type: "file", size: 1 }], label: "path" },
    { value: [{ path: "x", type: "socket", size: 1 }], label: "type" },
    { value: [{ path: "x", type: "file", size: -1 }], label: "size" }
  ])("rejects malformed $label untracked metadata", async ({ value }) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-project-summary-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "sha256");
    const artifact = await untrackedArtifact(artifactRoot, value);
    const input = detail({
      artifacts: [artifact],
      gitEvidence: {
        runId: "summary-run",
        initialHead: "a",
        finalHead: "a",
        initialBranch: null,
        finalBranch: null,
        initialStatus: { state: "omitted", reason: "legacy-unspecified" },
        finalStatus: { state: "omitted", reason: "legacy-unspecified" },
        trackedFinalDiff: { state: "absent" },
        diffCheck: { state: "omitted", reason: "legacy-unspecified" },
        diffCheckPassed: true,
        untrackedMetadata: { state: "artifact", artifactId: artifact.id },
        headChanged: false,
        branchChanged: false,
        capturedAt: 1
      }
    });
    await expect(projectRunSummary(
      input,
      repository(assessment("projected")),
      artifactRoot
    )).rejects.toThrow(/untracked metadata/i);
  });

  it("retains failed-then-passed test history from chronological source evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-project-summary-"));
    roots.push(root);
    const event = (id: string, sequence: number, status: "failed" | "completed", exitCode: number): TraceEventV1 => ({
      id,
      runId: "summary-run",
      sequence,
      receivedAt: new Date(1_000 + sequence).toISOString(),
      kind: "command",
      status,
      provenance: "observed",
      source: { provider: "codex-exec", itemType: "command_execution", eventType: "item.completed" },
      relationships: [],
      summary: "fixture command",
      normalizedPayload: {
        command: "pnpm test",
        exitCode,
        commandEvidence: { state: "available", redactedCommand: "pnpm test" }
      }
    });
    const summary = await projectRunSummary(
      detail({ events: [event("failed-source", 1, "failed", 1), event("passed-source", 2, "completed", 0)] }),
      repository(assessment("projected")),
      join(root, "artifacts", "sha256")
    );

    expect(summary.likelyTests).toMatchObject({
      state: "detected",
      attempts: { latest: "passed", previousFailures: 1, total: 2 },
      durability: "incomplete",
      missingExpected: 4
    });
  });

  it("preserves capture-policy unavailability instead of classifying omitted commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-project-summary-"));
    roots.push(root);
    const omitted: TraceEventV1 = {
      id: "omitted-command",
      runId: "summary-run",
      sequence: 1,
      receivedAt: new Date(1_001).toISOString(),
      kind: "command",
      status: "completed",
      provenance: "observed",
      source: { provider: "codex-exec", itemType: "command_execution", eventType: "item.completed" },
      relationships: [],
      summary: "omitted command",
      normalizedPayload: {
        exitCode: 0,
        commandEvidence: { state: "omitted", reason: "metadata-only" }
      }
    };
    const summary = await projectRunSummary(
      detail({
        run: { ...detail().run, capturePolicy: "metadata-only" },
        events: [omitted]
      }),
      repository(assessment("projected")),
      join(root, "artifacts", "sha256")
    );

    expect(summary.likelyTests).toMatchObject({
      state: "unavailable_due_to_capture_policy",
      omittedTerminalCommands: 1
    });
  });

  it("rejects digest tampering through the untracked-metadata consumer", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-project-summary-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "sha256");
    const artifact = await untrackedArtifact(artifactRoot, [
      { path: "one", type: "file", size: 1 }
    ]);
    await writeFile(artifact.path, '[{"path":"two","type":"file","size":1}]', "utf8");
    const input = detail({
      artifacts: [artifact],
      gitEvidence: {
        runId: "summary-run",
        initialHead: "a",
        finalHead: "a",
        initialBranch: null,
        finalBranch: null,
        initialStatus: { state: "omitted", reason: "legacy-unspecified" },
        finalStatus: { state: "omitted", reason: "legacy-unspecified" },
        trackedFinalDiff: { state: "absent" },
        diffCheck: { state: "omitted", reason: "legacy-unspecified" },
        diffCheckPassed: true,
        untrackedMetadata: { state: "artifact", artifactId: artifact.id },
        headChanged: false,
        branchChanged: false,
        capturedAt: 1
      }
    });

    await expect(projectRunSummary(
      input,
      repository(assessment("projected")),
      artifactRoot
    )).rejects.toThrow(/artifact validation failed \(digest\)/i);
  });
});
