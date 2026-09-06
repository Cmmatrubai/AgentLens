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

  it("provides a separate synthetic graph run with exact evidence boundaries", async () => {
    const fixture = await createFixtureDataRoot();
    fixtureRoot = fixture.root;
    const database = openDatabase(join(fixture.dataRoot, "agentlens.sqlite"));
    const repository = new RunRepository(database, {
      artifactRoot: join(fixture.dataRoot, "artifacts", "sha256")
    });
    const id = "fixture-synthetic-mixed-graph";
    try {
      expect(repository.getRun(id)?.label).toBe("Synthetic mixed-evidence graph fixture");
      const { events } = repository.getRunDetail(id);
      expect(events.map(({ sequence }) => sequence)).toEqual(events.map((_, index) => index));
      expect(new Set(events.map(({ id }) => id)).size).toBe(events.length);
      expect(events.slice(0, 3).map(({ kind }) => kind)).toEqual([
        "message.agent", "message.agent", "message.agent"
      ]);
      expect(events.slice(3, 5).map(({ status, source }) => ({ status, itemId: source.itemId })))
        .toEqual([
          { status: "in_progress", itemId: `${id}-successful-item` },
          { status: "completed", itemId: `${id}-successful-item` }
        ]);
      const command = events.find((event) => event.id === `${id}-command-failed`)!;
      expect(command).toMatchObject({ kind: "command", status: "failed", provenance: "observed" });
      expect(command.normalizedPayload).toMatchObject({ exitCode: 1 });
      const derived = events.filter(({ kind }) => kind === "test.command" || kind === "test.result");
      expect(derived).toHaveLength(2);
      for (const event of derived) {
        expect(event.provenance).toBe("derived");
        expect(event.relationships).toContainEqual({ type: "derived_from", eventId: command.id });
      }
      const fileChange = events.find((event) => event.id === `${id}-file-change`)!;
      expect(fileChange).toMatchObject({ kind: "fileChange", provenance: "observed" });
      expect(fileChange.normalizedPayload).toEqual({ changes: [{ path: "synthetic/example.ts", kind: "update" }] });
      const recovery = events.find(({ provenance, relationships }) => provenance === "recorder" &&
        relationships.some(({ eventId }) => eventId === `${id}-open-command`));
      expect(recovery).toBeDefined();
      expect(events.filter(({ provenance }) => provenance === "human")).toHaveLength(1);
      const batch = repository.getRunSummaryBatch([id])[0]!;
      expect(batch.gitEvidence).toMatchObject({ trackedFinalDiff: { state: "artifact" } });
      expect(repository.getRun("fixture-completed-recovery")?.status).toBe("completed");
    } finally {
      database.close();
    }
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
          interruptionSignal: "partial"
        }
      });
      expect(summary.terminalCommands.value).toBe(2);
      expect(summary.failedTerminalCommands.value).toBe(1);
      expect(summary.likelyTests).toMatchObject({
        state: "detected",
        attempts: { total: 2, latest: "passed", previousFailures: 1 }
      });
    } finally {
      database.close();
    }
  });
});
