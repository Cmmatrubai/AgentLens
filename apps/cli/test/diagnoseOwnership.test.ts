import { describe, expect, it, vi } from "vitest";

import type { RecorderOwnership, RunRecord } from "@agentlens/storage";
import type { ProcessIdentityInspector } from "../src/processIdentity.js";
import { diagnoseOwnership } from "../src/diagnoseOwnership.js";

const run: RunRecord = {
  id: "ownership-run",
  schemaVersion: 1,
  provider: "codex-exec",
  integrationVersion: "0.1.0",
  agentVersion: "unknown",
  status: "running",
  capturePolicy: "standard",
  capturePolicyVersion: "1",
  redactionVersion: "1",
  repositoryFingerprint: "fixture",
  repositoryDisplay: "fixture",
  startedAt: 1,
  endedAt: null,
  childPid: null,
  exitCode: null,
  terminatingSignal: null,
  providerTerminalKind: null,
  terminalReason: null,
  contradictionCodes: []
};

const ownership: RecorderOwnership = {
  runId: run.id,
  recorderInstanceId: "recorder",
  recorderPid: 404_404,
  recorderStartToken: "start-token",
  childPid: null,
  childStartToken: null,
  childProcessGroupId: null,
  heartbeatAt: 1,
  condition: "active",
  ownershipLostEventId: null,
  updatedAt: 1
};

function inspector(state: "same" | "gone" | "replaced" | "ambiguous"): ProcessIdentityInspector {
  return {
    captureStartToken: vi.fn(),
    inspect: vi.fn().mockResolvedValue(state),
    inspectGroup: vi.fn()
  };
}

describe("diagnoseOwnership", () => {
  it("projects missing ownership as unavailable", async () => {
    await expect(diagnoseOwnership(run, null, inspector("same"))).resolves.toEqual({
      storedCondition: null,
      diagnosis: "unavailable"
    });
  });

  it.each([
    ["same", "active"],
    ["gone", "likely_stale"],
    ["replaced", "likely_stale"],
    ["ambiguous", "unknown"]
  ] as const)("maps %s recorder identity to %s without changing stored state", async (state, diagnosis) => {
    await expect(diagnoseOwnership(run, ownership, inspector(state))).resolves.toEqual({
      storedCondition: "active",
      diagnosis
    });
  });

  it("contains inspection failure as unknown", async () => {
    const failing = inspector("same");
    vi.mocked(failing.inspect).mockRejectedValueOnce(new Error("private process error"));
    await expect(diagnoseOwnership(run, ownership, failing)).resolves.toEqual({
      storedCondition: "active",
      diagnosis: "unknown"
    });
  });

  it.each(["released", "orphan_child_active", "identity_ambiguous"] as const)(
    "projects stored %s without probing liveness",
    async (condition) => {
      const probe = inspector("gone");
      const value = await diagnoseOwnership(
        condition === "released" ? { ...run, status: "completed", endedAt: 2 } : run,
        { ...ownership, condition },
        probe
      );
      expect(value).toEqual({ storedCondition: condition, diagnosis: condition });
      expect(probe.inspect).not.toHaveBeenCalled();
    }
  );

  it("projects a terminal run as released without probing stale stored liveness", async () => {
    const probe = inspector("gone");
    await expect(diagnoseOwnership(
      { ...run, status: "completed", endedAt: 2 },
      { ...ownership, condition: "reconciling" },
      probe
    )).resolves.toEqual({ storedCondition: "reconciling", diagnosis: "released" });
    expect(probe.inspect).not.toHaveBeenCalled();
  });
});
