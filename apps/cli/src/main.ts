#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { parseAgentLensArgs } from "./args.js";
import { runInspectCommand } from "./commands/inspect.js";
import { runRecordCommand } from "./commands/record.js";
import { runRunsCommand } from "./commands/runs.js";

async function runRecordWithProcessSignals(
  command: Extract<ReturnType<typeof parseAgentLensArgs>, { name: "record" }>
): Promise<number> {
  const controller = new AbortController();
  const forceController = new AbortController();
  let receivedSignal: "SIGINT" | "SIGTERM" | undefined;
  let interruptCount = 0;
  const interrupt = (signal: "SIGINT" | "SIGTERM") => (): void => {
    receivedSignal ??= signal;
    interruptCount += 1;
    if (interruptCount === 1) controller.abort();
    else forceController.abort();
  };
  const onSigint = interrupt("SIGINT");
  const onSigterm = interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    const recorded = await runRecordCommand(command, {
      signal: controller.signal,
      forceTerminationSignal: forceController.signal
    });
    if (receivedSignal === "SIGINT") return 130;
    if (receivedSignal === "SIGTERM") return 143;
    return recorded.cliExitCode;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const command = parseAgentLensArgs(argv[0] === "--" ? argv.slice(1) : argv);
    if (command.name === "record") return await runRecordWithProcessSignals(command);
    if (command.name === "runs") {
      await runRunsCommand(command);
      return 0;
    }
    await runInspectCommand(command);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`AgentLens error: ${message}\n`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await main();
}
