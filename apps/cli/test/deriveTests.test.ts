import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CapturePolicy, EventStatus, TraceEventV1 } from "@agentlens/core";
import { buildTestDerivationDrafts } from "@agentlens/derivations";
import { openDatabase, RunRepository } from "@agentlens/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  derivePersistedTerminalCommand,
  ensureTestDerivationsForRun
} from "../src/deriveTests.js";

const roots: string[] = [];

function setup(): { repository: RunRepository; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), "agentlens-cli-test-derivations-"));
  roots.push(root);
  const artifactRoot = join(root, "artifacts", "sha256");
  mkdirSync(artifactRoot, { recursive: true });
  const database = openDatabase(join(root, "agentlens.sqlite"));
  return {
    repository: new RunRepository(database, { artifactRoot }),
    close: () => database.close()
  };
}

function createRun(
  repository: RunRepository,
  id: string,
  capturePolicy: CapturePolicy = "standard"
): void {
  repository.createRun({
    id,
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "fixture-agent",
    capturePolicy,
    capturePolicyVersion: "1",
    redactionVersion: "1",
    repositoryFingerprint: "fixture-fingerprint",
    repositoryDisplay: "fixture-repository",
    startedAt: 1_777_777_777_000
  }, {
    recorderInstanceId: `recorder-${id}`,
    recorderPid: 101,
    recorderStartToken: `start-${id}`,
    heartbeatAt: 1_777_777_777_000
  });
}

function sourceEvent(
  runId: string,
  id: string,
  sequence: number,
  overrides: Partial<TraceEventV1> = {}
): TraceEventV1 {
  return {
    id,
    runId,
    sequence,
    receivedAt: "2026-08-29T12:00:00.000Z",
    kind: "command",
    status: "completed",
    provenance: "observed",
    source: {
      provider: "codex-exec",
      threadId: "thread-secret",
      turnId: "turn-secret",
      itemId: `item-${id}`,
      eventType: "item.completed",
      itemType: "command_execution"
    },
    relationships: [],
    summary: "Command content must not be copied",
    normalizedPayload: {
      commandEvidence: { state: "available", redactedCommand: "pytest -q" },
      command: "pytest -q",
      aggregatedOutput: "SECRET OUTPUT",
      exitCode: 0
    },
    nativePayload: {
      storage: "inline",
      redacted: { command: "pytest -q", output: "SECRET NATIVE OUTPUT" }
    },
    ...overrides
  };
}

function appendGapCommand(repository: RunRepository, source: TraceEventV1): TraceEventV1 {
  const command = buildTestDerivationDrafts({
    runId: source.runId,
    sourceEventId: source.id,
    sourceProvider: source.source.provider,
    eventStatus: source.status as "completed" | "failed",
    exitCode: 0,
    classification: {
      family: "pytest",
      confidence: "high",
      commandShape: "direct",
      outcomeAttribution: "source_exit",
      derivationVersion: "test-command/2"
    }
  })[0];
  return repository.appendDerivedEvent({
    identity: command.derivation.identity,
    sourceEventId: source.id,
    eventId: command.id,
    receivedAt: source.receivedAt,
    kind: command.kind,
    status: command.status,
    sourceProvider: command.source.provider,
    summary: command.summary,
    normalizedPayload: command.normalizedPayload,
    derivation: {
      name: command.derivation.name,
      version: command.derivation.version,
      identity: command.derivation.identity,
      confidence: command.derivation.confidence
    }
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("persisted terminal command derivation", () => {
  it("derives only from durable standard evidence and returns idempotent winners", () => {
    const { repository, close } = setup();
    const runId = "standard-run";
    try {
      createRun(repository, runId);
      const source = repository.appendEvent(sourceEvent(runId, "source-standard", 0));

      const first = derivePersistedTerminalCommand({
        repository,
        runId,
        sourceEventId: source.id
      });
      const repeated = derivePersistedTerminalCommand({
        repository,
        runId,
        sourceEventId: source.id
      });

      expect(first).toHaveLength(2);
      expect(repeated).toEqual(first);
      expect(first.map(({ kind, sequence }) => ({ kind, sequence }))).toEqual([
        { kind: "test.command", sequence: 1 },
        { kind: "test.result", sequence: 2 }
      ]);
      expect(first.map(({ source }) => source)).toEqual([
        { provider: "codex-exec" },
        { provider: "codex-exec" }
      ]);
      expect(JSON.stringify(first)).not.toMatch(
        /thread-secret|turn-secret|item-source|pytest -q|SECRET|nativePayload|command_execution/
      );
      expect(repository.getRunDetail(runId).events).toHaveLength(3);
    } finally {
      close();
    }
  });

  it.each([
    {
      name: "metadata-only capture",
      capturePolicy: "metadata-only" as const,
      overrides: {}
    },
    {
      name: "strict capture",
      capturePolicy: "strict" as const,
      overrides: {}
    },
    {
      name: "started command",
      capturePolicy: "standard" as const,
      overrides: {
        status: "in_progress" as EventStatus,
        source: {
          provider: "codex-exec" as const,
          eventType: "item.started",
          itemType: "command_execution"
        }
      }
    },
    {
      name: "malformed structured evidence",
      capturePolicy: "standard" as const,
      overrides: {
        normalizedPayload: {
          commandEvidence: { state: "available", redactedCommand: 7 },
          exitCode: 0
        }
      }
    },
    {
      name: "unknown command",
      capturePolicy: "standard" as const,
      overrides: {
        normalizedPayload: {
          commandEvidence: { state: "available", redactedCommand: "echo pytest" },
          exitCode: 0
        }
      }
    },
    {
      name: "legacy unavailable command",
      capturePolicy: "standard" as const,
      overrides: { normalizedPayload: { truncated: true, exitCode: 0 } }
    },
    {
      name: "non-command native item",
      capturePolicy: "standard" as const,
      overrides: {
        source: {
          provider: "codex-exec" as const,
          eventType: "item.completed",
          itemType: "mcp_tool_call"
        }
      }
    }
  ])("skips $name conservatively without changing the source", ({ capturePolicy, overrides }) => {
    const { repository, close } = setup();
    const runId = `skip-${capturePolicy}`;
    try {
      createRun(repository, runId, capturePolicy);
      const source = repository.appendEvent(sourceEvent(runId, "source-skip", 0, overrides));

      expect(derivePersistedTerminalCommand({
        repository,
        runId,
        sourceEventId: source.id
      })).toEqual([]);
      expect(repository.getRunDetail(runId).events).toEqual([source]);
    } finally {
      close();
    }
  });

  it("supports an available legacy normalized command", () => {
    const { repository, close } = setup();
    const runId = "legacy-available";
    try {
      createRun(repository, runId);
      repository.appendEvent(sourceEvent(runId, "source-legacy", 0, {
        status: "failed",
        normalizedPayload: { command: "pnpm test", exitCode: 9 }
      }));

      const derived = derivePersistedTerminalCommand({
        repository,
        runId,
        sourceEventId: "source-legacy"
      });

      expect(derived.map(({ kind, status }) => ({ kind, status }))).toEqual([
        { kind: "test.command", status: "failed" },
        { kind: "test.result", status: "failed" }
      ]);
      expect(derived[1]?.normalizedPayload).toMatchObject({
        family: "pnpm",
        outcome: "failed",
        exitCode: 9
      });
    } finally {
      close();
    }
  });

  it("backfills a split-write gap by appending only the missing result", () => {
    const { repository, close } = setup();
    const runId = "gap-run";
    try {
      createRun(repository, runId);
      const source = repository.appendEvent(sourceEvent(runId, "source-gap", 0));
      const existingCommand = appendGapCommand(repository, source);
      const before = repository.getRunDetail(runId).events;

      const winners = ensureTestDerivationsForRun({ repository, runId });
      const after = repository.getRunDetail(runId).events;

      expect(winners.map(({ kind }) => kind)).toEqual(["test.command", "test.result"]);
      expect(winners[0]).toEqual(existingCommand);
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after.slice(before.length).map(({ kind }) => kind)).toEqual(["test.result"]);

      ensureTestDerivationsForRun({ repository, runId });
      expect(repository.getRunDetail(runId).events).toEqual(after);
    } finally {
      close();
    }
  });
});
