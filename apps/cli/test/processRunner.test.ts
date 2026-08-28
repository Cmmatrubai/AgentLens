import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runChildProcess } from "../src/processRunner.js";

const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("process runner", () => {
  it("starts Codex as a POSIX process-group leader and reports the group identity", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "agentlens-process-group-"));
    roots.push(root);
    const bin = join(root, "bin");
    await mkdir(bin);
    await copyFile(fakeCodex, join(bin, "codex"));
    await chmod(join(bin, "codex"), 0o700);
    const controller = new AbortController();
    let reportedPid: number | undefined;
    let reportedGroup: number | undefined;

    await runChildProcess({
      childArgs: ["codex", "exec", "--json", "--fake-mode=hang"],
      cwd: root,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      promptInput: { mode: "buffered", source: "stdin", bytes: Buffer.alloc(0) },
      onSpawn: (pid, processGroupId) => {
        reportedPid = pid;
        reportedGroup = processGroupId;
      },
      onLine: () => controller.abort(),
      signal: controller.signal
    });

    expect(reportedPid).toEqual(expect.any(Number));
    expect(reportedGroup).toBe(reportedPid);
  });

  it("timestamps every source line at receipt before queued persistence", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-process-runner-"));
    roots.push(root);
    const bin = join(root, "bin");
    await mkdir(bin);
    await copyFile(fakeCodex, join(bin, "codex"));
    await chmod(join(bin, "codex"), 0o700);

    let receiptClock = 0;
    let releaseFirst!: () => void;
    let firstLine!: () => void;
    const firstLineEntered = new Promise<void>((resolve) => { firstLine = resolve; });
    const firstLineGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const receivedAt: unknown[] = [];
    const clockExtension = { now: () => ++receiptClock };
    const resultPromise = runChildProcess({
      ...clockExtension,
      childArgs: ["codex", "exec", "--json", "--fake-mode=success"],
      cwd: root,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      promptInput: { mode: "buffered", source: "stdin", bytes: Buffer.alloc(0) },
      onSpawn: () => undefined,
      onLine: async (_stream, _line, ...metadata: unknown[]) => {
        receivedAt.push(metadata[0]);
        if (receivedAt.length === 1) {
          firstLine();
          await firstLineGate;
        }
      }
    });

    await firstLineEntered;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(receiptClock).toBeGreaterThan(1);
    releaseFirst();
    await resultPromise;
    expect(receivedAt.length).toBeGreaterThan(1);
    expect(receivedAt.every((value) => typeof value === "number")).toBe(true);
  });
});
