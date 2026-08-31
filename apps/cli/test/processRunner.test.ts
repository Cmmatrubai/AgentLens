import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  async function termResistantFixture() {
    const root = await mkdtemp(join(tmpdir(), "agentlens-term-resistant-"));
    roots.push(root);
    const bin = join(root, "bin");
    const grandchildFile = join(root, "grandchild.pid");
    await mkdir(bin);
    await copyFile(fakeCodex, join(bin, "codex"));
    await chmod(join(bin, "codex"), 0o700);
    return {
      root,
      grandchildFile,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        AGENTLENS_FAKE_GRANDCHILD_FILE: grandchildFile,
        AGENTLENS_FAKE_STARTUP_DELAY_MS: "900"
      }
    };
  }

  it("escalates a resistant process group after the bounded grace period", async () => {
    if (process.platform === "win32") return;
    const context = await termResistantFixture();
    const controller = new AbortController();
    const forceController = new AbortController();
    let childPid: number | undefined;
    let interruptedAt = 0;
    let safetyTimer: ReturnType<typeof setTimeout> | undefined;

    const result = await runChildProcess({
      childArgs: ["codex", "exec", "--json", "--fake-mode=ignore-term"],
      cwd: context.root,
      env: context.env,
      promptInput: { mode: "buffered", source: "stdin", bytes: Buffer.alloc(0) },
      onSpawn: (pid) => {
        childPid = pid;
        safetyTimer = setTimeout(() => {
          try { process.kill(-pid, "SIGKILL"); } catch { /* production may already have killed it */ }
        }, 4_000);
      },
      onLine: (_stream, line) => {
        if (interruptedAt === 0 && line.includes("term-resistant-command")) {
          interruptedAt = Date.now();
          controller.abort();
          if (safetyTimer !== undefined) clearTimeout(safetyTimer);
          safetyTimer = setTimeout(() => {
            try {
              if (childPid !== undefined) process.kill(-childPid, "SIGKILL");
            } catch { /* production may already have killed it */ }
          }, 800);
        }
      },
      onDiagnostic: () => undefined,
      signal: controller.signal,
      forceTerminationSignal: forceController.signal,
      terminationGraceMs: 50
    });
    if (safetyTimer !== undefined) clearTimeout(safetyTimer);

    expect(Date.now() - interruptedAt).toBeLessThan(400);
    expect(result).toMatchObject({
      pid: childPid,
      exitCode: null,
      terminatingSignal: "SIGKILL",
      explicitlyInterrupted: true
    });
    const grandchildPid = Number(await readFile(context.grandchildFile, "utf8"));
    expect(() => process.kill(grandchildPid, 0)).toThrow();
  }, 5_000);

  it("keeps escalating the owned group after the direct child exits on SIGTERM", async () => {
    if (process.platform === "win32") return;
    const context = await termResistantFixture();
    const controller = new AbortController();
    const grandchildTermFile = join(context.root, "grandchild-term.log");
    let processGroupId: number | undefined;
    let safetyTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await runChildProcess({
        childArgs: [
          "codex",
          "exec",
          "--json",
          "--fake-mode=cooperative-parent-resistant-grandchild"
        ],
        cwd: context.root,
        env: {
          ...context.env,
          AGENTLENS_FAKE_GRANDCHILD_TERM_FILE: grandchildTermFile
        },
        promptInput: { mode: "buffered", source: "stdin", bytes: Buffer.alloc(0) },
        onSpawn: (pid, groupId) => {
          processGroupId = groupId ?? undefined;
          safetyTimer = setTimeout(() => {
            try { process.kill(-pid, "SIGKILL"); } catch { /* production may already have killed it */ }
          }, 4_000);
        },
        onLine: (_stream, line) => {
          if (line.includes("cooperative-parent-command")) {
            controller.abort();
            if (safetyTimer !== undefined) clearTimeout(safetyTimer);
            safetyTimer = setTimeout(() => {
              try {
                if (processGroupId !== undefined) process.kill(-processGroupId, "SIGKILL");
              } catch { /* production may already have killed it */ }
            }, 1_000);
          }
        },
        onDiagnostic: () => undefined,
        signal: controller.signal,
        terminationGraceMs: 50
      });

      const grandchildPid = Number(await readFile(context.grandchildFile, "utf8"));
      expect(result).toMatchObject({
        exitCode: null,
        terminatingSignal: "SIGTERM",
        explicitlyInterrupted: true,
        processGroupTermination: {
          processGroupId,
          initialSignal: "SIGTERM",
          escalationSignal: "SIGKILL",
          confirmedGone: true
        }
      });
      expect(await readFile(grandchildTermFile, "utf8")).toBe("term-observed\n");
      expect(() => process.kill(grandchildPid, 0)).toThrow();
      expect(() => process.kill(-(processGroupId ?? 0), 0)).toThrow();
    } finally {
      if (safetyTimer !== undefined) clearTimeout(safetyTimer);
      if (processGroupId !== undefined) {
        try { process.kill(-processGroupId, "SIGKILL"); } catch { /* expected after cleanup */ }
      }
    }
  }, 5_000);

  it("escalates immediately when a second interrupt arrives", async () => {
    if (process.platform === "win32") return;
    const context = await termResistantFixture();
    const controller = new AbortController();
    const forceController = new AbortController();
    let childPid: number | undefined;
    let interruptedAt = 0;
    let safetyTimer: ReturnType<typeof setTimeout> | undefined;

    const result = await runChildProcess({
      childArgs: ["codex", "exec", "--json", "--fake-mode=ignore-term"],
      cwd: context.root,
      env: context.env,
      promptInput: { mode: "buffered", source: "stdin", bytes: Buffer.alloc(0) },
      onSpawn: (pid) => {
        childPid = pid;
        safetyTimer = setTimeout(() => {
          try { process.kill(-pid, "SIGKILL"); } catch { /* force escalation may already have killed it */ }
        }, 4_000);
      },
      onLine: (_stream, line) => {
        if (interruptedAt === 0 && line.includes("term-resistant-command")) {
          interruptedAt = Date.now();
          controller.abort();
          setTimeout(() => forceController.abort(), 25);
          if (safetyTimer !== undefined) clearTimeout(safetyTimer);
          safetyTimer = setTimeout(() => {
            try {
              if (childPid !== undefined) process.kill(-childPid, "SIGKILL");
            } catch { /* force escalation may already have killed it */ }
          }, 800);
        }
      },
      onDiagnostic: () => undefined,
      signal: controller.signal,
      forceTerminationSignal: forceController.signal,
      terminationGraceMs: 2_000
    });
    if (safetyTimer !== undefined) clearTimeout(safetyTimer);

    expect(Date.now() - interruptedAt).toBeLessThan(250);
    expect(result.terminatingSignal).toBe("SIGKILL");
  }, 5_000);

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
      onDiagnostic: () => undefined,
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
      },
      onDiagnostic: () => undefined
    });

    await firstLineEntered;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(receiptClock).toBe(1);
    releaseFirst();
    await resultPromise;
    expect(receivedAt.length).toBeGreaterThan(1);
    expect(receivedAt.every((value) => typeof value === "number")).toBe(true);
  });
});
