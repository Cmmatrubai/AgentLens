import { describe, expect, it } from "vitest";

import type { RunSummary } from "@agentlens/derivations";
import type { RunListRecord } from "@agentlens/storage";
import type { OwnershipDiagnosis } from "../src/diagnoseOwnership.js";
import { runsJson, runsText } from "../src/format.js";

const completedRun: RunListRecord = {
  id: "run-completed",
  schemaVersion: 1,
  provider: "codex-exec",
  integrationVersion: "0.1.0",
  agentVersion: "unknown",
  status: "completed",
  capturePolicy: "standard",
  capturePolicyVersion: "1",
  redactionVersion: "1",
  repositoryFingerprint: "repository-fingerprint",
  repositoryDisplay: "repository",
  startedAt: 1_000,
  endedAt: 1_450,
  childPid: 123,
  exitCode: 0,
  terminatingSignal: null,
  providerTerminalKind: "completed",
  terminalReason: "provider_completed_and_zero_exit",
  contradictionCodes: [],
  headChanged: false,
  branchChanged: false,
  ownershipCondition: "released"
};

const unavailable = {
  value: null,
  availability: "unavailable",
  provenance: null,
  supportingEventIds: [],
  supportingArtifactIds: []
} as const;

const summary: RunSummary = {
  terminalCommands: { ...unavailable, value: 2, availability: "available", provenance: "observed" },
  failedTerminalCommands: { ...unavailable, value: 1, availability: "available", provenance: "observed" },
  nativeFileChanges: { ...unavailable, value: 0, availability: "available", provenance: "observed" },
  trackedFinalDiff: unavailable,
  untrackedFiles: unavailable,
  elapsedRecorderTimeMs: { ...unavailable, value: 450, availability: "available", provenance: "recorder" },
  observedTokenUsage: unavailable,
  likelyTests: {
    state: "detected",
    availability: "available",
    provenance: "derived",
    supportingEventIds: ["failed", "passed"],
    supportingArtifactIds: [],
    omittedTerminalCommands: 0,
    attempts: { total: 2, passed: 1, failed: 1, unknown: 0, latest: "passed", previousFailures: 1 },
    sourceEventIds: ["failed", "passed"],
    derivedEventIds: [],
    derivationId: "test-command/1",
    durability: "incomplete",
    missingExpected: 4,
    coverage: "complete"
  },
  assessment: {
    verdict: "unreviewed",
    taskCompleted: "uncertain",
    note: { state: "absent" },
    state: "projected",
    availability: "unavailable",
    provenance: null,
    currentEventId: null,
    reviewedAt: null,
    updatedAt: null,
    supportingEventIds: [],
    supportingArtifactIds: []
  },
  providerCapabilityLimitations: {
    value: [],
    availability: "available",
    provenance: "provider",
    supportingEventIds: [],
    supportingArtifactIds: []
  }
};

const ownership: OwnershipDiagnosis = {
  storedCondition: "released",
  diagnosis: "released"
};

const projected = { run: completedRun, summary, ownership };

describe("runs formatting", () => {
  it("shows the completed duration in text with the same milliseconds as JSON", () => {
    expect(runsJson([projected]).runs[0]?.durationMs).toBe(450);
    expect(runsText([projected])).toContain("duration=450ms");
  });

  it("shows null text duration for a running run just as JSON does", () => {
    const running: RunListRecord = {
      ...completedRun,
      id: "run-running",
      status: "running",
      endedAt: null,
      exitCode: null,
      providerTerminalKind: null,
      terminalReason: null,
      headChanged: null,
      branchChanged: null
    };

    const runningProjection = { run: running, summary, ownership };
    expect(runsJson([runningProjection]).runs[0]?.durationMs).toBeNull();
    expect(runsText([runningProjection])).toContain("duration=null");
  });

  it("uses qualified failed-then-passed and projected-reviewer wording", () => {
    const text = runsText([projected]);
    expect(text).toContain("Likely tests: latest passed, previous failures 1");
    expect(text).not.toMatch(/\btests passed\b/i);
    expect(text).toContain("Reviewer: unreviewed (projected)");
    expect(runsJson([projected]).runs[0]).toMatchObject({
      likelyTests: summary.likelyTests,
      assessment: summary.assessment,
      ownership: { condition: "released", diagnosis: "released" }
    });
  });

  it("prints missing ownership once as unavailable", () => {
    const text = runsText([{
      run: { ...completedRun, ownershipCondition: null },
      summary,
      ownership: { storedCondition: null, diagnosis: "unavailable" }
    }]);
    expect(text).toContain("ownership=unavailable");
    expect(text).not.toContain("ownership=unavailable/unavailable");
  });
});
