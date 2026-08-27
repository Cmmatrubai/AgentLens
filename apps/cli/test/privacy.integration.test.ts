import { execFile as execFileCallback } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, RunRepository } from "@agentlens/storage";
import { recordRun } from "../src/recordRun.js";

const execFile = promisify(execFileCallback);
const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const roots: string[] = [];
const silentOutput = { write: () => true };

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentlens-cli-privacy-"));
  roots.push(root);
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const dataRoot = join(root, "data");
  await mkdir(repo);
  await mkdir(bin);
  await git(repo, "init", "-q");
  await git(repo, "config", "user.email", "fixture@example.test");
  await git(repo, "config", "user.name", "AgentLens Fixture");
  await writeFile(join(repo, "tracked.txt"), "before\n");
  await writeFile(join(repo, ".env.production"), "DATABASE_PASSWORD=before\n");
  await git(repo, "add", "tracked.txt", ".env.production");
  await git(repo, "commit", "-qm", "initial");
  await copyFile(fakeCodex, join(bin, "codex"));
  await chmod(join(bin, "codex"), 0o700);
  return {
    root,
    repo,
    dataRoot,
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
  };
}

async function durableBytes(root: string): Promise<Buffer> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Buffer.concat(await Promise.all(files.map((entry) => readFile(join(entry.parentPath, entry.name)))));
}

function piped(text: string): NodeJS.ReadStream {
  return Object.assign(Readable.from([Buffer.from(text)]), { isTTY: false }) as unknown as NodeJS.ReadStream;
}

function detail(dataRoot: string, runId: string) {
  const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
  try {
    return new RunRepository(database, { artifactRoot: join(dataRoot, "artifacts", "sha256") })
      .getRunDetail(runId);
  } finally {
    database.close();
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("recorder privacy and artifact durability", () => {
  it("keeps every metadata-only source sentinel out of the entire closed data root", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "metadata-only",
        label: "METADATA_LABEL_SENTINEL",
        dataRoot: context.dataRoot,
        childArgs: [
          "codex", "exec", "--json", "METADATA_PROMPT_SENTINEL",
          "--fake-mode=privacy", "METADATA_ARGV_SENTINEL"
        ]
      },
      {
        cwd: context.repo,
        stdin: piped("METADATA_STDIN_SENTINEL"),
        env: context.env,
        stdout: silentOutput
      }
    );
    const bytes = await durableBytes(context.dataRoot);

    for (const sentinel of [
      "METADATA_LABEL_SENTINEL",
      "METADATA_PROMPT_SENTINEL",
      "METADATA_ARGV_SENTINEL",
      "METADATA_STDIN_SENTINEL",
      "METADATA_MESSAGE_SENTINEL",
      "METADATA_COMMAND_SENTINEL",
      "METADATA_OUTPUT_SENTINEL",
      "METADATA_DIFF_SENTINEL",
      "METADATA_NATIVE_SENTINEL",
      "METADATA_STDERR_SENTINEL"
    ]) expect(bytes.includes(Buffer.from(sentinel))).toBe(false);

    expect(detail(context.dataRoot, result.runId).gitEvidence).toMatchObject({
      initialStatus: { state: "omitted", reason: "metadata-only" },
      finalStatus: { state: "omitted", reason: "metadata-only" },
      trackedFinalDiff: { state: "omitted", reason: "metadata-only" },
      diffCheck: { state: "omitted", reason: "metadata-only" }
    });
  });

  it("stores small redacted native payload inline and large native payload as a committed artifact", async () => {
    const smallContext = await fixture();
    const small = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: smallContext.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-small"]
      },
      { cwd: smallContext.repo, stdin: piped(""), env: smallContext.env, stdout: silentOutput }
    );
    const smallUnknown = detail(smallContext.dataRoot, small.runId).events
      .find(({ kind }) => kind === "source.unknown");
    expect(smallUnknown?.nativePayload).toMatchObject({
      storage: "inline",
      redacted: {
        future: { nested: 7 },
        authorization: expect.stringMatching(/^\[\[REDACTED:json-authorization:hmac-sha256:[0-9a-f]{32}\]\]$/)
      }
    });

    const largeContext = await fixture();
    const large = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: largeContext.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-large"]
      },
      { cwd: largeContext.repo, stdin: piped(""), env: largeContext.env, stdout: silentOutput }
    );
    const largeDetail = detail(largeContext.dataRoot, large.runId);
    const largeUnknown = largeDetail.events.find(({ kind }) => kind === "source.unknown");
    expect(largeUnknown?.nativePayload).toMatchObject({ storage: "artifact" });
    if (largeUnknown?.nativePayload?.storage !== "artifact") throw new Error("expected native artifact");
    expect(largeDetail.artifacts).toContainEqual(expect.objectContaining({
      id: largeUnknown.nativePayload.artifactId,
      kind: "native-payload"
    }));
  });

  it("shares one completed native artifact when identical large records repeat in one run", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=unknown-large-repeated"]
      },
      { cwd: context.repo, stdin: piped(""), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);
    const unknown = run.events.filter(({ kind }) => kind === "source.unknown");

    expect(result.status).toBe("completed");
    expect(unknown).toHaveLength(2);
    expect(unknown[0]?.nativePayload).toEqual(unknown[1]?.nativePayload);
    expect(run.artifacts.filter(({ kind }) => kind === "native-payload")).toHaveLength(1);
  });

  it("uses the exact keyed bearer marker and removes the complete sensitive .env diff block", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=privacy"]
      },
      { cwd: context.repo, stdin: piped(""), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);
    const diffRef = run.gitEvidence?.trackedFinalDiff;
    expect(diffRef?.state).toBe("artifact");
    if (diffRef?.state !== "artifact") throw new Error("expected tracked final diff artifact");
    const diffArtifact = run.artifacts.find(({ id }) => id === diffRef.artifactId);
    if (!diffArtifact) throw new Error("missing diff artifact metadata");
    const body = await readFile(diffArtifact.path, "utf8");

    expect(body).toMatch(/\[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/);
    expect(body).not.toContain("STANDARD_TOKEN_SENTINEL");
    expect(body).not.toContain("ENV_DIFF_ARBITRARY_SENTINEL");
    expect(body).not.toContain("diff --git a/.env.production");
    expect(body).toContain("[[EXCLUDED:sensitive-path.env]]");
    expect((await durableBytes(context.dataRoot)).includes(
      Buffer.from("ENV_DIFF_ARBITRARY_SENTINEL")
    )).toBe(false);
    expect((await durableBytes(context.dataRoot)).includes(
      Buffer.from("SENSITIVE_PATH_SENTINEL")
    )).toBe(false);
    expect((await durableBytes(context.dataRoot)).includes(
      Buffer.from("UNTRACKED_CONTENT_SENTINEL")
    )).toBe(false);
  });
});
