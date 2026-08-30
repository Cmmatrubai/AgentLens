import { describe, expect, it } from "vitest";

import {
  buildTestDerivationDrafts,
  derivationIdentity
} from "../src/index.js";

const classification = {
  family: "pytest",
  confidence: "high",
  derivationVersion: "test-command/1"
} as const;

function drafts(
  eventStatus: "completed" | "failed",
  exitCode: number | null
) {
  return buildTestDerivationDrafts({
    runId: "run-001",
    sourceEventId: "source-command-001",
    sourceProvider: "codex-exec",
    eventStatus,
    exitCode,
    classification
  });
}

describe("deterministic test derivations", () => {
  it("hashes the exact length-delimited UTF-8 identity tuple", () => {
    const identity = derivationIdentity({
      runId: "run-α",
      sourceEventId: "event:1",
      name: "test-command",
      version: "1",
      derivedKind: "test.result"
    });

    expect(identity).toBe(
      "agentlens-derivation-sha256:23495bc9b80db0cc5783b34d84dd01faff7241627d4eb2a40ccdfeccb4394898"
    );
  });

  it("builds two independently addressable content-free drafts", () => {
    const [command, result] = drafts("completed", 0);

    expect(command).toEqual({
      id: expect.stringMatching(/^drv_[0-9a-f]{64}$/),
      runId: "run-001",
      kind: "test.command",
      status: "completed",
      provenance: "derived",
      source: { provider: "codex-exec" },
      relationships: [{ type: "derived_from", eventId: "source-command-001" }],
      summary: "Likely pytest test command (high confidence)",
      normalizedPayload: {
        family: "pytest",
        confidence: "high",
        derivationId: "test-command/1"
      },
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["source-command-001"],
        confidence: "high",
        identity: expect.stringMatching(/^agentlens-derivation-sha256:[0-9a-f]{64}$/)
      }
    });
    expect(result).toEqual({
      id: expect.stringMatching(/^drv_[0-9a-f]{64}$/),
      runId: "run-001",
      kind: "test.result",
      status: "completed",
      provenance: "derived",
      source: { provider: "codex-exec" },
      relationships: [{ type: "derived_from", eventId: "source-command-001" }],
      summary: "Likely pytest test result: passed (high confidence)",
      normalizedPayload: {
        family: "pytest",
        confidence: "high",
        outcome: "passed",
        exitCode: 0,
        derivationId: "test-command/1"
      },
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: ["source-command-001"],
        confidence: "high",
        identity: expect.stringMatching(/^agentlens-derivation-sha256:[0-9a-f]{64}$/)
      }
    });
    expect(command.id).not.toBe(result.id);
    expect(command.derivation.identity).not.toBe(result.derivation.identity);
    expect(command.relationships).not.toBe(result.relationships);
    expect(command.derivation).not.toBe(result.derivation);
    expect(JSON.stringify([command, result])).not.toMatch(
      /command_execution|item\.completed|aggregated_output|nativePayload|pnpm test/
    );
  });

  it.each([
    {
      name: "zero exit",
      eventStatus: "completed" as const,
      exitCode: 0,
      expectedStatus: "completed",
      expectedOutcome: "passed"
    },
    {
      name: "nonzero exit",
      eventStatus: "completed" as const,
      exitCode: 7,
      expectedStatus: "failed",
      expectedOutcome: "failed"
    },
    {
      name: "failed source without exit",
      eventStatus: "failed" as const,
      exitCode: null,
      expectedStatus: "failed",
      expectedOutcome: "failed"
    },
    {
      name: "completed source without exit",
      eventStatus: "completed" as const,
      exitCode: null,
      expectedStatus: "unknown",
      expectedOutcome: "unknown"
    }
  ])("maps $name conservatively", ({ eventStatus, exitCode, expectedStatus, expectedOutcome }) => {
    const result = drafts(eventStatus, exitCode)[1];

    expect(result.status).toBe(expectedStatus);
    expect(result.normalizedPayload).toEqual({
      family: "pytest",
      confidence: "high",
      outcome: expectedOutcome,
      ...(exitCode === null ? {} : { exitCode }),
      derivationId: "test-command/1"
    });
  });

  it("uses the frozen failed-without-exit result shape", () => {
    const result = drafts("failed", null)[1];

    expect(result).toMatchObject({
      kind: "test.result",
      status: "failed",
      normalizedPayload: {
        family: "pytest",
        confidence: "high",
        outcome: "failed",
        derivationId: "test-command/1"
      }
    });
    expect(result.normalizedPayload).not.toHaveProperty("exitCode");
  });
});
