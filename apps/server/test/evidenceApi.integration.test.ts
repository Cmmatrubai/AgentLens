import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EvidenceServiceError,
  type EvidenceService
} from "../../../packages/application/src/index.js";
import { RunRepository, openDatabase } from "../../../packages/storage/src/index.js";
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
});
