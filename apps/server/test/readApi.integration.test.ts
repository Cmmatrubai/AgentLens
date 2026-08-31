import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  eventDetailV1Schema,
  runDetailV1Schema,
  runPageV1Schema,
  trajectoryPageV1Schema
} from "@agentlens/api-contract";
import { afterEach, describe, expect, it } from "vitest";

import type { TraceEventV1 } from "../../../packages/core/src/index.js";
import {
  RunRepository,
  openDatabase,
  type AgentLensDatabase
} from "../../../packages/storage/src/index.js";
import {
  RunQueryServiceError,
  projectEventDetailV1,
  type RunQueryService
} from "../../../packages/application/src/index.js";
import { createAgentLensRouter } from "../src/router.js";
import { startAgentLensServer, type AgentLensServerHandle } from "../src/startServer.js";

const fixtureWebRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "web");
const roots: string[] = [];
const handles: AgentLensServerHandle[] = [];
const databases: AgentLensDatabase[] = [];

function authorization(seed = 1): { Authorization: string } {
  return { Authorization: `Bearer ${Buffer.alloc(32, seed).toString("base64url")}` };
}

function trace(runId: string, id: string, sequence: number): TraceEventV1 {
  return {
    id,
    runId,
    sequence,
    receivedAt: new Date(Date.UTC(2026, 7, 31, 12, 0, 0, sequence)).toISOString(),
    kind: sequence === 1 ? "future.provider.kind" : "command",
    status: sequence === 0 ? "failed" : "completed",
    provenance: "observed",
    source: {
      provider: "codex-exec",
      sessionId: "RAW_SESSION_SENTINEL",
      itemId: id,
      eventType: "item.completed",
      itemType: sequence === 0 ? "command_execution" : "future_item"
    },
    relationships: [],
    summary: "redacted event summary",
    normalizedPayload: {
      command: "NORMALIZED_COMMAND_SENTINEL",
      aggregatedOutput: "NORMALIZED_OUTPUT_SENTINEL",
      path: "/private/NORMALIZED_PATH_SENTINEL"
    },
    nativePayload: { storage: "inline", redacted: { value: "NATIVE_PAYLOAD_SENTINEL" } }
  };
}

async function createDataRoot(active = false) {
  const root = await mkdtemp(join(tmpdir(), "agentlens-read-api-"));
  roots.push(root);
  const dataRoot = join(root, "data");
  const artifactRoot = join(dataRoot, "artifacts", "sha256");
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(dataRoot, "agentlens.sqlite");
  const database = openDatabase(databasePath);
  const repository = new RunRepository(database, { artifactRoot });
  repository.createRun({
    id: "run-http",
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "fixture",
    capturePolicy: "standard",
    capturePolicyVersion: "1",
    redactionVersion: "1",
    label: "HTTP fixture",
    promptSource: "PROMPT_SOURCE_SENTINEL",
    repositoryFingerprint: "repo-http",
    repositoryDisplay: "fixture repository",
    startedAt: 100
  }, {
    recorderInstanceId: "recorder-http",
    recorderPid: process.pid,
    recorderStartToken: "fixture-start-token",
    heartbeatAt: 100
  });
  repository.appendEvent(trace("run-http", "event-http-0", 0));
  repository.appendEvent(trace("run-http", "event-http-1", 1));
  if (active) {
    databases.push(database);
    await Promise.all([
      chmod(databasePath, 0o600),
      chmod(`${databasePath}-wal`, 0o600),
      chmod(`${databasePath}-shm`, 0o600)
    ]);
  } else {
    database.close();
  }
  return { root, dataRoot, databasePath, repository };
}

async function hash(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

type PathSnapshot = Readonly<{
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  linkTarget?: string;
  uid: bigint;
  gid: bigint;
  mode: bigint;
  device: bigint;
  inode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  sha256?: string;
}>;

async function snapshotDataRoot(root: string): Promise<readonly PathSnapshot[]> {
  const entries: PathSnapshot[] = [];
  const visit = async (path: string): Promise<void> => {
    const stat = await lstat(path, { bigint: true });
    const type = stat.isFile()
      ? "file"
      : stat.isDirectory()
        ? "directory"
        : stat.isSymbolicLink()
          ? "symlink"
          : "other";
    entries.push(Object.freeze({
      path: path === root ? "." : path.slice(root.length + 1),
      type,
      ...(type === "symlink" ? { linkTarget: await readlink(path) } : {}),
      uid: stat.uid,
      gid: stat.gid,
      mode: stat.mode,
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
      ctimeNs: stat.ctimeNs,
      ...(type === "file" ? { sha256: await hash(path) } : {})
    }));
    if (type !== "directory") return;
    for (const name of (await readdir(path)).sort()) await visit(join(path, name));
  };
  await visit(root);
  return Object.freeze(entries);
}

function withAllowedShmCoordination(snapshot: readonly PathSnapshot[]): readonly object[] {
  return snapshot.map((entry) => {
    if (entry.path !== "agentlens.sqlite-shm") return entry;
    const {
      sha256: _allowedShmBytes,
      mtimeNs: _allowedShmMtime,
      ctimeNs: _allowedShmCtime,
      ...metadata
    } = entry;
    return metadata;
  });
}

function lifecycleCounts(repository: RunRepository): Readonly<{
  runs: number;
  events: number;
}> {
  const runs = repository.listRuns({ limit: 500 });
  return Object.freeze({
    runs: runs.length,
    events: runs.reduce((count, run) => count + repository.readEvents(run.id).length, 0)
  });
}

async function start(dataRoot: string): Promise<AgentLensServerHandle> {
  let seed = 1;
  const handle = await startAgentLensServer({
    dataRoot,
    webRoot: fixtureWebRoot,
    tokenBytes: () => Buffer.alloc(32, seed++)
  });
  handles.push(handle);
  return handle;
}

async function body(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("authenticated read API", () => {
  it("serves closed run/detail/event contracts through the production startup path without mutation", async () => {
    const fixture = await createDataRoot();
    const before = await hash(fixture.databasePath);
    const handle = await start(fixture.dataRoot);
    const headers = authorization();

    const runsResponse = await fetch(`${handle.origin}/api/v1/runs?limit=100`, { headers });
    expect(runsResponse.status).toBe(200);
    const runs = runPageV1Schema.parse(await body(runsResponse));
    expect(runs.items.map(({ runId }) => runId)).toEqual(["run-http"]);

    const runResponse = await fetch(`${handle.origin}/api/v1/runs/run-http`, { headers });
    expect(runResponse.status).toBe(200);
    expect(runDetailV1Schema.parse(await body(runResponse))).toMatchObject({
      runId: "run-http",
      eventCount: 2,
      anchors: { firstFailure: { eventId: "event-http-0", sequence: 0 } }
    });

    const eventsResponse = await fetch(
      `${handle.origin}/api/v1/runs/run-http/events?limit=250&aroundSequence=1`,
      { headers }
    );
    expect(eventsResponse.status).toBe(200);
    const events = trajectoryPageV1Schema.parse(await body(eventsResponse));
    expect(events.items.map(({ eventId }) => eventId)).toEqual(["event-http-0", "event-http-1"]);
    expect(events.items[1]?.presentationClass).toBe("unknown");

    const eventResponse = await fetch(
      `${handle.origin}/api/v1/runs/run-http/events/event-http-0`,
      { headers }
    );
    expect(eventResponse.status).toBe(200);
    expect(eventDetailV1Schema.parse(await body(eventResponse))).toMatchObject({
      eventId: "event-http-0",
      presentationClass: "command"
    });

    const serialized = JSON.stringify([runs, events, await body(await fetch(
      `${handle.origin}/api/v1/runs/run-http/events/event-http-1`, { headers }
    ))]);
    for (const sentinel of [
      "PROMPT_SOURCE_SENTINEL",
      "RAW_SESSION_SENTINEL",
      "NORMALIZED_COMMAND_SENTINEL",
      "NORMALIZED_OUTPUT_SENTINEL",
      "NORMALIZED_PATH_SENTINEL",
      "NATIVE_PAYLOAD_SENTINEL",
      fixture.databasePath,
      fixture.dataRoot
    ]) expect(serialized).not.toContain(sentinel);
    expect(await hash(fixture.databasePath)).toBe(before);
  });

  it("keeps the complete active data root and lifecycle row counts pure across every read route", async () => {
    const fixture = await createDataRoot(true);
    const artifactPath = join(fixture.dataRoot, "artifacts", "sha256", "route-purity-artifact");
    await writeFile(artifactPath, "route purity artifact bytes\n", { mode: 0o600 });
    const handle = await start(fixture.dataRoot);
    const headers = authorization();
    const beforeCounts = lifecycleCounts(fixture.repository);
    const beforeStorage = await snapshotDataRoot(fixture.dataRoot);

    for (const path of [
      "/api/v1/runs?limit=100",
      "/api/v1/runs/run-http",
      "/api/v1/runs/run-http/events?limit=1&aroundSequence=1",
      "/api/v1/runs/run-http/events/event-http-0"
    ]) {
      expect((await fetch(`${handle.origin}${path}`, { headers })).status, path).toBe(200);
    }

    const afterCounts = lifecycleCounts(fixture.repository);
    const afterStorage = await snapshotDataRoot(fixture.dataRoot);
    expect(withAllowedShmCoordination(afterStorage))
      .toEqual(withAllowedShmCoordination(beforeStorage));
    expect(afterCounts).toEqual(beforeCounts);
    const beforeShm = beforeStorage.find(({ path }) => path === "agentlens.sqlite-shm");
    const afterShm = afterStorage.find(({ path }) => path === "agentlens.sqlite-shm");
    expect(beforeShm).toBeDefined();
    expect(afterShm).toMatchObject({
      type: "file",
      uid: beforeShm?.uid,
      gid: beforeShm?.gid,
      mode: beforeShm?.mode,
      inode: beforeShm?.inode,
      size: beforeShm?.size
    });
  });

  it("strictly rejects unknown, duplicate, oversized, and mutually exclusive query values", async () => {
    const fixture = await createDataRoot();
    const handle = await start(fixture.dataRoot);
    const headers = authorization();
    const invalidPaths = [
      "/api/v1/runs?limit=101",
      "/api/v1/runs?limit=1&limit=2",
      "/api/v1/runs?unknown=value",
      "/api/v1/runs?status=future",
      "/api/v1/health?unknown=value",
      "/api/v1/runs/run-http/events?limit=251",
      "/api/v1/runs/run-http/events?cursor=x&afterSequence=1",
      "/api/v1/runs/run-http/events?afterSequence=-1",
      "/api/v1/runs/run-http?extra=value"
    ];

    for (const path of invalidPaths) {
      const response = await fetch(`${handle.origin}${path}`, { headers });
      expect(response.status, path).toBe(400);
      expect(await body(response), path).toEqual({
        schemaVersion: 1,
        error: {
          code: "invalid_request",
          message: "Request parameters are invalid.",
          retryable: false
        }
      });
    }
  });

  it("uses ownership-safe 404s and a distinct invalid cursor envelope", async () => {
    const fixture = await createDataRoot();
    const handle = await start(fixture.dataRoot);
    const headers = authorization();

    const missingRun = await fetch(`${handle.origin}/api/v1/runs/missing-run`, { headers });
    expect(missingRun.status).toBe(404);
    expect(await body(missingRun)).toEqual({
      schemaVersion: 1,
      error: { code: "run_not_found", message: "Run was not found.", retryable: false }
    });
    const missingEvent = await fetch(
      `${handle.origin}/api/v1/runs/run-http/events/missing-event`,
      { headers }
    );
    expect(missingEvent.status).toBe(404);
    expect(await body(missingEvent)).toEqual({
      schemaVersion: 1,
      error: { code: "event_not_found", message: "Event was not found.", retryable: false }
    });
    const wrongOwner = await fetch(
      `${handle.origin}/api/v1/runs/missing-run/events/event-http-0`,
      { headers }
    );
    expect(wrongOwner.status).toBe(404);
    expect(await body(wrongOwner)).toEqual(await body(await fetch(
      `${handle.origin}/api/v1/runs/run-http/events/missing-event`, { headers }
    )));

    const invalidCursor = await fetch(
      `${handle.origin}/api/v1/runs/run-http/events?cursor=invalid`,
      { headers }
    );
    expect(invalidCursor.status).toBe(400);
    expect(await body(invalidCursor)).toEqual({
      schemaVersion: 1,
      error: { code: "invalid_cursor", message: "Cursor is invalid.", retryable: false }
    });
  });

  it("serves a supported future-status wrapper without leaking its raw spelling", async () => {
    const bearer = Buffer.alloc(32, 8);
    const rawStatus = "Future Status / RAW_SENTINEL";
    const projected = projectEventDetailV1({
      ...trace("run-http", "future-status", 2),
      status: rawStatus as never
    }, "standard");
    const queries = {
      listRuns: async () => { throw new Error("not used"); },
      getRun: async () => { throw new Error("not used"); },
      getEvents: async () => { throw new Error("not used"); },
      getEvent: async () => projected
    } satisfies RunQueryService;
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server address missing");
    const origin = `http://127.0.0.1:${address.port}`;
    const router = createAgentLensRouter({
      origin,
      expectedHost: new URL(origin).host,
      bearer,
      bootstrapCode: "bootstrap",
      staticAssets: { entryUrl: "/assets/fixture.js", read: async () => null },
      health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
      runQueries: queries
    });
    server.on("request", (request, response) => { void router(request, response); });
    try {
      const response = await fetch(`${origin}/api/v1/runs/run-http/events/future-status`, {
        headers: { Authorization: `Bearer ${bearer.toString("base64url")}` }
      });
      expect(response.status).toBe(200);
      const responseBody = eventDetailV1Schema.parse(await body(response));
      expect(responseBody.status).toEqual({
        state: "unsupported",
        safeToken: "future_status_raw_sentinel"
      });
      expect(JSON.stringify(responseBody)).not.toContain(rawStatus);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("maps temporary active snapshot failures to a sanitized retryable 503", async () => {
    const bearer = Buffer.alloc(32, 7);
    const unavailable = new Proxy({}, {
      get: () => async () => { throw new RunQueryServiceError("active_snapshot_unavailable"); }
    }) as RunQueryService;
    const server = createServer(createAgentLensRouter({
      origin: "http://127.0.0.1:0",
      expectedHost: "127.0.0.1:0",
      bearer,
      bootstrapCode: "bootstrap",
      staticAssets: { entryUrl: "/assets/fixture.js", read: async () => null },
      health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
      runQueries: unavailable
    }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server address missing");
    const origin = `http://127.0.0.1:${address.port}`;
    // The direct-router fixture must use its actual Host value.
    const router = createAgentLensRouter({
      origin,
      expectedHost: new URL(origin).host,
      bearer,
      bootstrapCode: "bootstrap",
      staticAssets: { entryUrl: "/assets/fixture.js", read: async () => null },
      health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
      runQueries: unavailable
    });
    server.removeAllListeners("request");
    server.on("request", (request, response) => { void router(request, response); });
    try {
      const response = await fetch(`${origin}/api/v1/runs`, {
        headers: { Authorization: `Bearer ${bearer.toString("base64url")}` }
      });
      expect(response.status).toBe(503);
      expect(await body(response)).toEqual({
        schemaVersion: 1,
        error: {
          code: "active_snapshot_unavailable",
          message: "The active run snapshot is temporarily unavailable.",
          retryable: true
        }
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
