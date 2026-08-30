import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, RunRepository } from "@agentlens/storage";

import { recordRun } from "../src/recordRun.js";
import { runAssessCommand } from "../src/commands/assess.js";
import { runInspectCommand } from "../src/commands/inspect.js";
import { runRunsCommand } from "../src/commands/runs.js";
import type { ProcessIdentityInspector } from "../src/processIdentity.js";

const execFile = promisify(execFileCallback);
const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const roots: string[] = [];
const silentOutput = { write: () => true };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentlens-cli-read-"));
  roots.push(root);
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const dataRoot = join(root, "data");
  await mkdir(repo);
  await mkdir(bin);
  await execFile("git", ["init", "-q"], { cwd: repo });
  await execFile("git", ["config", "user.email", "fixture@example.test"], { cwd: repo });
  await execFile("git", ["config", "user.name", "AgentLens Fixture"], { cwd: repo });
  await writeFile(join(repo, "tracked.txt"), "before\n");
  await execFile("git", ["add", "tracked.txt"], { cwd: repo });
  await execFile("git", ["commit", "-qm", "initial"], { cwd: repo });
  await copyFile(fakeCodex, join(bin, "codex"));
  await chmod(join(bin, "codex"), 0o700);
  return {
    root,
    repo,
    dataRoot,
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
  };
}

function piped(): NodeJS.ReadStream {
  return Object.assign(Readable.from([]), { isTTY: false }) as unknown as NodeJS.ReadStream;
}

function writer() {
  let text = "";
  return {
    output: { write: (chunk: string | Uint8Array) => { text += String(chunk); return true; } },
    text: () => text
  };
}

interface SnapshotEntry {
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  mode: string;
  uid: string;
  gid: string;
  size: string;
  mtimeNs: string;
  inode: string;
  sha256?: string;
  target?: string;
}

async function snapshot(path: string): Promise<SnapshotEntry[] | null> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const entries: SnapshotEntry[] = [];
  const visit = async (current: string): Promise<void> => {
    const stats = await lstat(current, { bigint: true });
    const kind = stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : stats.isSymbolicLink()
          ? "symlink"
          : "other";
    const entry: SnapshotEntry = {
      path: relative(path, current) || ".",
      kind,
      mode: stats.mode.toString(),
      uid: stats.uid.toString(),
      gid: stats.gid.toString(),
      size: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      inode: stats.ino.toString()
    };
    if (kind === "file") {
      entry.sha256 = createHash("sha256").update(await readFile(current)).digest("hex");
    } else if (kind === "symlink") {
      entry.target = await readlink(current);
    }
    entries.push(entry);
    if (kind === "directory") {
      for (const child of (await readdir(current)).sort()) await visit(join(current, child));
    }
  };
  await visit(path);
  return entries;
}

async function downgradeToTask5(databasePath: string): Promise<void> {
  await execFile("sqlite3", [databasePath, `
    PRAGMA foreign_keys = OFF;
    DROP TABLE event_artifact_bindings;
    DROP TABLE current_assessments;
    DROP TABLE derivation_identities;
    DELETE FROM schema_migrations WHERE version = 4;
    PRAGMA journal_mode = DELETE;
  `]);
}

function identityInspector(
  state: "same" | "gone" | "replaced" | "ambiguous"
): ProcessIdentityInspector {
  return {
    captureStartToken: async () => "read-only-fixture-token",
    inspect: async () => state,
    inspectGroup: () => "gone"
  };
}

async function largeNativeFixture() {
  const context = await fixture();
  const recorded = await recordRun(
    {
      name: "record",
      capture: "standard",
      dataRoot: context.dataRoot,
      childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-large"]
    },
    { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
  );
  const inspected = await runInspectCommand({
    name: "inspect",
    runId: recorded.runId,
    dataRoot: context.dataRoot,
    json: true,
    native: false
  }, { stdout: silentOutput });
  const native = inspected.events.find(({ kind }) => kind === "source.unknown")?.nativePayload;
  if (native?.storage !== "artifact") throw new Error("expected native artifact fixture");
  const artifact = inspected.artifacts.find(({ id }) => id === native.artifactId);
  if (!artifact) throw new Error("missing native artifact fixture metadata");
  return { context, recorded, artifact };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runs and inspect", () => {
  it("rejects a symlinked data root without reading, writing, or chmodding its target", async () => {
    const context = await fixture();
    const outside = join(context.repo, "outside-data-target");
    const sentinel = join(outside, "sentinel.txt");
    await mkdir(outside, { mode: 0o755 });
    await writeFile(sentinel, "OUTSIDE_DATA_ROOT_SENTINEL", { mode: 0o644 });
    await symlink(outside, context.dataRoot);
    const before = await snapshot(context.root);

    await expect(runRunsCommand(
      { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
      { stdout: silentOutput }
    )).rejects.toThrow(/symbolic|symlink/i);

    expect(await snapshot(context.root)).toEqual(before);
    expect(await readFile(sentinel, "utf8")).toBe("OUTSIDE_DATA_ROOT_SENTINEL");
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
    expect((await stat(sentinel)).mode & 0o777).toBe(0o644);
  });

  it.each(["runs", "inspect"] as const)(
    "%s returns the missing-storage contract without creating the requested root",
    async (name) => {
      const context = await fixture();
      const output = writer();

      if (name === "runs") {
        const value = await runRunsCommand(
          { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
          { stdout: output.output }
        );
        expect(value).toEqual({ runs: [] });
        expect(JSON.parse(output.text())).toEqual({ runs: [] });
      } else {
        await expect(runInspectCommand(
          { name: "inspect", runId: "missing-run", dataRoot: context.dataRoot, json: true, native: false },
          { stdout: output.output }
        )).rejects.toThrow(/run not found/i);
        expect(output.text()).toBe("");
      }
      expect(await snapshot(context.dataRoot)).toBeNull();
    }
  );

  it.each(["runs", "inspect"] as const)(
    "%s preserves an existing root without a database",
    async (name) => {
      const context = await fixture();
      await mkdir(context.dataRoot, { mode: 0o755 });
      const before = await snapshot(context.root);
      const output = writer();

      if (name === "runs") {
        await expect(runRunsCommand(
          { name: "runs", dataRoot: context.dataRoot, limit: 10, json: false },
          { stdout: output.output }
        )).resolves.toEqual({ runs: [] });
        expect(output.text()).toBe("No AgentLens runs found.\n");
      } else {
        await expect(runInspectCommand(
          { name: "inspect", runId: "missing-run", dataRoot: context.dataRoot, json: true, native: false },
          { stdout: output.output }
        )).rejects.toThrow(/run not found/i);
        expect(output.text()).toBe("");
      }
      expect(await snapshot(context.root)).toEqual(before);
    }
  );

  it.each(["runs", "inspect", "assess"] as const)(
    "%s fails closed on a regular WAL without a main database",
    async (name) => {
      const context = await fixture();
      await mkdir(context.dataRoot, { mode: 0o755 });
      await writeFile(join(context.dataRoot, "agentlens.sqlite-wal"), "ORPHAN_WAL_SENTINEL", {
        mode: 0o666
      });
      const before = await snapshot(context.dataRoot);
      const output = writer();
      const read = name === "runs"
        ? runRunsCommand(
            { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
            { stdout: output.output }
          )
        : name === "inspect"
          ? runInspectCommand(
              { name: "inspect", runId: "missing-run", dataRoot: context.dataRoot, json: true, native: false },
              { stdout: output.output }
            )
          : runAssessCommand({
              name: "assess",
              runId: "missing-run",
              verdict: "unreviewed",
              taskCompleted: "uncertain",
              dataRoot: context.dataRoot,
              json: true
            }, { stdout: output.output });

      await expect(read).rejects.toThrow(/wal_present/);
      expect(output.text()).toBe("");
      expect(await snapshot(context.dataRoot)).toEqual(before);
    }
  );

  it.each(["", "-wal", "-shm"] as const)(
    "rejects a symlinked agentlens.sqlite%s without mutating its external target",
    async (suffix) => {
      const context = await fixture();
      const recorded = await recordRun(
        {
          name: "record",
          capture: "standard",
          dataRoot: context.dataRoot,
          childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
        },
        { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
      );
      const databasePath = join(context.dataRoot, "agentlens.sqlite");
      const protectedPath = `${databasePath}${suffix}`;
      await rm(protectedPath, { force: true });
      const outsideTarget = join(context.repo, `outside-sqlite${suffix || "-db"}.txt`);
      await writeFile(outsideTarget, "OUTSIDE_SQLITE_SENTINEL", { mode: 0o644 });
      await symlink(outsideTarget, protectedPath);

      const before = await snapshot(context.root);
      await expect(runInspectCommand(
        { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
        { stdout: silentOutput }
      )).rejects.toThrow(/symbolic|symlink/i);

      expect(await readFile(outsideTarget, "utf8")).toBe("OUTSIDE_SQLITE_SENTINEL");
      expect((await stat(outsideTarget)).mode & 0o777).toBe(0o644);
      expect(await snapshot(context.root)).toEqual(before);
    }
  );

  it.each(["runs", "inspect"] as const)(
    "%s preserves permissive modes and every byte and metadata field on success",
    async (command) => {
      const context = await fixture();
      const recorded = await recordRun(
        {
          name: "record",
          capture: "standard",
          dataRoot: context.dataRoot,
          childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
        },
        { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
      );
      const databasePath = join(context.dataRoot, "agentlens.sqlite");
      await chmod(databasePath, 0o666);
      await chmod(context.dataRoot, 0o777);
      await mkdir(join(context.dataRoot, "unknown"), { mode: 0o755 });
      await writeFile(join(context.dataRoot, "unknown", "sentinel.bin"), "UNKNOWN_SENTINEL", {
        mode: 0o644
      });
      await writeFile(`${databasePath}-shm`, "REGULAR_SHM_SENTINEL", { mode: 0o666 });
      const before = await snapshot(context.dataRoot);

      if (command === "runs") {
        await runRunsCommand(
          { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
          { stdout: silentOutput }
        );
      } else {
        await runInspectCommand(
          { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
          { stdout: silentOutput }
        );
      }

      expect(await snapshot(context.dataRoot)).toEqual(before);
    }
  );

  it.each(["runs", "inspect"] as const)(
    "%s fails closed on an exact regular WAL path without changing storage",
    async (command) => {
      const context = await fixture();
      const recorded = await recordRun(
        {
          name: "record",
          capture: "standard",
          dataRoot: context.dataRoot,
          childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
        },
        { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
      );
      await writeFile(join(context.dataRoot, "agentlens.sqlite-wal"), "WAL_SENTINEL", {
        mode: 0o666
      });
      const before = await snapshot(context.dataRoot);
      const read = command === "runs"
        ? runRunsCommand(
            { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
            { stdout: silentOutput }
          )
        : runInspectCommand(
            { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
            { stdout: silentOutput }
          );

      await expect(read).rejects.toThrow(/wal_present/);
      expect(await snapshot(context.dataRoot)).toEqual(before);
    }
  );

  it.each(["", "-wal", "-shm"] as const)(
    "rejects a non-regular agentlens.sqlite%s path without changing storage",
    async (suffix) => {
      const context = await fixture();
      const recorded = await recordRun(
        {
          name: "record",
          capture: "standard",
          dataRoot: context.dataRoot,
          childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
        },
        { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
      );
      const path = `${join(context.dataRoot, "agentlens.sqlite")}${suffix}`;
      await rm(path, { force: true });
      await mkdir(path);
      const before = await snapshot(context.dataRoot);

      await expect(runInspectCommand(
        { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
        { stdout: silentOutput }
      )).rejects.toThrow(/regular file/i);
      expect(await snapshot(context.dataRoot)).toEqual(before);
    }
  );

  it("reads a Task 5 schema without migration and projects assessment/summary compatibly", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const databasePath = join(context.dataRoot, "agentlens.sqlite");
    await downgradeToTask5(databasePath);
    const before = await snapshot(context.dataRoot);

    const runs = await runRunsCommand(
      { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
      { stdout: silentOutput }
    );
    const inspected = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: silentOutput }
    );

    expect(runs.runs[0]).toMatchObject({
      id: recorded.runId,
      likelyTests: { state: "detected" },
      assessment: { state: "projected", provenance: null }
    });
    expect(inspected.summary).toMatchObject({
      likelyTests: { state: "detected" },
      assessment: { state: "projected", provenance: null }
    });
    expect(await snapshot(context.dataRoot)).toEqual(before);
    expect((await execFile("sqlite3", [databasePath,
      "SELECT group_concat(version, ',') FROM schema_migrations ORDER BY version"
    ])).stdout.trim()).toBe("1,2,3");
  });

  it("diagnoses likely-stale ownership without recovery, lifecycle, or event mutation", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const databasePath = join(context.dataRoot, "agentlens.sqlite");
    await execFile("sqlite3", [databasePath, `
      UPDATE runs SET status = 'running', ended_at = NULL WHERE id = '${recorded.runId}';
      UPDATE run_ownership SET condition = 'active', recorder_pid = 404404,
        recorder_start_token = 'gone-token' WHERE run_id = '${recorded.runId}';
      PRAGMA journal_mode = DELETE;
    `]);
    const before = await snapshot(context.dataRoot);
    const inspector = identityInspector("gone");

    const runs = await runRunsCommand(
      { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
      { stdout: silentOutput, processIdentityInspector: inspector }
    );
    const inspected = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: silentOutput, processIdentityInspector: inspector }
    );

    expect(runs.runs[0]?.ownership).toEqual({
      condition: "active",
      diagnosis: "likely_stale"
    });
    expect(inspected.ownership).toMatchObject({
      condition: "active",
      diagnosis: "likely_stale"
    });
    expect(inspected.ownershipDiagnosis).toEqual({
      storedCondition: "active",
      diagnosis: "likely_stale"
    });
    expect(inspected.events.filter(({ kind }) => kind === "recorder.recovery")).toEqual([]);
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("reports a derivation gap in memory without filling it or appending human evidence", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      {
        cwd: context.repo,
        stdin: piped(),
        env: context.env,
        stdout: silentOutput,
        derivePersistedTerminalCommand: () => [],
        ensureTestDerivationsForRun: () => []
      }
    );
    const before = await snapshot(context.dataRoot);

    const inspected = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: silentOutput }
    );

    expect(inspected.summary.likelyTests).toMatchObject({
      state: "detected",
      durability: "incomplete",
      missingExpected: 2
    });
    expect(inspected.events.filter(({ provenance }) => provenance === "derived")).toEqual([
      expect.objectContaining({ kind: "run.reconciled" })
    ]);
    expect(inspected.events.filter(({ provenance }) => provenance === "human")).toEqual([]);
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("returns JSON run/process/Git/capability facts without collapsing them", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const output = writer();
    const value = await runRunsCommand(
      { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
      { stdout: output.output }
    );

    expect(value.runs[0]).toMatchObject({
      id: recorded.runId,
      status: "completed",
      child: { exitCode: 0, terminatingSignal: null },
      git: { headChanged: false, branchChanged: false },
      capabilities: {
        sourceTimestamps: false,
        fileReads: "unavailable",
        toolOutput: "partial",
        toolDurations: "unavailable",
        interruptionSignal: "partial"
      }
    });
    expect(JSON.parse(output.text())).toEqual(value);
  });

  it("returns chronological immutable events, provenance, relationships, native refs, and exact Git terminology", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=malformed-unknown-stderr"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const output = writer();
    const value = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: output.output }
    );

    expect(value.events.map(({ sequence }) => sequence)).toEqual(
      [...value.events.map(({ sequence }) => sequence)].sort((a, b) => a - b)
    );
    expect(value.events.every(({ provenance, source, relationships }) =>
      typeof provenance === "string" && source.provider === "codex-exec" && Array.isArray(relationships)
    )).toBe(true);
    expect(value.events.some(({ nativePayload }) => nativePayload?.storage === "inline")).toBe(true);
    expect(JSON.stringify(value.events)).not.toContain('"redacted"');
    expect(value.contradictions).toEqual([]);
    expect(value.gitEvidence.terminology).toEqual({
      trackedFinalDiff: "tracked final diff",
      untrackedMetadata: "untracked-file metadata"
    });
    expect(JSON.parse(output.text())).toEqual(value);
  });

  it("shows complete source/Git evidence and explicit old-to-new Git warnings in text and JSON", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=git-change"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const jsonOutput = writer();
    const value = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: jsonOutput.output }
    );
    const gitEvidence = value.gitEvidence;
    if (!gitEvidence.available) throw new Error("expected Git evidence");

    expect(gitEvidence.trackedFinalDiffAvailability).toBe("artifact");
    expect(gitEvidence.untrackedMetadataAvailability).toBe("absent");

    expect(value.warnings).toEqual([
      {
        code: "git_head_changed",
        message: "Git HEAD changed during the run.",
        oldValue: gitEvidence.initialHead,
        newValue: gitEvidence.finalHead
      },
      {
        code: "git_branch_changed",
        message: "Git branch changed during the run.",
        oldValue: gitEvidence.initialBranch,
        newValue: gitEvidence.finalBranch
      }
    ]);
    expect(JSON.parse(jsonOutput.text())).toEqual(value);

    const textOutput = writer();
    await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: false, native: false },
      { stdout: textOutput.output }
    );
    const text = textOutput.text();
    expect(text).toContain(
      `Git initial: HEAD=${gitEvidence.initialHead} branch=${String(gitEvidence.initialBranch)}`
    );
    expect(text).toContain(
      `Git final: HEAD=${gitEvidence.finalHead} branch=${String(gitEvidence.finalBranch)}`
    );
    expect(text).toContain("tracked final diff=artifact");
    expect(text).toContain("untracked-file metadata=absent");
    expect(text).toContain(
      `WARNING: Git HEAD changed during the run: ${gitEvidence.initialHead} -> ${gitEvidence.finalHead}`
    );
    expect(text).toContain(
      `WARNING: Git branch changed during the run: ${String(gitEvidence.initialBranch)} -> ${String(gitEvidence.finalBranch)}`
    );
    expect(text).toContain(
      "source: provider=codex-exec sessionId=none threadId=fixture-thread turnId=fixture-turn itemId=message-git-change toolId=none eventType=item.completed itemType=agent_message correlationId=none"
    );
    expect(text).toContain("relationships: none");
  });

  it("explicitly marks every Git field unavailable when final evidence cannot be recovered", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=remove-git"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const jsonOutput = writer();
    const json = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: jsonOutput.output }
    );

    expect(json.gitEvidence).toMatchObject({
      available: false,
      initialHead: null,
      finalHead: null,
      initialBranch: null,
      finalBranch: null,
      headChanged: null,
      branchChanged: null,
      trackedFinalDiffAvailability: "unavailable",
      untrackedMetadataAvailability: "unavailable"
    });
    expect(JSON.parse(jsonOutput.text())).toEqual(json);

    const textOutput = writer();
    await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: false, native: false },
      { stdout: textOutput.output }
    );
    expect(textOutput.text()).toContain("Git initial: HEAD=unavailable branch=unavailable");
    expect(textOutput.text()).toContain("Git final: HEAD=unavailable branch=unavailable");
    expect(textOutput.text()).toContain(
      "Git evidence availability: tracked final diff=unavailable; untracked-file metadata=unavailable"
    );
  });

  it("exposes every available provider source identifier in text and JSON", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=source-identifiers"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const jsonOutput = writer();
    const json = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: jsonOutput.output }
    );
    const event = json.events.find(({ source }) => source.sessionId === "fixture-session");

    expect(event?.source).toEqual({
      provider: "codex-exec",
      sessionId: "fixture-session",
      threadId: "fixture-thread",
      turnId: "fixture-turn",
      itemId: "fixture-item",
      toolId: "fixture-tool",
      eventType: "item.completed",
      itemType: "mcp_tool_call",
      correlationId: "fixture-correlation"
    });
    expect(event?.relationships).toEqual([]);
    expect(JSON.parse(jsonOutput.text())).toEqual(json);

    const textOutput = writer();
    await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: false, native: false },
      { stdout: textOutput.output }
    );
    expect(textOutput.text()).toContain(
      "source: provider=codex-exec sessionId=fixture-session threadId=fixture-thread turnId=fixture-turn itemId=fixture-item toolId=fixture-tool eventType=item.completed itemType=mcp_tool_call correlationId=fixture-correlation"
    );
    expect(textOutput.text()).toContain("relationships: none");
  });

  it("explains agent-version and prompt-source limitations in text and JSON", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const jsonOutput = writer();
    const json = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: jsonOutput.output }
    );

    expect(json.metadataSemantics).toEqual({
      agentVersion: {
        value: "unknown",
        availability: "unavailable",
        reason: "Codex exec JSONL does not expose the agent version in v0.1."
      },
      promptSource: {
        value: "stdin-buffered",
        meaning: "prompt/stdin transport mode",
        semanticPromptLocation: false,
        promptParsedOrAltered: false
      }
    });
    expect(JSON.parse(jsonOutput.text())).toEqual(json);

    const textOutput = writer();
    await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: false, native: false },
      { stdout: textOutput.output }
    );
    expect(textOutput.text()).toContain(
      "Agent version: unknown (unavailable: Codex exec JSONL does not expose the agent version in v0.1.)"
    );
    expect(textOutput.text()).toContain(
      "Prompt source: stdin-buffered (prompt/stdin transport mode; semantic prompt location=false; prompt parsed or altered=false)"
    );
  });

  it("reserves Recorder recovery for recovery events and labels every other recorder event Recorder", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=nonzero"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const output = writer();
    await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: false, native: false },
      { stdout: output.output }
    );

    expect(output.text()).toContain("[Recorder] recorder.process_exit");
    expect(output.text()).not.toContain("[Recorder recovery] recorder.process_exit");

    const recoveryContext = await fixture();
    const recoveryRun = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: recoveryContext.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=open-item"]
      },
      {
        cwd: recoveryContext.repo,
        stdin: piped(),
        env: recoveryContext.env,
        stdout: silentOutput
      }
    );
    const recoveryJson = await runInspectCommand(
      {
        name: "inspect",
        runId: recoveryRun.runId,
        dataRoot: recoveryContext.dataRoot,
        json: true,
        native: false
      },
      { stdout: silentOutput }
    );
    const recovery = recoveryJson.events.find(({ kind }) => kind === "recorder.recovery");
    expect(recovery?.relationships).toEqual([
      expect.objectContaining({ type: "recovers", eventId: expect.any(String) })
    ]);

    const recoveryText = writer();
    await runInspectCommand(
      {
        name: "inspect",
        runId: recoveryRun.runId,
        dataRoot: recoveryContext.dataRoot,
        json: false,
        native: false
      },
      { stdout: recoveryText.output }
    );
    expect(recoveryText.text()).toContain("[Recorder recovery] recorder.recovery");
    expect(recoveryText.text()).toContain(`relationships: recovers:${recovery?.relationships[0]?.eventId}`);
  });

  it("projects inline and artifact native content only when standard capture requests --native", async () => {
    const standardContext = await fixture();
    const standard = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: standardContext.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=native-sentinels"]
      },
      { cwd: standardContext.repo, stdin: piped(), env: standardContext.env, stdout: silentOutput }
    );
    const hiddenJson = writer();
    const hidden = await runInspectCommand({
      name: "inspect",
      runId: standard.runId,
      dataRoot: standardContext.dataRoot,
      json: true,
      native: false
    }, { stdout: hiddenJson.output });
    const hiddenText = writer();
    await runInspectCommand({
      name: "inspect",
      runId: standard.runId,
      dataRoot: standardContext.dataRoot,
      json: false,
      native: false
    }, { stdout: hiddenText.output });

    for (const sentinel of [
      "inspect-inline-visible-phrase-92841",
      "inspect-artifact-visible-phrase-73519"
    ]) {
      expect(hiddenJson.text()).not.toContain(sentinel);
      expect(hiddenText.text()).not.toContain(sentinel);
    }
    const hiddenNative = hidden.events
      .filter(({ kind }) => kind === "source.unknown")
      .map(({ nativePayload }) => nativePayload);
    expect(hiddenNative).toEqual([
      { storage: "inline", contentAvailable: true },
      expect.objectContaining({
        storage: "artifact",
        artifactId: expect.any(String),
        contentAvailable: true
      })
    ]);

    const nativeOutput = writer();
    const inspected = await runInspectCommand({
      name: "inspect",
      runId: standard.runId,
      dataRoot: standardContext.dataRoot,
      json: true,
      native: true
    }, { stdout: nativeOutput.output });
    expect(inspected.events.find(({ source }) => source.eventType === "future.inline")?.nativeContent)
      .toMatchObject({ future: { value: "inspect-inline-visible-phrase-92841" } });
    expect(inspected.events.find(({ source }) => source.eventType === "future.artifact")?.nativeContent)
      .toMatchObject({ future: { value: expect.stringContaining("inspect-artifact-visible-phrase-73519") } });
    expect(nativeOutput.text()).toContain("inspect-inline-visible-phrase-92841");
    expect(nativeOutput.text()).toContain("inspect-artifact-visible-phrase-73519");

    const nativeText = writer();
    await runInspectCommand({
      name: "inspect",
      runId: standard.runId,
      dataRoot: standardContext.dataRoot,
      json: false,
      native: true
    }, { stdout: nativeText.output });
    expect(nativeText.text()).toContain("inspect-inline-visible-phrase-92841");
    expect(nativeText.text()).toContain("inspect-artifact-visible-phrase-73519");
  });

  it.each(["metadata-only", "strict"] as const)(
    "keeps native content omitted with an explicit reason for %s even when --native is requested",
    async (capture) => {
      const context = await fixture();
      const recorded = await recordRun(
        {
          name: "record",
          capture,
          dataRoot: context.dataRoot,
          childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-small"]
        },
        { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
      );
      const jsonOutput = writer();
      const inspected = await runInspectCommand({
        name: "inspect",
        runId: recorded.runId,
        dataRoot: context.dataRoot,
        json: true,
        native: true
      }, { stdout: jsonOutput.output });
      const unknown = inspected.events.find(({ kind }) => kind === "source.unknown");

      expect(unknown?.nativePayload).toEqual({
        storage: "omitted",
        contentAvailable: false,
        reason: capture
      });
      expect(unknown).not.toHaveProperty("nativeContent");
      expect(jsonOutput.text()).not.toContain("SMALL_NATIVE_TOKEN");

      const textOutput = writer();
      await runInspectCommand({
        name: "inspect",
        runId: recorded.runId,
        dataRoot: context.dataRoot,
        json: false,
        native: true
      }, { stdout: textOutput.output });
      expect(textOutput.text()).toContain(`contentAvailable=false reason=${capture}`);
      expect(textOutput.text()).not.toContain("SMALL_NATIVE_TOKEN");
    }
  );

  it("discards a provider line above the source limit before native artifact truncation", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-truncated"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    const output = writer();
    const inspected = await runInspectCommand({
      name: "inspect",
      runId: recorded.runId,
      dataRoot: context.dataRoot,
      json: true,
      native: true
    }, { stdout: output.output });
    const diagnostic = inspected.events.find(({ kind, normalizedPayload }) =>
      kind === "recorder.stream_diagnostic" &&
      (normalizedPayload as { reason?: unknown } | undefined)?.reason === "line_too_large"
    );
    const artifact = inspected.artifacts.find(({ kind }) => kind === "native-payload");

    expect(diagnostic).toMatchObject({
      normalizedPayload: {
        stream: "stdout",
        reason: "line_too_large",
        limitBytes: 1_048_576,
        observedBytes: expect.any(Number)
      }
    });
    expect((diagnostic?.normalizedPayload as { observedBytes: number }).observedBytes)
      .toBeGreaterThan(10 * 1024 * 1024);
    expect(artifact).toBeUndefined();
    expect(output.text().length).toBeLessThan(100_000);
  });

  it.each([
    "path",
    "alternate-path",
    "colliding-path",
    "root-symlink",
    "bucket-symlink",
    "symlink",
    "digest",
    "cross-run",
    "kind",
    "media",
    "length"
  ] as const)(
    "refuses %s tampering before expanding a native artifact",
    async (tamper) => {
      const { context, recorded, artifact } = await largeNativeFixture();
      if (tamper === "path" || tamper === "alternate-path" || tamper === "colliding-path") {
        const artifactRoot = join(context.dataRoot, "artifacts", "sha256");
        const path = tamper === "path"
          ? "/etc/passwd"
          : tamper === "alternate-path"
            ? `${artifactRoot}/${artifact.id.slice(0, 2)}/../${artifact.id.slice(0, 2)}/${artifact.id}`
            : join(artifactRoot, artifact.id.slice(0, 2), "0".repeat(64));
        await execFile("sqlite3", [
          join(context.dataRoot, "agentlens.sqlite"),
          `UPDATE artifacts SET path = '${path}' WHERE run_id = '${recorded.runId}' AND id = '${artifact.id}';
           PRAGMA journal_mode = DELETE;`
        ]);
      } else if (tamper === "root-symlink" || tamper === "bucket-symlink") {
        const artifactRoot = join(context.dataRoot, "artifacts", "sha256");
        const original = tamper === "root-symlink"
          ? artifactRoot
          : join(artifactRoot, artifact.id.slice(0, 2));
        const external = join(context.root, `external-${tamper}`);
        await rename(original, external);
        await symlink(external, original);
      } else if (tamper === "symlink") {
        const target = join(context.dataRoot, "outside-native.json");
        await writeFile(target, '{"type":"tampered"}', "utf8");
        await rm(artifact.path);
        await symlink(target, artifact.path);
      } else if (tamper === "digest") {
        const bytes = await readFile(artifact.path);
        const index = bytes.indexOf(0x78);
        if (index < 0) throw new Error("native fixture lacks a mutable byte");
        bytes[index] = 0x79;
        await writeFile(artifact.path, bytes);
      } else {
        let mutation: string;
        if (tamper === "cross-run") {
          const second = await recordRun(
            {
              name: "record",
              capture: "standard",
              dataRoot: context.dataRoot,
              childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
            },
            { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
          );
          mutation = `run_id = '${second.runId}'`;
        } else {
          mutation = tamper === "kind"
            ? "kind = 'assessment-note'"
            : tamper === "media"
              ? "media_type = 'text/plain'"
              : "byte_length = byte_length - 1";
        }
        await execFile("sqlite3", [
          join(context.dataRoot, "agentlens.sqlite"),
          `UPDATE artifacts SET ${mutation} WHERE run_id = '${recorded.runId}' AND id = '${artifact.id}';
           PRAGMA journal_mode = DELETE;`
        ]);
      }

      await expect(runInspectCommand({
        name: "inspect",
        runId: recorded.runId,
        dataRoot: context.dataRoot,
        json: true,
        native: true
      }, { stdout: silentOutput })).rejects.toThrow(
        tamper === "path" || tamper === "alternate-path" || tamper === "colliding-path"
          ? /canonical|metadata path/i
          : tamper === "root-symlink" || tamper === "bucket-symlink"
            ? /canonical/i
            : tamper === "symlink"
            ? /symbolic/i
            : tamper === "digest"
              ? /digest/i
              : tamper === "cross-run"
                ? /native artifact .* unavailable/i
              : /artifact validation failed/i
      );
    }
  );

  it("shows a validated standard reviewer note only in inspect and keeps runs content-free", async () => {
    const context = await fixture();
    const note = "reviewer-note-visible-only-in-inspect-48291";
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    await runAssessCommand({
      name: "assess",
      runId: recorded.runId,
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note,
      dataRoot: context.dataRoot,
      json: true
    }, { stdout: silentOutput });
    const before = await snapshot(context.dataRoot);
    const runsOutput = writer();
    const runs = await runRunsCommand(
      { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
      { stdout: runsOutput.output }
    );
    const inspected = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: silentOutput }
    );

    expect(runs.runs[0]?.assessment).toMatchObject({
      state: "explicit",
      verdict: "unreviewed",
      note: { state: "artifact", artifactId: expect.any(String) }
    });
    expect(runsOutput.text()).not.toContain(note);
    expect(JSON.stringify(runs)).not.toContain(note);
    expect(inspected.reviewerNote).toEqual({
      state: "artifact",
      artifactId: expect.any(String),
      contentAvailable: true,
      content: note
    });
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it("rejects digest tampering through the reviewer-note consumer without leaking content", async () => {
    const context = await fixture();
    const note = "reviewer-note-digest-boundary-92174";
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    await runAssessCommand({
      name: "assess",
      runId: recorded.runId,
      verdict: "partial",
      taskCompleted: "uncertain",
      note,
      dataRoot: context.dataRoot,
      json: true
    }, { stdout: silentOutput });
    const database = openDatabase(join(context.dataRoot, "agentlens.sqlite"));
    let notePath: string;
    try {
      const detail = new RunRepository(database, {
        artifactRoot: join(context.dataRoot, "artifacts", "sha256")
      }).getRunDetail(recorded.runId);
      const noteArtifact = detail.artifacts.find(({ kind }) => kind === "assessment-note");
      if (!noteArtifact) throw new Error("missing reviewer note fixture");
      notePath = noteArtifact.path;
    } finally {
      database.close();
    }
    await writeFile(notePath, "x".repeat(Buffer.byteLength(note)), "utf8");

    const runsOutput = writer();
    await expect(runRunsCommand(
      { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
      { stdout: runsOutput.output }
    )).resolves.toMatchObject({ runs: [expect.any(Object)] });
    expect(runsOutput.text()).not.toContain(note);

    await expect(runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: silentOutput }
    )).rejects.toThrow(/artifact validation failed \(digest\)/i);
  });

  it.each([
    "cross-run",
    "kind",
    "media",
    "length",
    "truncated",
    "invalid-utf8"
  ] as const)("fails closed on %s tampering through the reviewer-note consumer", async (tamper) => {
    const context = await fixture();
    const note = `reviewer-note-${tamper}-boundary-57283`;
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    await runAssessCommand({
      name: "assess",
      runId: recorded.runId,
      verdict: "partial",
      taskCompleted: "uncertain",
      note,
      dataRoot: context.dataRoot,
      json: true
    }, { stdout: silentOutput });
    const databasePath = join(context.dataRoot, "agentlens.sqlite");
    const database = openDatabase(databasePath);
    let artifact: ReturnType<RunRepository["getRunDetail"]>["artifacts"][number];
    try {
      const detail = new RunRepository(database, {
        artifactRoot: join(context.dataRoot, "artifacts", "sha256")
      }).getRunDetail(recorded.runId);
      const found = detail.artifacts.find(({ kind }) => kind === "assessment-note");
      if (!found) throw new Error("missing reviewer note fixture");
      artifact = found;
    } finally {
      database.close();
    }

    if (tamper === "invalid-utf8") {
      const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
      const id = createHash("sha256").update(bytes).digest("hex");
      const path = join(context.dataRoot, "artifacts", "sha256", id.slice(0, 2), id);
      await mkdir(join(context.dataRoot, "artifacts", "sha256", id.slice(0, 2)), { recursive: true });
      await writeFile(path, bytes);
      await execFile("sqlite3", [databasePath, `
        UPDATE artifacts SET
          id = '${id}', path = '${path}', sha256 = '${id}',
          byte_length = ${bytes.byteLength}, original_byte_length = ${bytes.byteLength}
        WHERE id = '${artifact.id}';
        UPDATE current_assessments SET note_artifact_id = '${id}'
        WHERE run_id = '${recorded.runId}';
        UPDATE event_artifact_bindings SET artifact_id = '${id}'
        WHERE run_id = '${recorded.runId}' AND artifact_id = '${artifact.id}';
        PRAGMA journal_mode = DELETE;
      `]);
    } else {
      let mutation: string;
      if (tamper === "cross-run") {
        const second = await recordRun(
          {
            name: "record",
            capture: "standard",
            dataRoot: context.dataRoot,
            childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
          },
          { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
        );
        mutation = `run_id = '${second.runId}'`;
      } else {
        mutation = tamper === "kind"
          ? "kind = 'native-payload'"
          : tamper === "media"
            ? "media_type = 'application/json'"
            : tamper === "length"
              ? "byte_length = byte_length - 1"
              : "truncated = 1, original_byte_length = byte_length + 1";
      }
      await execFile("sqlite3", [databasePath, `
        UPDATE artifacts SET ${mutation} WHERE id = '${artifact.id}';
        PRAGMA journal_mode = DELETE;
      `]);
    }

    const before = await snapshot(context.dataRoot);
    const runsOutput = writer();
    await expect(runRunsCommand(
      { name: "runs", dataRoot: context.dataRoot, limit: 10, json: true },
      { stdout: runsOutput.output }
    )).resolves.toMatchObject({ runs: expect.any(Array) });
    expect(runsOutput.text()).not.toContain(note);

    await expect(runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: silentOutput }
    )).rejects.toThrow(
      tamper === "cross-run"
        ? /reviewer note artifact is unavailable/i
        : tamper === "invalid-utf8"
          ? /reviewer note artifact has invalid utf-8/i
          : /artifact validation failed/i
    );
    expect(await snapshot(context.dataRoot)).toEqual(before);
  });

  it.each(["metadata-only", "strict"] as const)(
    "reports exact %s reviewer-note omission without reading content",
    async (capture) => {
      const context = await fixture();
      const note = `restrictive-reviewer-note-${capture}-18374`;
      const recorded = await recordRun(
        {
          name: "record",
          capture,
          dataRoot: context.dataRoot,
          childArgs: ["codex", "exec", "--json", "--fake-mode=success"]
        },
        { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
      );
      await runAssessCommand({
        name: "assess",
        runId: recorded.runId,
        verdict: "partial",
        taskCompleted: "uncertain",
        note,
        dataRoot: context.dataRoot,
        json: true
      }, { stdout: silentOutput });

      const inspected = await runInspectCommand(
        { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
        { stdout: silentOutput }
      );
      expect(inspected.reviewerNote).toEqual({
        state: "omitted",
        contentAvailable: false,
        reason: capture
      });
      expect(JSON.stringify(inspected)).not.toContain(note);
    }
  );

  it("preserves derived identity/source relationships and distinct provenance labels", async () => {
    const context = await fixture();
    const recorded = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=test-command"]
      },
      { cwd: context.repo, stdin: piped(), env: context.env, stdout: silentOutput }
    );
    await runAssessCommand({
      name: "assess",
      runId: recorded.runId,
      verdict: "success",
      taskCompleted: "yes",
      dataRoot: context.dataRoot,
      json: true
    }, { stdout: silentOutput });
    const json = await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: true, native: false },
      { stdout: silentOutput }
    );
    const command = json.events.find(({ kind }) => kind === "test.command");
    expect(command).toMatchObject({
      provenance: "derived",
      relationships: [{ type: "derived_from", eventId: expect.any(String) }],
      derivation: {
        name: "test-command",
        version: "1",
        sourceEventIds: [expect.any(String)],
        confidence: expect.any(String),
        identity: expect.stringMatching(/^agentlens-derivation-sha256:/)
      }
    });

    const output = writer();
    await runInspectCommand(
      { name: "inspect", runId: recorded.runId, dataRoot: context.dataRoot, json: false, native: false },
      { stdout: output.output }
    );
    expect(output.text()).toContain("[Provider]");
    expect(output.text()).toContain("[Derived]");
    expect(output.text()).toContain("[Git recovered]");
    expect(output.text()).toContain("[Recorder]");
    expect(output.text()).toContain("[Human]");
    expect(output.text()).toContain("Likely tests: latest passed, previous failures 0");
    expect(output.text()).not.toMatch(/\btests passed\b/i);
    expect(output.text()).toContain("Reviewer: success (explicit)");
  });
});
