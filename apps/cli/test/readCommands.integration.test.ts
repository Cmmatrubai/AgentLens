import { execFile as execFileCallback } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { recordRun } from "../src/recordRun.js";
import { runInspectCommand } from "../src/commands/inspect.js";
import { runRunsCommand } from "../src/commands/runs.js";

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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runs and inspect", () => {
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
    expect(value.contradictions).toEqual([]);
    expect(value.gitEvidence.terminology).toEqual({
      trackedFinalDiff: "tracked final diff",
      untrackedMetadata: "untracked-file metadata"
    });
    expect(JSON.parse(output.text())).toEqual(value);
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
  });

  it("refuses native expansion outside standard capture and reads only redacted standard artifacts", async () => {
    const metadataContext = await fixture();
    const metadata = await recordRun(
      {
        name: "record",
        capture: "metadata-only",
        dataRoot: metadataContext.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-small"]
      },
      { cwd: metadataContext.repo, stdin: piped(), env: metadataContext.env, stdout: silentOutput }
    );
    await expect(runInspectCommand({
      name: "inspect",
      runId: metadata.runId,
      dataRoot: metadataContext.dataRoot,
      json: true,
      native: true
    })).rejects.toThrow(/standard capture/i);

    const standardContext = await fixture();
    const standard = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: standardContext.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-large"]
      },
      { cwd: standardContext.repo, stdin: piped(), env: standardContext.env, stdout: silentOutput }
    );
    const nativeOutput = writer();
    const inspected = await runInspectCommand({
      name: "inspect",
      runId: standard.runId,
      dataRoot: standardContext.dataRoot,
      json: true,
      native: true
    }, { stdout: nativeOutput.output });
    const unknown = inspected.events.find(({ kind }) => kind === "source.unknown");
    expect(unknown?.nativeContent).toMatchObject({ type: "future.event" });

    const nativeText = writer();
    await runInspectCommand({
      name: "inspect",
      runId: standard.runId,
      dataRoot: standardContext.dataRoot,
      json: false,
      native: true
    }, { stdout: nativeText.output });
    expect(nativeText.text()).toContain('native: {"type":"future.event","future":{"large":');
  });
});
