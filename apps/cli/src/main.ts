#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { parseAgentLensArgs } from "./args.js";
import { runInspectCommand } from "./commands/inspect.js";
import { runRecordCommand } from "./commands/record.js";
import { runRunsCommand } from "./commands/runs.js";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const command = parseAgentLensArgs(argv);
    if (command.name === "record") return (await runRecordCommand(command)).cliExitCode;
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
