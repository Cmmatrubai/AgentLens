import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { projectRunSummary } from "@agentlens/application";
import { codexExecCapabilities, type TraceEventV1 } from "@agentlens/core";
import type { CurrentAssessment, RunDetail, StoredArtifact } from "@agentlens/storage";

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

async function untrackedArtifactBytes(
  artifactRoot: string,
  bytes: Buffer,
  overrides: Partial<StoredArtifact> = {}
): Promise<StoredArtifact> {
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
    createdAt: 1,
    ...overrides
  };
}

async function untrackedArtifact(artifactRoot: string, value: unknown): Promise<StoredArtifact> {
  return untrackedArtifactBytes(artifactRoot, Buffer.from(JSON.stringify(value), "utf8"));
}

function gitEvidenceWithUntracked(artifactId: string): NonNullable<RunDetail["gitEvidence"]> {
  return {
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
    untrackedMetadata: { state: "artifact", artifactId },
    headChanged: false,
    branchChanged: false,
    capturedAt: 1
  };
}

function summaryInput(
  runDetail: RunDetail,
  current: CurrentAssessment,
  artifactRoot: string
) {
  return {
    detail: runDetail,
    repository: repository(current),
    artifactRoot,
    providerCapabilities: {
      forProvider: () => codexExecCapabilities
    }
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("projectRunSummary", () => {
  it("uses the injected provider capability lookup for the detail provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
    roots.push(root);
    const summary = await projectRunSummary({
      detail: detail(),
      repository: repository(assessment("projected")),
      artifactRoot: join(root, "artifacts", "sha256"),
      providerCapabilities: {
        forProvider: (provider) => {
          expect(provider).toBe("codex-exec");
          return codexExecCapabilities;
        }
      }
    });

    expect(summary.providerCapabilityLimitations.availability).toBe("available");
    expect(summary.providerCapabilityLimitations.value).toEqual(expect.arrayContaining([
      { capability: "file_reads", availability: codexExecCapabilities.fileReads }
    ]));
  });

  it.each([
    ["projected", { state: "projected", provenance: null, currentEventId: null }],
    ["explicit", { state: "explicit", provenance: "human", currentEventId: "assessment-event" }]
  ] as const)("preserves %s assessment provenance", async (state, expected) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
    roots.push(root);

    const summary = await projectRunSummary(summaryInput(
      detail(),
      assessment(state),
      join(root, "artifacts", "sha256")
    ));

    expect(summary.assessment).toMatchObject({ verdict: "unreviewed", ...expected });
  });

  it("counts only a complete validated untracked metadata array and never exposes paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "sha256");
    const artifact = await untrackedArtifact(artifactRoot, [
      { path: "private-one", type: "file", size: 1 },
      { path: "private-two", type: "symlink", size: 0 }
    ]);

    const summary = await projectRunSummary(summaryInput(detail({
      artifacts: [artifact],
      gitEvidence: gitEvidenceWithUntracked(artifact.id)
    }), assessment("projected"), artifactRoot));

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
    [{}, "non-array"],
    [[{ path: 1, type: "file", size: 1 }], "path"],
    [[{ path: "x", type: "socket", size: 1 }], "type"],
    [[{ path: "x", type: "file", size: -1 }], "size"]
  ] as const)("rejects malformed %s untracked metadata", async (value) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "sha256");
    const artifact = await untrackedArtifact(artifactRoot, value);

    await expect(projectRunSummary(summaryInput(detail({
      artifacts: [artifact],
      gitEvidence: gitEvidenceWithUntracked(artifact.id)
    }), assessment("projected"), artifactRoot))).rejects.toThrow(/untracked metadata/i);
  });

  it("retains failed-then-passed test history from chronological source evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
    roots.push(root);
    const event = (
      id: string,
      sequence: number,
      status: "failed" | "completed",
      exitCode: number
    ): TraceEventV1 => ({
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

    const summary = await projectRunSummary(summaryInput(detail({
      events: [event("failed-source", 1, "failed", 1), event("passed-source", 2, "completed", 0)]
    }), assessment("projected"), join(root, "artifacts", "sha256")));

    expect(summary.likelyTests).toMatchObject({
      state: "detected",
      attempts: { latest: "passed", previousFailures: 1, total: 2 },
      durability: "incomplete",
      missingExpected: 4
    });
  });

  it("preserves capture-policy unavailability instead of classifying omitted commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
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

    const summary = await projectRunSummary(summaryInput(detail({
      run: { ...detail().run, capturePolicy: "metadata-only" },
      events: [omitted]
    }), assessment("projected"), join(root, "artifacts", "sha256")));

    expect(summary.likelyTests).toMatchObject({
      state: "unavailable_due_to_capture_policy",
      omittedTerminalCommands: 1
    });
  });

  it("rejects digest tampering through the untracked-metadata consumer", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "sha256");
    const artifact = await untrackedArtifact(artifactRoot, [{ path: "one", type: "file", size: 1 }]);
    await writeFile(artifact.path, '[{"path":"two","type":"file","size":1}]', "utf8");

    await expect(projectRunSummary(summaryInput(detail({
      artifacts: [artifact],
      gitEvidence: gitEvidenceWithUntracked(artifact.id)
    }), assessment("projected"), artifactRoot))).rejects.toThrow(
      /artifact validation failed \(digest\)/i
    );
  });

  it.each([
    "cross-run",
    "kind",
    "media",
    "redaction",
    "length",
    "truncated",
    "invalid-utf8",
    "invalid-json"
  ] as const)("fails closed on %s tampering through the untracked-metadata consumer", async (tamper) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-application-summary-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "sha256");
    const valid = Buffer.from('[{"path":"one","type":"file","size":1}]', "utf8");
    const bytes = tamper === "invalid-utf8"
      ? Buffer.from([0xff, 0xfe, 0xfd])
      : tamper === "invalid-json"
        ? Buffer.from('[{"path":', "utf8")
        : valid;
    const overrides: Partial<StoredArtifact> = tamper === "cross-run"
      ? { runId: "different-run" }
      : tamper === "kind"
        ? { kind: "native-payload" }
        : tamper === "media"
          ? { mediaType: "text/plain" }
          : tamper === "redaction"
            ? { redactionState: "unredacted" as never }
            : tamper === "length"
              ? { byteLength: bytes.byteLength - 1 }
              : tamper === "truncated"
                ? { truncated: true, originalByteLength: bytes.byteLength + 1 }
                : {};
    const artifact = await untrackedArtifactBytes(artifactRoot, bytes, overrides);

    await expect(projectRunSummary(summaryInput(detail({
      artifacts: [artifact],
      gitEvidence: gitEvidenceWithUntracked(artifact.id)
    }), assessment("projected"), artifactRoot))).rejects.toThrow(
      tamper === "cross-run"
        ? /untracked metadata artifact is unavailable/i
        : tamper === "invalid-utf8"
          ? /untracked metadata has invalid utf-8/i
          : tamper === "invalid-json"
            ? /untracked metadata is not valid json/i
            : /artifact validation failed/i
    );
  });
});
