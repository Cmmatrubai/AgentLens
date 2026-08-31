import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EvidenceServiceError,
  createEvidenceService,
  type EvidenceService
} from "../../../packages/application/src/index.js";
import { normalizeCodexRecord } from "../../../packages/codex/src/index.js";
import { ArtifactStore } from "../../../packages/core/src/index.js";
import { RunRepository, openDatabase } from "../../../packages/storage/src/index.js";
import { persistEventDraft } from "../../cli/src/persistEvent.js";
import { createAgentLensRouter } from "../src/router.js";
import { startAgentLensServer, type AgentLensServerHandle } from "../src/startServer.js";

const fixtureWebRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "web");

describe("Task 7.7 evidence API", () => {
  it("requires an explicit evidence service and has no generic artifact route", () => {
    const evidence = {} as EvidenceService;
    expect(() => createAgentLensRouter({
      origin: "http://127.0.0.1:1234",
      expectedHost: "127.0.0.1:1234",
      bearer: Buffer.alloc(32, 1),
      bootstrapCode: "bootstrap",
      staticAssets: {
        entryUrl: "/assets/app.js",
        read: async () => null
      },
      health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
      runQueries: {} as never,
      evidence
    })).not.toThrow();
  });

  const servers: Array<ReturnType<typeof createServer>> = [];
  const handles: AgentLensServerHandle[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    })));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function serve(evidence: EvidenceService) {
    const router = createAgentLensRouter({
      origin: "http://127.0.0.1:0",
      expectedHost: "127.0.0.1:0",
      bearer: Buffer.alloc(32, 1),
      bootstrapCode: "bootstrap",
      staticAssets: { entryUrl: "/assets/app.js", read: async () => null },
      health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
      runQueries: {} as never,
      evidence
    });
    let listener = router;
    const server = createServer((request, response) => void listener(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("fixture listen failed");
    const host = `127.0.0.1:${address.port}`;
    listener = createAgentLensRouter({
      origin: `http://${host}`,
      expectedHost: host,
      bearer: Buffer.alloc(32, 1),
      bootstrapCode: "bootstrap",
      staticAssets: { entryUrl: "/assets/app.js", read: async () => null },
      health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
      runQueries: {} as never,
      evidence
    });
    return { origin: `http://${host}`, headers: { Authorization: `Bearer ${Buffer.alloc(32, 1).toString("base64url")}` } };
  }

  it("serves only the seven explicit bound evidence routes", async () => {
    const evidence = {
      eventContent: vi.fn(async () => ({
        schemaVersion: 1 as const,
        eventId: "event-1",
        content: { kind: "message" as const, role: "agent" as const, text: "redacted" }
      })),
      eventNative: vi.fn(async () => ({
        schemaVersion: 1 as const,
        eventId: "event-1",
        content: { format: "json" as const, text: "{\"redacted\":true}", truncated: false }
      })),
      assessmentNote: vi.fn(async () => ({
        schemaVersion: 1 as const, eventId: "event-1", content: "redacted note"
      })),
      gitDiff: vi.fn(async () => ({
        schemaVersion: 1 as const, kind: "diff" as const, files: [], preamble: [],
        truncated: false, malformed: false
      })),
      gitStatus: vi.fn(async () => ({
        schemaVersion: 1 as const, kind: "status" as const, entries: []
      })),
      gitDiffCheck: vi.fn(async () => ({
        schemaVersion: 1 as const, kind: "diff_check" as const, passed: true, output: ""
      })),
      gitUntracked: vi.fn(async () => ({
        schemaVersion: 1 as const, kind: "untracked" as const, entries: []
      }))
    } satisfies EvidenceService;
    const fixture = await serve(evidence);
    const paths = [
      "/api/v1/runs/run-1/events/event-1/content",
      "/api/v1/runs/run-1/events/event-1/native",
      "/api/v1/runs/run-1/events/event-1/assessment-note",
      "/api/v1/runs/run-1/git/diff",
      "/api/v1/runs/run-1/git/status?phase=initial",
      "/api/v1/runs/run-1/git/diff-check",
      "/api/v1/runs/run-1/git/untracked"
    ];
    for (const path of paths) {
      expect((await fetch(`${fixture.origin}${path}`, { headers: fixture.headers })).status, path).toBe(200);
    }
    expect(evidence.eventContent).toHaveBeenCalledWith("run-1", "event-1");
    expect(evidence.gitStatus).toHaveBeenCalledWith("run-1", "initial");

    for (const path of [
      "/api/v1/artifacts/deadbeef",
      "/api/v1/runs/run-1/artifacts/deadbeef",
      "/api/v1/runs/run-1/git/status",
      "/api/v1/runs/run-1/git/status?phase=initial&phase=final",
      "/api/v1/runs/run-1/git/diff?artifactId=deadbeef"
    ]) expect((await fetch(`${fixture.origin}${path}`, { headers: fixture.headers })).status, path).not.toBe(200);
  });

  it("authenticates before lookup and maps evidence failures to stable sanitized errors", async () => {
    const evidence = {
      eventContent: vi.fn(async () => { throw new EvidenceServiceError("evidence_binding_mismatch"); }),
      eventNative: vi.fn(),
      assessmentNote: vi.fn(),
      gitDiff: vi.fn(),
      gitStatus: vi.fn(),
      gitDiffCheck: vi.fn(),
      gitUntracked: vi.fn()
    } as unknown as EvidenceService;
    const fixture = await serve(evidence);
    const path = "/api/v1/runs/run-1/events/event-1/content";

    const unauthenticated = await fetch(`${fixture.origin}${path}`);
    expect(unauthenticated.status).toBe(401);
    expect(evidence.eventContent).not.toHaveBeenCalled();

    const rejected = await fetch(`${fixture.origin}${path}`, { headers: fixture.headers });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: "evidence_binding_mismatch",
        message: "Evidence binding could not be validated.",
        retryable: false
      }
    });
    expect(rejected.headers.get("cache-control")).toContain("no-store");
  });

  it("composes real event evidence through the production startup path without exposing source identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-evidence-api-"));
    roots.push(root);
    const dataRoot = join(root, "data");
    const artifactRoot = join(dataRoot, "artifacts", "sha256");
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
    const repository = new RunRepository(database, { artifactRoot });
    repository.createRun({
      id: "run-production",
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "fixture",
      capturePolicy: "standard",
      capturePolicyVersion: "1",
      redactionVersion: "1",
      repositoryFingerprint: "repo-production",
      repositoryDisplay: "fixture repository",
      startedAt: 1
    }, {
      recorderInstanceId: "recorder-production",
      recorderPid: 4242,
      recorderStartToken: "token-production",
      heartbeatAt: 1
    });
    repository.appendEvent({
      id: "event-production",
      runId: "run-production",
      sequence: 0,
      receivedAt: "2026-08-31T12:00:00.000Z",
      kind: "message.agent",
      status: "completed",
      provenance: "observed",
      source: {
        provider: "codex-exec",
        sessionId: "RAW_SESSION_MUST_NOT_CROSS",
        itemId: "RAW_ITEM_MUST_NOT_CROSS",
        eventType: "item.completed"
      },
      relationships: [],
      summary: "redacted summary",
      normalizedPayload: { text: "redacted content" },
      nativePayload: { storage: "inline", redacted: { value: "redacted native" } }
    });
    repository.appendEvent({
      id: "event-command-production",
      runId: "run-production",
      sequence: 1,
      receivedAt: "2026-08-31T12:00:01.000Z",
      kind: "command",
      status: "completed",
      provenance: "observed",
      source: {
        provider: "codex-exec",
        itemId: "RAW_COMMAND_ITEM_MUST_NOT_CROSS",
        eventType: "item.completed"
      },
      relationships: [],
      summary: "redacted command summary",
      normalizedPayload: {
        commandEvidence: { state: "available", redactedCommand: "pnpm test" },
        aggregatedOutput: "15 tests passed",
        exitCode: 0
      },
      nativePayload: { storage: "omitted", reason: "not_captured" }
    });
    database.close();

    let seed = 1;
    const handle = await startAgentLensServer({
      dataRoot,
      webRoot: fixtureWebRoot,
      tokenBytes: () => Buffer.alloc(32, seed++)
    });
    handles.push(handle);
    const headers = { Authorization: `Bearer ${Buffer.alloc(32, 1).toString("base64url")}` };
    const content = await fetch(
      `${handle.origin}/api/v1/runs/run-production/events/event-production/content`, { headers }
    );
    const native = await fetch(
      `${handle.origin}/api/v1/runs/run-production/events/event-production/native`, { headers }
    );
    const commandOutput = await fetch(
      `${handle.origin}/api/v1/runs/run-production/events/event-command-production/content`, { headers }
    );
    expect(content.status).toBe(200);
    expect(native.status).toBe(200);
    expect(commandOutput.status).toBe(200);
    const projectedCommandOutput = await commandOutput.json();
    expect(projectedCommandOutput).toEqual({
      schemaVersion: 1,
      eventId: "event-command-production",
      content: { kind: "command_output", output: "15 tests passed" }
    });
    const serialized = JSON.stringify([await content.json(), await native.json(), projectedCommandOutput]);
    expect(serialized).toContain("redacted content");
    expect(serialized).toContain("redacted native");
    expect(serialized).not.toContain("RAW_SESSION_MUST_NOT_CROSS");
    expect(serialized).not.toContain("RAW_ITEM_MUST_NOT_CROSS");
    expect(serialized).not.toContain("RAW_COMMAND_ITEM_MUST_NOT_CROSS");
    expect(serialized).not.toContain(dataRoot);
  });

  it("response-redacts canonical source tuples from real inline and artifact native payloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-native-response-redaction-"));
    roots.push(root);
    const dataRoot = join(root, "data");
    const artifactRoot = join(dataRoot, "artifacts", "sha256");
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    const databasePath = join(dataRoot, "agentlens.sqlite");
    const database = openDatabase(databasePath);
    const repository = new RunRepository(database, { artifactRoot });
    repository.createRun({
      id: "native-source-run",
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "fixture",
      capturePolicy: "standard",
      capturePolicyVersion: "1",
      redactionVersion: "1",
      repositoryFingerprint: "repo-native-source",
      repositoryDisplay: "fixture repository",
      startedAt: 1
    }, {
      recorderInstanceId: "recorder-native-source",
      recorderPid: 4242,
      recorderStartToken: "token-native-source",
      heartbeatAt: 1
    });

    const artifactStore = new ArtifactStore(dataRoot);
    let sequence = 0;
    const persisted: Array<{ eventId: string; sourceValues: string[]; storage: "inline" | "artifact" }> = [];
    for (const fixture of [
      { label: "inline", filler: "", sharedSessionThread: false },
      { label: "artifact", filler: "x".repeat(40 * 1024), sharedSessionThread: true }
    ] as const) {
      const sessionId = `SRC_SESSION_${fixture.label}`;
      const threadId = fixture.sharedSessionThread ? sessionId : `SRC_THREAD_${fixture.label}`;
      const turnId = `SRC_TURN_${fixture.label}`;
      const itemId = `SRC_ITEM_${fixture.label}`;
      const toolId = `SRC_TOOL_${fixture.label}`;
      const correlationId = `SRC_CALL_CORRELATION_${fixture.label}`;
      const eventType = "item.completed";
      const itemType = "command_execution";
      const record = {
        type: eventType,
        session_id: sessionId,
        thread_id: threadId,
        turn_id: turnId,
        correlation_id: correlationId,
        call_id: correlationId,
        inspectable: "INSPECTABLE_ALREADY_REDACTED_PROVIDER_CONTENT",
        [`${sessionId}_embedded_key`]: "KEY_INSPECTABLE_PROVIDER_CONTENT",
        embedded: `before:${sessionId}:${threadId}:${turnId}:${itemId}:${toolId}:${correlationId}:${eventType}:${itemType}:after`,
        item: {
          id: itemId,
          type: itemType,
          tool_id: toolId,
          call_id: correlationId,
          status: "completed",
          command: "printf inspectable",
          aggregated_output: "provider output remains inspectable",
          nested: {
            sourceEcho: `nested:${sessionId}:${itemId}:${correlationId}`,
            inspectable: "NESTED_INSPECTABLE_PROVIDER_CONTENT"
          },
          filler: fixture.filler
        }
      };
      const draft = normalizeCodexRecord(record)[0]!;
      const eventId = `native-${fixture.label}`;
      const event = await persistEventDraft(draft, {
        runId: "native-source-run",
        capturePolicy: "standard",
        redactionKey: Buffer.alloc(32, 7),
        artifactStore,
        repository,
        committedArtifactIds: new Set<string>(),
        nextEventId: () => eventId,
        nextSequence: () => sequence++,
        receivedAt: () => "2026-08-31T12:00:00.000Z"
      });
      if (event.nativePayload?.storage !== fixture.label) {
        throw new Error(`Expected ${fixture.label} native storage.`);
      }
      expect(event.source).toEqual({
        provider: "codex-exec",
        sessionId,
        threadId,
        turnId,
        itemId,
        toolId,
        correlationId,
        eventType,
        itemType
      });
      const sourceValues = [...new Set(Object.entries(event.source)
        .filter(([field, value]) => field !== "provider" && typeof value === "string")
        .map(([, value]) => value as string))];
      const durableNative = event.nativePayload.storage === "inline"
        ? JSON.stringify(event.nativePayload.redacted)
        : await readFile(artifactStore.pathForArtifactId(event.nativePayload.artifactId), "utf8");
      for (const sourceValue of sourceValues) expect(durableNative).toContain(sourceValue);
      persisted.push({
        eventId,
        sourceValues,
        storage: event.nativePayload.storage
      });
    }
    database.close();

    const evidence = createEvidenceService({ databasePath, artifactRoot });
    const directResponses = await Promise.all(persisted.map(({ eventId }) =>
      evidence.eventNative("native-source-run", eventId)
    ));

    let seed = 11;
    const handle = await startAgentLensServer({
      dataRoot,
      webRoot: fixtureWebRoot,
      tokenBytes: () => Buffer.alloc(32, seed++)
    });
    handles.push(handle);
    const headers = { Authorization: `Bearer ${Buffer.alloc(32, 11).toString("base64url")}` };
    const httpResponses = await Promise.all(persisted.map(async ({ eventId }) => {
      const response = await fetch(
        `${handle.origin}/api/v1/runs/native-source-run/events/${eventId}/native`, { headers }
      );
      expect(response.status).toBe(200);
      return response.json();
    }));

    for (const [index, { sourceValues, storage }] of persisted.entries()) {
      expect(storage).toBe(index === 0 ? "inline" : "artifact");
      const serialized = JSON.stringify([directResponses[index], httpResponses[index]]);
      for (const sourceValue of sourceValues) expect(serialized).not.toContain(sourceValue);
      expect(serialized).toContain("INSPECTABLE_ALREADY_REDACTED_PROVIDER_CONTENT");
      expect(serialized).toContain("NESTED_INSPECTABLE_PROVIDER_CONTENT");
      expect(serialized).toContain("KEY_INSPECTABLE_PROVIDER_CONTENT");
      expect(serialized).toContain("[[AGENTLENS_RESPONSE_REDACTED:");
    }
    expect(JSON.stringify(httpResponses[1])).toContain(
      "[[AGENTLENS_RESPONSE_REDACTED:SESSION_ID]]"
    );
    expect(JSON.stringify(httpResponses[1])).not.toContain(
      "[[AGENTLENS_RESPONSE_REDACTED:THREAD_ID]]"
    );
  });
});
