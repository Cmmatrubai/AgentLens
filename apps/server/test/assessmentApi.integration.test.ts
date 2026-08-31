import { createServer, request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAssessmentService,
  type AssessmentService,
  type EvidenceService,
  type RunQueryService
} from "@agentlens/application";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, RunRepository } from "../../../packages/storage/src/index.js";
import { createAgentLensRouter } from "../src/router.js";

const roots: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];
const bearer = Buffer.alloc(32, 17);
const authorization = `Bearer ${bearer.toString("base64url")}`;

async function fixture(capturePolicy: "standard" | "metadata-only" | "strict" = "standard") {
  const root = await mkdtemp(join(tmpdir(), "agentlens-assessment-api-"));
  roots.push(root);
  const dataRoot = join(root, "data");
  const artifactRoot = join(dataRoot, "artifacts", "sha256");
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(dataRoot, "agentlens.sqlite");
  const database = openDatabase(databasePath);
  try {
    const repository = new RunRepository(database, { artifactRoot });
    repository.createRun({
      id: "run-http-assessment",
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "fixture",
      capturePolicy,
      capturePolicyVersion: "1",
      redactionVersion: "1",
      repositoryFingerprint: "assessment-api-fingerprint",
      repositoryDisplay: "fixture-repository",
      startedAt: Date.parse("2026-08-31T18:00:00.000Z")
    }, {
      recorderInstanceId: "assessment-api-recorder",
      recorderPid: 100,
      recorderStartToken: "assessment-api-token",
      heartbeatAt: Date.parse("2026-08-31T18:00:00.000Z")
    });
  } finally {
    database.close();
  }
  return { dataRoot, databasePath, runId: "run-http-assessment" };
}

function inspect(databasePath: string, dataRoot: string) {
  const database = openDatabase(databasePath);
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    });
    return {
      current: repository.getCurrentAssessment("run-http-assessment"),
      events: repository.getRunDetail("run-http-assessment").events,
      artifacts: repository.getRunDetail("run-http-assessment").artifacts
    };
  } finally {
    database.close();
  }
}

async function durableBytes(root: string): Promise<Buffer> {
  const visit = async (path: string): Promise<Buffer[]> => {
    const entries = await readdir(path, { withFileTypes: true });
    return (await Promise.all(entries.map(async (entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? visit(child) : entry.isFile() ? [await readFile(child)] : [];
    }))).flat();
  };
  return Buffer.concat(await visit(root));
}

async function serve(assessment: AssessmentService) {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture address missing");
  const origin = `http://127.0.0.1:${address.port}`;
  const router = createAgentLensRouter({
    origin,
    expectedHost: new URL(origin).host,
    bearer,
    bootstrapCode: "bootstrap",
    staticAssets: { entryUrl: "/assets/fixture.js", read: async () => null },
    health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
    runQueries: {} as RunQueryService,
    evidence: {} as EvidenceService,
    assessment
  });
  server.on("request", (request, response) => { void router(request, response); });
  return origin;
}

function requestHeaders(origin: string, ifMatch?: string) {
  return {
    Authorization: authorization,
    Origin: origin,
    "Content-Type": "application/json",
    ...(ifMatch === undefined ? {} : { "If-Match": ifMatch })
  };
}

function body(note: unknown = { state: "absent" }) {
  return JSON.stringify({
    schemaVersion: 1,
    verdict: "partial",
    taskCompleted: "uncertain",
    note
  });
}

async function rawPut(
  origin: string,
  path: string,
  headers: readonly string[],
  bytes: Buffer
): Promise<{ status: number; body: string }> {
  const target = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "PUT",
      headers: [...headers]
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.on("error", reject);
    request.end(bytes);
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Task 7.8 conditional assessment API", () => {
  it("requires If-Match and rejects malformed or non-canonical strong ETags without mutation", async () => {
    const setup = await fixture();
    const origin = await serve(createAssessmentService({ dataRoot: setup.dataRoot }));
    const path = `${origin}/api/v1/runs/${setup.runId}/assessment`;

    const missing = await fetch(path, {
      method: "PUT", headers: requestHeaders(origin), body: body()
    });
    expect(missing.status).toBe(428);
    expect(await missing.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: "precondition_required",
        message: "Assessment revision is required.",
        retryable: false
      }
    });

    for (const etag of [
      "*", "W/\"assessment:projected\"", "assessment:projected",
      "\"assessment:\"", "\"assessment:YQ==\"", "\"assessment:Lw\"",
      "\"assessment:projected\", \"assessment:projected\""
    ]) {
      const response = await fetch(path, {
        method: "PUT", headers: requestHeaders(origin, etag), body: body()
      });
      expect(response.status, etag).toBe(400);
      expect(await response.json()).toMatchObject({
        schemaVersion: 1,
        error: { code: "invalid_request", retryable: false }
      });
    }
    expect(inspect(setup.databasePath, setup.dataRoot).events).toEqual([]);
  });

  it("creates one human event from the projected revision and returns an exact new ETag", async () => {
    const setup = await fixture();
    const eventIds = ["assessment-http-first"];
    const origin = await serve(createAssessmentService({
      dataRoot: setup.dataRoot,
      now: () => new Date("2026-08-31T18:10:00.000Z"),
      eventId: () => eventIds.shift()!
    }));
    const response = await fetch(`${origin}/api/v1/runs/${setup.runId}/assessment`, {
      method: "PUT",
      headers: requestHeaders(origin, '"assessment:projected"'),
      body: body()
    });
    const expectedEtag = `"assessment:${Buffer.from("assessment-http-first").toString("base64url")}"`;

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(expectedEtag);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      assessment: {
        schemaVersion: 1,
        state: "explicit",
        verdict: "partial",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        provenance: "human",
        currentEventId: "assessment-http-first",
        reviewedAt: Date.parse("2026-08-31T18:10:00.000Z"),
        updatedAt: Date.parse("2026-08-31T18:10:00.000Z")
      },
      etag: expectedEtag
    });
    expect(inspect(setup.databasePath, setup.dataRoot).events.map(({ id }) => id))
      .toEqual(["assessment-http-first"]);
  });

  it("returns the transaction-observed current assessment on 412 and never retries a stale write", async () => {
    const setup = await fixture();
    const eventIds = [
      "assessment-http-current",
      "assessment-http-stale-one",
      "assessment-http-stale-two"
    ];
    const origin = await serve(createAssessmentService({
      dataRoot: setup.dataRoot,
      now: () => new Date("2026-08-31T18:11:00.000Z"),
      eventId: () => eventIds.shift()!
    }));
    const path = `${origin}/api/v1/runs/${setup.runId}/assessment`;
    const first = await fetch(path, {
      method: "PUT", headers: requestHeaders(origin, '"assessment:projected"'), body: body()
    });
    expect(first.status).toBe(200);
    const currentEtag = first.headers.get("etag")!;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stale = await fetch(path, {
        method: "PUT", headers: requestHeaders(origin, '"assessment:projected"'), body: body()
      });
      expect(stale.status, `stale attempt ${attempt + 1}`).toBe(412);
      expect(stale.headers.get("etag")).toBe(currentEtag);
      expect(await stale.json()).toMatchObject({
        schemaVersion: 1,
        error: { code: "assessment_conflict", retryable: false },
        assessment: { state: "explicit", currentEventId: "assessment-http-current" },
        etag: currentEtag
      });
    }
    expect(inspect(setup.databasePath, setup.dataRoot).events.map(({ id }) => id))
      .toEqual(["assessment-http-current"]);
  });

  it("accepts an exact explicit revision and advances to a distinct ETag", async () => {
    const setup = await fixture();
    const eventIds = ["assessment-http-one", "assessment-http-two"];
    const times = [
      new Date("2026-08-31T18:12:00.000Z"),
      new Date("2026-08-31T18:13:00.000Z")
    ];
    const origin = await serve(createAssessmentService({
      dataRoot: setup.dataRoot,
      now: () => times.shift()!,
      eventId: () => eventIds.shift()!
    }));
    const path = `${origin}/api/v1/runs/${setup.runId}/assessment`;
    const first = await fetch(path, {
      method: "PUT", headers: requestHeaders(origin, '"assessment:projected"'), body: body()
    });
    const second = await fetch(path, {
      method: "PUT", headers: requestHeaders(origin, first.headers.get("etag")!), body: JSON.stringify({
        schemaVersion: 1,
        verdict: "success",
        taskCompleted: "yes",
        note: { state: "absent" }
      })
    });

    expect(second.status).toBe(200);
    expect(second.headers.get("etag")).toBe(
      `"assessment:${Buffer.from("assessment-http-two").toString("base64url")}"`
    );
    expect(inspect(setup.databasePath, setup.dataRoot).events.map(({ id }) => id))
      .toEqual(["assessment-http-one", "assessment-http-two"]);
  });

  it("rejects bearer and Origin failures before note bytes reach durable assessment storage", async () => {
    const setup = await fixture();
    const sentinel = "API_KEY=HTTP_REJECTED_NOTE_SENTINEL_63ac1e";
    const origin = await serve(createAssessmentService({ dataRoot: setup.dataRoot }));
    const path = `${origin}/api/v1/runs/${setup.runId}/assessment`;

    const unauthenticated = await fetch(path, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "application/json", "If-Match": '"assessment:projected"' },
      body: body({ state: "text", text: sentinel })
    });
    expect(unauthenticated.status).toBe(401);
    const foreignOrigin = await fetch(path, {
      method: "PUT",
      headers: { ...requestHeaders("https://foreign.invalid", '"assessment:projected"') },
      body: body({ state: "text", text: sentinel })
    });
    expect(foreignOrigin.status).toBe(403);
    expect(inspect(setup.databasePath, setup.dataRoot).events).toEqual([]);
    expect((await durableBytes(setup.dataRoot)).includes(Buffer.from(sentinel))).toBe(false);
  });

  it("rejects malformed JSON and unknown request fields with no application write", async () => {
    const setup = await fixture();
    const origin = await serve(createAssessmentService({ dataRoot: setup.dataRoot }));
    const path = `${origin}/api/v1/runs/${setup.runId}/assessment`;
    for (const requestBody of [
      "{",
      JSON.stringify({
        schemaVersion: 1,
        verdict: "partial",
        taskCompleted: "uncertain",
        note: { state: "absent" },
        unexpected: true
      })
    ]) {
      const response = await fetch(path, {
        method: "PUT",
        headers: requestHeaders(origin, '"assessment:projected"'),
        body: requestBody
      });
      expect(response.status).toBe(400);
    }
    expect(inspect(setup.databasePath, setup.dataRoot).events).toEqual([]);
  });

  it("maps a missing run to the closed run-not-found response without creating evidence", async () => {
    const setup = await fixture();
    const origin = await serve(createAssessmentService({ dataRoot: setup.dataRoot }));
    const response = await fetch(`${origin}/api/v1/runs/missing-run/assessment`, {
      method: "PUT",
      headers: requestHeaders(origin, '"assessment:projected"'),
      body: body()
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: "run_not_found",
        message: "Run was not found.",
        retryable: false
      }
    });
    expect(inspect(setup.databasePath, setup.dataRoot).events).toEqual([]);
  });

  it("rejects duplicate conditional/content headers, invalid UTF-8, and the route body bound", async () => {
    const setup = await fixture();
    const origin = await serve(createAssessmentService({ dataRoot: setup.dataRoot }));
    const path = `/api/v1/runs/${setup.runId}/assessment`;
    const base = [
      "Authorization", authorization,
      "Origin", origin,
      "Content-Type", "application/json"
    ];
    const valid = Buffer.from(body(), "utf8");

    const duplicateMatch = await rawPut(origin, path, [
      ...base,
      "If-Match", '"assessment:projected"',
      "If-Match", '"assessment:projected"'
    ], valid);
    expect(duplicateMatch.status).toBe(400);

    const duplicateType = await rawPut(origin, path, [
      "Authorization", authorization,
      "Origin", origin,
      "Content-Type", "application/json",
      "Content-Type", "application/json",
      "If-Match", '"assessment:projected"'
    ], valid);
    expect(duplicateType.status).toBe(400);

    const invalidUtf8 = await rawPut(origin, path, [
      ...base,
      "If-Match", '"assessment:projected"'
    ], Buffer.from([0xff, 0xfe]));
    expect(invalidUtf8.status).toBe(400);

    const oversized = await fetch(`${origin}${path}`, {
      method: "PUT",
      headers: requestHeaders(origin, '"assessment:projected"'),
      body: "x".repeat(32 * 1024 + 1)
    });
    expect(oversized.status).toBe(413);
    expect(inspect(setup.databasePath, setup.dataRoot).events).toEqual([]);
  });

  it.each(["standard", "metadata-only", "strict"] as const)(
    "applies the %s note capture policy through the shared service",
    async (capturePolicy) => {
      const setup = await fixture(capturePolicy);
      const sentinel = `API_KEY=HTTP_${capturePolicy.toUpperCase()}_NOTE_1f92b7`;
      const origin = await serve(createAssessmentService({
        dataRoot: setup.dataRoot,
        now: () => new Date("2026-08-31T18:20:00.000Z"),
        eventId: () => `assessment-http-${capturePolicy}`
      }));
      const response = await fetch(`${origin}/api/v1/runs/${setup.runId}/assessment`, {
        method: "PUT",
        headers: requestHeaders(origin, '"assessment:projected"'),
        body: body({ state: "text", text: sentinel })
      });

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain(sentinel);
      const stored = inspect(setup.databasePath, setup.dataRoot);
      expect(stored.current.note).toEqual(capturePolicy === "standard"
        ? { state: "artifact", artifactId: expect.any(String) }
        : { state: "omitted", reason: capturePolicy });
      expect(stored.artifacts).toHaveLength(capturePolicy === "standard" ? 1 : 0);
      const bytes = await durableBytes(setup.dataRoot);
      expect(bytes.includes(Buffer.from(sentinel))).toBe(false);
      if (capturePolicy === "standard") {
        expect(bytes.toString("utf8")).toMatch(
          /\[\[REDACTED:assignment-api-key:hmac-sha256:[0-9a-f]{32}\]\]/
        );
      }
    }
  );

  it("accepts explicit unreviewed only with uncertain completion and keeps empty text absent", async () => {
    const setup = await fixture();
    const origin = await serve(createAssessmentService({
      dataRoot: setup.dataRoot,
      now: () => new Date("2026-08-31T18:21:00.000Z"),
      eventId: () => "assessment-http-explicit-unreviewed"
    }));
    const path = `${origin}/api/v1/runs/${setup.runId}/assessment`;
    const invalid = await fetch(path, {
      method: "PUT",
      headers: requestHeaders(origin, '"assessment:projected"'),
      body: JSON.stringify({
        schemaVersion: 1,
        verdict: "unreviewed",
        taskCompleted: "yes",
        note: { state: "absent" }
      })
    });
    expect(invalid.status).toBe(400);

    const accepted = await fetch(path, {
      method: "PUT",
      headers: requestHeaders(origin, '"assessment:projected"'),
      body: JSON.stringify({
        schemaVersion: 1,
        verdict: "unreviewed",
        taskCompleted: "uncertain",
        note: { state: "text", text: "" }
      })
    });
    expect(accepted.status).toBe(200);
    expect(inspect(setup.databasePath, setup.dataRoot).current).toMatchObject({
      state: "explicit",
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: { state: "absent" }
    });
  });
});
