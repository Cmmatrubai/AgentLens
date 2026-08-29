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
  await mkdir(join(repo, "+"));
  await writeFile(join(repo, "+", ".env"), "PLUS_ENV_BEFORE=redacted\n");
  await git(repo, "add", "tracked.txt", ".env.production", "+/.env");
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

async function installPrivacyCommandFixture(root: string, command: string): Promise<void> {
  const records = [
    {
      type: "item.completed",
      thread_id: "fixture-thread",
      turn_id: "fixture-turn",
      item: {
        id: "privacy-policy-command",
        type: "command_execution",
        command,
        aggregated_output: "privacy policy output",
        exit_code: 0,
        status: "completed"
      }
    },
    {
      type: "turn.completed",
      thread_id: "fixture-thread",
      turn_id: "fixture-turn",
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 }
    }
  ];
  const source = [
    "#!/usr/bin/env node",
    `const records = ${JSON.stringify(records)};`,
    "for (const record of records) process.stdout.write(JSON.stringify(record) + '\\n');",
    ""
  ].join("\n");
  const executable = join(root, "bin", "codex");
  await writeFile(executable, source, "utf8");
  await chmod(executable, 0o700);
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
  it("persists a content-free placeholder for an invalid UTF-8 Git index path", async () => {
    const context = await fixture();
    const rawName = Buffer.concat([
      Buffer.from("NONUTF8_PATH_SENTINEL_"),
      Buffer.from([0xff]),
      Buffer.from("/.env")
    ]);
    const controlName = Buffer.from(".env/\nfile");
    const lineSeparatorName = Buffer.from(".env/\u2028file");
    const paragraphSeparatorName = Buffer.from(".env/\u2029file");
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: ["codex", "exec", "--json", "--fake-mode=invalid-utf8-index"]
      },
      { cwd: context.repo, stdin: piped(""), env: context.env, stdout: silentOutput }
    );
    const run = detail(context.dataRoot, result.runId);
    const finalStatus = run.gitEvidence?.finalStatus;
    const finalStatusArtifact = finalStatus?.state === "artifact"
      ? run.artifacts.find(({ id }) => id === finalStatus.artifactId)
      : undefined;
    const diffCheck = run.gitEvidence?.diffCheck;
    const diffCheckArtifact = diffCheck?.state === "artifact"
      ? run.artifacts.find(({ id }) => id === diffCheck.artifactId)
      : undefined;
    const durable = await durableBytes(context.dataRoot);

    expect(result.status).toBe("completed");
    expect(finalStatusArtifact).toBeDefined();
    expect(diffCheckArtifact).toBeDefined();
    expect(await readFile(finalStatusArtifact!.path, "utf8"))
      .toContain("[[UNREPRESENTABLE_GIT_PATH]]");
    const diffCheckBody = await readFile(diffCheckArtifact!.path, "utf8");
    expect(diffCheckBody).toContain("[[EXCLUDED:unrepresentable-git-path]]");
    expect(diffCheckBody).toContain("[[EXCLUDED:sensitive-path.env]]");
    expect(diffCheckBody).not.toContain(".env/\\nfile");
    expect(diffCheckBody).not.toContain("\u2028");
    expect(diffCheckBody).not.toContain("\u2029");
    expect(durable.includes(Buffer.from("NONUTF8_PATH_SENTINEL"))).toBe(false);
    expect(durable.includes(rawName)).toBe(false);
    expect(durable.includes(controlName)).toBe(false);
    expect(durable.includes(lineSeparatorName)).toBe(false);
    expect(durable.includes(paragraphSeparatorName)).toBe(false);
    expect(durable.includes(Buffer.from("INVALID_DETAIL_SECRET"))).toBe(false);
    expect(durable.includes(Buffer.from("CONTROL_DETAIL_SECRET"))).toBe(false);
    expect(durable.includes(Buffer.from("LINE_SEPARATOR_DETAIL_SECRET"))).toBe(false);
    expect(durable.includes(Buffer.from("PARAGRAPH_SEPARATOR_DETAIL_SECRET"))).toBe(false);
  });

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

    expect(detail(context.dataRoot, result.runId).events).toContainEqual(expect.objectContaining({
      kind: "recorder.invocation",
      provenance: "recorder",
      normalizedPayload: {
        promptSource: "stdin-buffered",
        argv: { state: "omitted", argumentCount: 6 },
        stdin: { state: "omitted", byteLength: 23 }
      }
    }));
    expect(detail(context.dataRoot, result.runId).events).toContainEqual(expect.objectContaining({
      kind: "command",
      provenance: "observed",
      normalizedPayload: expect.objectContaining({
        commandEvidence: { state: "omitted", reason: "metadata-only" }
      })
    }));

    expect(detail(context.dataRoot, result.runId).gitEvidence).toMatchObject({
      initialStatus: { state: "omitted", reason: "metadata-only" },
      finalStatus: { state: "omitted", reason: "metadata-only" },
      trackedFinalDiff: { state: "omitted", reason: "metadata-only" },
      diffCheck: { state: "omitted", reason: "metadata-only" }
    });
  });

  it("persists only redacted prompt, argv, and stdin representation in standard capture", async () => {
    const context = await fixture();
    const result = await recordRun(
      {
        name: "record",
        capture: "standard",
        dataRoot: context.dataRoot,
        childArgs: [
          "codex", "exec", "--json", "Bearer STANDARD_PROMPT_SECRET",
          "--fake-mode=success", "OPENAI_API_KEY=STANDARD_ARGV_SECRET"
        ]
      },
      {
        cwd: context.repo,
        stdin: piped("Bearer STANDARD_STDIN_SECRET"),
        env: context.env,
        stdout: silentOutput
      }
    );
    const invocation = detail(context.dataRoot, result.runId).events
      .find(({ kind }) => kind === "recorder.invocation");
    const durable = await durableBytes(context.dataRoot);

    expect(invocation).toMatchObject({
      provenance: "recorder",
      normalizedPayload: {
        promptSource: "stdin-buffered",
        argv: {
          state: "captured",
          values: [
            "codex",
            "exec",
            "--json",
            expect.stringMatching(/Bearer \[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/),
            "--fake-mode=success",
            expect.stringMatching(/OPENAI_API_KEY=\[\[REDACTED:assignment-api-key:hmac-sha256:[0-9a-f]{32}\]\]/)
          ]
        },
        stdin: {
          state: "captured",
          byteLength: 28,
          encoding: "utf8-lossy",
          text: expect.stringMatching(/Bearer \[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/)
        }
      }
    });
    for (const sentinel of [
      "STANDARD_PROMPT_SECRET",
      "STANDARD_ARGV_SECRET",
      "STANDARD_STDIN_SECRET"
    ]) expect(durable.includes(Buffer.from(sentinel))).toBe(false);
  });

  it("persists content-free omitted invocation structure in strict capture", async () => {
    const context = await fixture();
    const commandSentinel = "STRICT_COMMAND_EVIDENCE_SENTINEL";
    await installPrivacyCommandFixture(context.root, `printf ${commandSentinel}`);
    const result = await recordRun(
      {
        name: "record",
        capture: "strict",
        dataRoot: context.dataRoot,
        childArgs: [
          "codex", "exec", "--json", "STRICT_PROMPT_SENTINEL",
          "--fake-mode=success", "STRICT_ARGV_SENTINEL"
        ]
      },
      {
        cwd: context.repo,
        stdin: piped("STRICT_STDIN_SENTINEL"),
        env: context.env,
        stdout: silentOutput
      }
    );
    const run = detail(context.dataRoot, result.runId);
    const durable = await durableBytes(context.dataRoot);

    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "recorder.invocation",
      normalizedPayload: {
        promptSource: "stdin-buffered",
        argv: { state: "omitted", argumentCount: 6 },
        stdin: { state: "omitted", byteLength: 21 }
      }
    }));
    expect(run.events).toContainEqual(expect.objectContaining({
      kind: "command",
      provenance: "observed",
      normalizedPayload: expect.objectContaining({
        commandEvidence: { state: "omitted", reason: "strict" }
      })
    }));
    for (const sentinel of [
      "STRICT_PROMPT_SENTINEL",
      "STRICT_ARGV_SENTINEL",
      "STRICT_STDIN_SENTINEL",
      commandSentinel
    ]) expect(durable.includes(Buffer.from(sentinel))).toBe(false);
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
    expect(result.status).toBe("completed");
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
      Buffer.from("ARBITRARY_DETAIL_SECRET")
    )).toBe(false);
    expect((await durableBytes(context.dataRoot)).includes(
      Buffer.from("PLUS_ENV_HEADER_SECRET")
    )).toBe(false);
    expect((await durableBytes(context.dataRoot)).includes(
      Buffer.from("SENSITIVE_PATH_SENTINEL")
    )).toBe(false);
    expect((await durableBytes(context.dataRoot)).includes(
      Buffer.from("UNTRACKED_CONTENT_SENTINEL")
    )).toBe(false);
  });
});
