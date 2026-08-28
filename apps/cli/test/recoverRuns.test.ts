import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateRedactionKey } from "@agentlens/core";
import { openDatabase, RunRepository } from "@agentlens/storage";
import { afterEach, describe, expect, it } from "vitest";

import { recoverStaleRuns } from "../src/recoverRuns.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("stale run recovery races", () => {
  it("does nothing when normal finalization wins during the recorder identity check", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-finalization-race-"));
    roots.push(root);
    const dataRoot = join(root, "data");
    const artifactRoot = join(dataRoot, "artifacts", "sha256");
    await mkdir(artifactRoot, { recursive: true });
    await loadOrCreateRedactionKey(dataRoot);
    const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
    const repository = new RunRepository(database, { artifactRoot });
    const runId = "normal-finalization-wins";
    repository.createRun({
      id: runId,
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "unknown",
      capturePolicy: "standard",
      capturePolicyVersion: "1",
      redactionVersion: "1",
      repositoryFingerprint: "race-fingerprint",
      repositoryDisplay: "race-repository",
      startedAt: 1
    }, {
      recorderInstanceId: "active-recorder",
      recorderPid: 101,
      recorderStartToken: "active-recorder-start",
      heartbeatAt: 1
    });
    repository.markRunning(runId, {
      recorderInstanceId: "active-recorder",
      childPid: 202,
      childStartToken: "child-start",
      childProcessGroupId: 202,
      updatedAt: 2
    });

    let finalizedInsideInspection = false;
    try {
      const recovered = await recoverStaleRuns({
        repository,
        dataRoot,
        cwd: root,
        recorderPid: 303,
        processIdentityInspector: {
          captureStartToken: async () => "reader-start",
          inspect: async (pid) => {
            if (pid === 101 && !finalizedInsideInspection) {
              finalizedInsideInspection = true;
              const providerTerminal = repository.appendEvent({
                id: "provider-completed",
                runId,
                sequence: 0,
                receivedAt: "2026-08-28T14:00:00.000Z",
                kind: "turn.completed",
                status: "completed",
                provenance: "observed",
                source: {
                  provider: "codex-exec",
                  turnId: "turn-1",
                  eventType: "turn.completed"
                },
                relationships: [],
                summary: "Turn completed",
                normalizedPayload: {}
              });
              const processExit = repository.appendEvent({
                id: "process-exit",
                runId,
                sequence: 1,
                receivedAt: "2026-08-28T14:00:01.000Z",
                kind: "recorder.process_exit",
                status: "completed",
                provenance: "recorder",
                source: { provider: "codex-exec", correlationId: runId },
                relationships: [],
                summary: "Child process terminal fact",
                normalizedPayload: { exitCode: 0, terminatingSignal: null }
              });
              repository.recordProcessFact(runId, { eventId: processExit.id });
              repository.reconcileRun(runId, {
                eventId: "normal-reconciliation",
                receivedAt: "2026-08-28T14:00:02.000Z",
                endedAt: 3,
                providerTerminalEventId: providerTerminal.id
              });
            }
            return "gone";
          },
          inspectGroup: () => "gone"
        }
      });

      const detail = repository.getRunDetail(runId);
      expect(finalizedInsideInspection).toBe(true);
      expect(recovered).toEqual({
        recoveredRunIds: [],
        orphanRunIds: [],
        ambiguousRunIds: []
      });
      expect(detail.run).toMatchObject({
        status: "completed",
        terminalReason: "provider_completed_and_zero_exit"
      });
      expect(detail.ownership?.condition).toBe("released");
      expect(detail.events.map(({ kind }) => kind)).toEqual([
        "turn.completed",
        "recorder.process_exit",
        "run.reconciled"
      ]);
      expect(detail.events.some(({ kind }) => kind === "recorder.ownership_lost")).toBe(false);
      expect(detail.events.some(({ kind }) => kind === "recorder.recovery")).toBe(false);
    } finally {
      database.close();
    }
  });
});
