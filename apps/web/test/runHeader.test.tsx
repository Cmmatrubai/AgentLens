import type { RunDetailV1 } from "@agentlens/api-contract";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunHeader } from "../src/run-detail/RunHeader.js";

function run(overrides: Partial<RunDetailV1> = {}): RunDetailV1 {
  return {
    schemaVersion: 1,
    runId: "run-header",
    status: { state: "known", value: "completed" },
    provider: { state: "known", value: "codex-exec" },
    label: "Header run",
    capturePolicy: "standard",
    repository: { fingerprint: "repo-fingerprint", display: "agentlens" },
    startedAt: Date.UTC(2026, 7, 31, 16, 0, 0),
    endedAt: Date.UTC(2026, 7, 31, 16, 0, 2),
    ownership: { storedCondition: "released", diagnosis: "released" },
    finalGitEvidence: { state: "available", headChanged: false, branchChanged: false },
    summary: {
      terminalCommands: { state: "available", value: 2, provenance: "observed", supportingEventIds: [], supportingArtifactIds: [] },
      failedTerminalCommands: { state: "available", value: 1, provenance: "observed", supportingEventIds: [], supportingArtifactIds: [] },
      nativeFileChanges: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      trackedFinalDiff: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      untrackedFiles: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      elapsedRecorderTimeMs: { state: "available", value: 1_250, provenance: "recorder", supportingEventIds: [], supportingArtifactIds: [] },
      observedTokenUsage: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] },
      likelyTests: {
        state: "detected", availability: "available", provenance: "derived",
        supportingEventIds: [], supportingArtifactIds: [], omittedTerminalCommands: 0,
        attempts: { total: 3, passed: 1, failed: 2, unknown: 0, latest: "failed", previousFailures: 1 },
        sourceEventIds: [], derivedEventIds: [], derivationId: "test-command/1",
        durability: "complete", missingExpected: 0, coverage: "complete"
      },
      assessment: {
        schemaVersion: 1, state: "explicit", verdict: "partial", taskCompleted: "uncertain",
        note: { state: "available" }, provenance: "human", currentEventId: "assessment-event",
        reviewedAt: Date.UTC(2026, 7, 31, 16, 1), updatedAt: Date.UTC(2026, 7, 31, 16, 1)
      },
      providerCapabilityLimitations: { state: "unavailable", reason: "not_captured", supportingEventIds: [], supportingArtifactIds: [] }
    },
    eventCount: 42,
    anchors: { firstFailure: null, recorderRecovery: null, latestLikelyTest: null, finalGitEvidence: null, latestEvent: null },
    warningCodes: ["recorder_failure"],
    contradictionCodes: ["provider_process_contradiction"],
    ...overrides
  };
}

describe("RunHeader frozen facts", () => {
  it("labels recorder timing, likely tests, explicit human assessment, warnings, and contradictions", () => {
    render(<RunHeader run={run()} />);
    expect(screen.getByText("2026-08-31T16:00:00.000Z")).toHaveAttribute("datetime", "2026-08-31T16:00:00.000Z");
    expect(screen.getByText("2026-08-31T16:00:02.000Z")).toHaveAttribute("datetime", "2026-08-31T16:00:02.000Z");
    expect(screen.getByText("1.3 s")).toBeVisible();
    expect(screen.getByText("Latest likely test: failed · 1 previous failure")).toBeVisible();
    expect(screen.getByText("Reviewer: partial · human evidence")).toBeVisible();
    expect(screen.getByText("Warning: recorder failure")).toBeVisible();
    expect(screen.getByText("Contradiction: provider process contradiction")).toBeVisible();
  });

  it("states projected, unavailable, ongoing, and unsupported facts without invention", () => {
    const base = run();
    render(<RunHeader run={run({
      status: { state: "unsupported", safeToken: "future_status" },
      provider: { state: "unsupported", safeToken: "future_provider" },
      endedAt: null,
      summary: {
        ...base.summary,
        elapsedRecorderTimeMs: { state: "unavailable", reason: "not_yet_available", supportingEventIds: [], supportingArtifactIds: [] },
        likelyTests: { state: "unavailable_due_to_capture_policy", availability: "unavailable", provenance: null, supportingEventIds: [], supportingArtifactIds: [], omittedTerminalCommands: 2 },
        assessment: { schemaVersion: 1, state: "projected", verdict: "unreviewed", taskCompleted: "uncertain", note: { state: "absent" }, provenance: null, currentEventId: null, reviewedAt: null, updatedAt: null }
      }
    })} />);
    expect(screen.getByText("Unsupported status: future_status")).toBeVisible();
    expect(screen.getByText("Unsupported provider: future_provider")).toBeVisible();
    expect(screen.getByText("Not yet ended")).toBeVisible();
    expect(screen.getByText("Unavailable · not yet available")).toBeVisible();
    expect(screen.getByText("Likely tests: unavailable due to capture policy")).toBeVisible();
    expect(screen.getByText("Not reviewed · projected state · no human evidence")).toBeVisible();
  });
});
