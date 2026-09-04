import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { summarizeRun } from "../../../packages/derivations/src/index.js";
import { RunRepository, openDatabase } from "../../../packages/storage/src/index.js";
import { createFixtureDataRoot } from "../test-support/fixtureDataRoot.js";

describe("browser fixture data", () => {
  let fixtureRoot: string | undefined;

  afterEach(async () => {
    if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("preserves a failed likely-test attempt followed by a passing attempt", async () => {
    const fixture = await createFixtureDataRoot();
    fixtureRoot = fixture.root;
    const database = openDatabase(join(fixture.dataRoot, "agentlens.sqlite"), {
      readonly: true,
      fileMustExist: true
    });
    const repository = new RunRepository(database, {
      artifactRoot: join(fixture.dataRoot, "artifacts", "sha256")
    });

    try {
      const batch = repository.getRunSummaryBatch(["fixture-completed-recovery"])[0]!;
      const run = repository.getRun("fixture-completed-recovery")!;
      const summary = summarizeRun({
        run: {
          id: run.id,
          provider: run.provider,
          capturePolicy: run.capturePolicy,
          startedAt: run.startedAt,
          endedAt: run.endedAt
        },
        events: batch.summaryEvents,
        gitEvidence: batch.gitEvidence,
        validatedUntrackedFileCount: null,
        currentAssessment: null,
        providerCapabilities: {
          sourceTimestamps: false,
          fileReads: "unavailable",
          toolOutput: "partial",
          toolDurations: "unavailable",
          tokenUsage: "native",
          interruptionSignal: "partial"
        }
      });
      expect(summary.terminalCommands.value).toBe(2);
      expect(summary.failedTerminalCommands.value).toBe(1);
      expect(summary.observedTokenUsage).toMatchObject({
        state: "available",
        value: {
          inputTokens: 101,
          cachedInputTokens: 11,
          outputTokens: 202,
          reasoningOutputTokens: 31,
          cacheWriteInputTokens: 7
        },
        supportingEventIds: ["fixture-completed-recovery-provider-terminal"]
      });
      expect(summary.likelyTests).toMatchObject({
        state: "detected",
        attempts: { total: 2, latest: "passed", previousFailures: 1 }
      });
    } finally {
      database.close();
    }
  });
});
