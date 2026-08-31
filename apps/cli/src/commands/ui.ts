import { execFile, type ExecFileOptions } from "node:child_process";
import {
  startAgentLensServer,
  type AgentLensServerHandle,
  type StartAgentLensServerOptions
} from "@agentlens/server";
import type { UiCommand } from "../args.js";

export type BrowserExecFile = (
  executable: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: Error | null) => void
) => unknown;

export interface RunUiCommandDependencies {
  readonly signal: AbortSignal;
  readonly webRoot?: string;
  readonly startServer?: (
    options: StartAgentLensServerOptions
  ) => Promise<AgentLensServerHandle>;
  readonly openBrowser?: (url: string) => Promise<void>;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
}

const defaultExecFile: BrowserExecFile = (executable, args, options, callback) =>
  execFile(executable, [...args], options, callback);

export function createBrowserOpener(
  platform: NodeJS.Platform = process.platform,
  execute: BrowserExecFile = defaultExecFile
): (url: string) => Promise<void> {
  return async (url) => {
    const [executable, args] = platform === "darwin"
      ? ["open", [url]] as const
      : platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]] as const
        : ["xdg-open", [url]] as const;
    await new Promise<void>((resolve, reject) => {
      execute(executable, args, { shell: false }, (error) => {
        if (error) reject(new Error("AgentLens could not open the browser."));
        else resolve();
      });
    });
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

export async function runUiCommand(
  command: UiCommand,
  dependencies: RunUiCommandDependencies
): Promise<void> {
  const server = await (dependencies.startServer ?? startAgentLensServer)({
    dataRoot: command.dataRoot,
    ...(dependencies.webRoot === undefined ? {} : { webRoot: dependencies.webRoot })
  });
  const stdout = dependencies.stdout ?? process.stdout;
  const openBrowser = dependencies.openBrowser ?? createBrowserOpener();
  try {
    if (command.noOpen) {
      stdout.write(`${server.bootstrapUrl}\n`);
    } else {
      stdout.write(`AgentLens UI: ${server.origin}\n`);
      await openBrowser(server.bootstrapUrl);
    }
    await waitForAbort(dependencies.signal);
  } finally {
    await server.close();
  }
}
