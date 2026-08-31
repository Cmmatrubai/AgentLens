import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, RunRepository } from "@agentlens/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createAssessmentService } from "../src/assessmentService.js";

const roots: string[] = [];
const assessedAt = new Date("2026-08-31T18:00:00.000Z");

async function fixture(capturePolicy: "standard" | "metadata-only" | "strict" = "standard") {
  const root = await mkdtemp(join(tmpdir(), "agentlens-assessment-service-"));
  roots.push(root);
  const dataRoot = join(root, "data");
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(dataRoot, "agentlens.sqlite");
  const database = openDatabase(databasePath);
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    });
    repository.createRun({
      id: `run-${capturePolicy}`,
      schemaVersion: 1,
      provider: "codex-exec",
      integrationVersion: "0.1.0",
      agentVersion: "fixture",
      capturePolicy,
      capturePolicyVersion: "1",
      redactionVersion: "1",
      repositoryFingerprint: `fingerprint-${capturePolicy}`,
      repositoryDisplay: "fixture-repository",
      startedAt: assessedAt.getTime() - 1_000
    }, {
      recorderInstanceId: `recorder-${capturePolicy}`,
      recorderPid: 100,
      recorderStartToken: `token-${capturePolicy}`,
      heartbeatAt: assessedAt.getTime() - 1_000
    });
  } finally {
    database.close();
  }
  return { dataRoot, databasePath, runId: `run-${capturePolicy}` };
}

async function regularFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return regularFiles(path);
    return entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

async function durableBytes(root: string): Promise<Buffer> {
  return Buffer.concat(await Promise.all((await regularFiles(root)).map((path) => readFile(path))));
}

function current(databasePath: string, dataRoot: string, runId: string) {
  const database = openDatabase(databasePath);
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    });
    return {
      assessment: repository.getCurrentAssessment(runId),
      events: repository.getRunDetail(runId).events,
      artifacts: repository.getRunDetail(runId).artifacts
    };
  } finally {
    database.close();
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("shared assessment application service", () => {
  it("redacts a standard note in memory before any durable bytes are written", async () => {
    const setup = await fixture("standard");
    const sentinel = "API_KEY=STANDARD_NOTE_SECRET_913df98d";
    const service = createAssessmentService({
      dataRoot: setup.dataRoot,
      now: () => assessedAt,
      eventId: () => "assessment-standard"
    });

    const result = await service.assess({
      runId: setup.runId,
      verdict: "partial",
      taskCompleted: "uncertain",
      note: sentinel,
      expectedRevision: { state: "unconditional" }
    });

    expect(result).toMatchObject({
      state: "explicit",
      currentEventId: "assessment-standard",
      note: { state: "artifact" }
    });
    const stored = current(setup.databasePath, setup.dataRoot, setup.runId);
    expect(stored.events).toHaveLength(1);
    expect(stored.artifacts).toHaveLength(1);
    const bytes = await durableBytes(setup.dataRoot);
    expect(bytes.includes(Buffer.from(sentinel))).toBe(false);
    expect(bytes.toString("utf8")).toMatch(/\[\[REDACTED:assignment-api-key:hmac-sha256:[0-9a-f]{32}\]\]/);
  });

  it.each(["metadata-only", "strict"] as const)(
    "%s omits a supplied note without invoking the note-content pipeline",
    async (capturePolicy) => {
      const setup = await fixture(capturePolicy);
      const sentinel = `POLICY_NOTE_SENTINEL_${capturePolicy}_341b5d`;
      const fail = () => {
        throw new Error(`note-content pipeline received ${sentinel}`);
      };
      const service = createAssessmentService({
        dataRoot: setup.dataRoot,
        now: () => assessedAt,
        eventId: () => `assessment-${capturePolicy}`,
        noteContent: {
          loadKey: fail,
          redact: fail,
          write: fail
        } as never
      });

      const result = await service.assess({
        runId: setup.runId,
        verdict: "failure",
        taskCompleted: "no",
        note: sentinel,
        expectedRevision: { state: "unconditional" }
      });

      expect(result.note).toEqual({ state: "omitted", reason: capturePolicy });
      expect((await durableBytes(setup.dataRoot)).includes(Buffer.from(sentinel))).toBe(false);
      const stored = current(setup.databasePath, setup.dataRoot, setup.runId);
      expect(stored.artifacts).toEqual([]);
      expect(stored.events[0]?.normalizedPayload).toMatchObject({
        note: { state: "omitted", reason: capturePolicy }
      });
    }
  );

  it("measures the note limit in UTF-8 bytes and accepts the exact 16 KiB boundary", async () => {
    const setup = await fixture("standard");
    const service = createAssessmentService({
      dataRoot: setup.dataRoot,
      now: () => assessedAt,
      eventId: () => "assessment-exact-boundary"
    });

    await expect(service.assess({
      runId: setup.runId,
      verdict: "success",
      taskCompleted: "yes",
      note: "é".repeat(8 * 1024),
      expectedRevision: { state: "unconditional" }
    })).resolves.toMatchObject({ currentEventId: "assessment-exact-boundary" });

    const before = current(setup.databasePath, setup.dataRoot, setup.runId);
    await expect(service.assess({
      runId: setup.runId,
      verdict: "success",
      taskCompleted: "yes",
      note: `${"é".repeat(8 * 1024)}a`,
      expectedRevision: { state: "unconditional" }
    })).rejects.toThrow(/16 KiB UTF-8 limit/i);
    expect(current(setup.databasePath, setup.dataRoot, setup.runId)).toEqual(before);
  });

  it("rejects invalid explicit unreviewed input before creating a missing data root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-assessment-service-invalid-"));
    roots.push(root);
    const dataRoot = join(root, "missing-data-root");
    const service = createAssessmentService({ dataRoot });

    await expect(service.assess({
      runId: "missing-run",
      verdict: "unreviewed",
      taskCompleted: "yes",
      expectedRevision: { state: "unconditional" }
    })).rejects.toThrow(/unreviewed.*uncertain/i);
    await expect(readdir(dataRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses content-addressed bytes without exposing the original note identity", async () => {
    const setup = await fixture("standard");
    const note = "reviewer note without secrets";
    const service = createAssessmentService({
      dataRoot: setup.dataRoot,
      now: () => assessedAt,
      eventId: () => "assessment-content-addressed"
    });
    const result = await service.assess({
      runId: setup.runId,
      verdict: "success",
      taskCompleted: "yes",
      note,
      expectedRevision: { state: "unconditional" }
    });

    expect(result.note).toEqual({
      state: "artifact",
      artifactId: createHash("sha256").update(note).digest("hex")
    });
  });
});
