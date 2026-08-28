import { describe, expect, it } from "vitest";

import type { RunListRecord } from "@agentlens/storage";
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
  branchChanged: false
};

describe("runs formatting", () => {
  it("shows the completed duration in text with the same milliseconds as JSON", () => {
    expect(runsJson([completedRun]).runs[0]?.durationMs).toBe(450);
    expect(runsText([completedRun])).toContain("duration=450ms");
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

    expect(runsJson([running]).runs[0]?.durationMs).toBeNull();
    expect(runsText([running])).toContain("duration=null");
  });
});
