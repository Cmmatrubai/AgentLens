import type { ExecFileOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  createBrowserOpener,
  runUiCommand,
  type BrowserExecFile
} from "../src/commands/ui.js";
import { runUiWithProcessSignals } from "../src/main.js";

function deferredAbort(): Readonly<{
  controller: AbortController;
  started: Promise<void>;
  resolveStarted(): void;
}> {
  const controller = new AbortController();
  let resolveStarted = (): void => {};
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  return { controller, started, resolveStarted };
}

describe("AgentLens UI command", () => {
  it("opens the one-use bootstrap while printing only the token-free origin", async () => {
    const lifecycle = deferredAbort();
    const close = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    let stdout = "";
    const running = runUiCommand({
      name: "ui",
      dataRoot: "/tmp/agentlens-ui",
      noOpen: false
    }, {
      signal: lifecycle.controller.signal,
      startServer: async (options) => {
        expect(options).toMatchObject({ dataRoot: "/tmp/agentlens-ui" });
        lifecycle.resolveStarted();
        return {
          origin: "http://127.0.0.1:43210",
          bootstrapUrl: "http://127.0.0.1:43210/bootstrap/secret-code",
          close
        };
      },
      openBrowser,
      stdout: { write: (chunk) => { stdout += String(chunk); return true; } }
    });

    await lifecycle.started;
    expect(openBrowser).toHaveBeenCalledWith(
      "http://127.0.0.1:43210/bootstrap/secret-code"
    );
    expect(stdout).toBe("AgentLens UI: http://127.0.0.1:43210\n");
    expect(stdout).not.toContain("secret-code");
    lifecycle.controller.abort();
    await running;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("prints the one-use URL exactly once with --no-open and closes once", async () => {
    const lifecycle = deferredAbort();
    const close = vi.fn(async () => {});
    const openBrowser = vi.fn(async () => {});
    let stdout = "";
    const running = runUiCommand({
      name: "ui",
      dataRoot: "/tmp/agentlens-ui",
      noOpen: true
    }, {
      signal: lifecycle.controller.signal,
      startServer: async () => {
        lifecycle.resolveStarted();
        return {
          origin: "http://127.0.0.1:43211",
          bootstrapUrl: "http://127.0.0.1:43211/bootstrap/one-use-code",
          close
        };
      },
      openBrowser,
      stdout: { write: (chunk) => { stdout += String(chunk); return true; } }
    });

    await lifecycle.started;
    expect(stdout).toBe("http://127.0.0.1:43211/bootstrap/one-use-code\n");
    expect(stdout.match(/one-use-code/g)).toHaveLength(1);
    expect(openBrowser).not.toHaveBeenCalled();
    lifecycle.controller.abort();
    await running;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["darwin", "open", ["https://fixture.invalid/bootstrap/code"]],
    ["win32", "rundll32", ["url.dll,FileProtocolHandler", "https://fixture.invalid/bootstrap/code"]],
    ["linux", "xdg-open", ["https://fixture.invalid/bootstrap/code"]]
  ] as const)("uses shell-free %s browser argv", async (platform, executable, args) => {
    const calls: Array<Readonly<{
      executable: string;
      args: readonly string[];
      options: ExecFileOptions;
    }>> = [];
    const execFile: BrowserExecFile = (file, childArgs, options, callback) => {
      calls.push({ executable: file, args: childArgs, options });
      callback(null);
    };

    await createBrowserOpener(platform, execFile)("https://fixture.invalid/bootstrap/code");

    expect(calls).toEqual([{ executable, args, options: { shell: false } }]);
  });

  it("sanitizes browser-launch errors so the one-use URL is not logged", async () => {
    const secretUrl = "http://127.0.0.1:43210/bootstrap/private-code-sentinel";
    const execFile: BrowserExecFile = (_file, _args, _options, callback) => {
      callback(new Error(`Command failed: open ${secretUrl}`));
    };

    await expect(createBrowserOpener("darwin", execFile)(secretUrl))
      .rejects.toThrow("AgentLens could not open the browser.");
    try {
      await createBrowserOpener("darwin", execFile)(secretUrl);
    } catch (error) {
      expect((error as Error).message).not.toContain("private-code-sentinel");
    }
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143]
  ] as const)("closes on %s, returns the conventional exit, and removes listeners", async (
    signal,
    expectedExit
  ) => {
    const signalHost = new EventEmitter();
    let resolveStarted = (): void => {};
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const run = vi.fn(async (_command, dependencies: { signal: AbortSignal }) => {
      resolveStarted();
      if (!dependencies.signal.aborted) {
        await new Promise<void>((resolve) =>
          dependencies.signal.addEventListener("abort", () => resolve(), { once: true })
        );
      }
    });
    const exiting = runUiWithProcessSignals({
      name: "ui",
      dataRoot: "/tmp/agentlens-ui",
      noOpen: true
    }, { signalHost, run });

    await started;
    signalHost.emit(signal);

    await expect(exiting).resolves.toBe(expectedExit);
    expect(run).toHaveBeenCalledTimes(1);
    expect(signalHost.listenerCount("SIGINT")).toBe(0);
    expect(signalHost.listenerCount("SIGTERM")).toBe(0);
  });
});
