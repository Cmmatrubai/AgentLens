import { join, resolve } from "node:path";
import { openDatabase, RunRepository } from "@agentlens/storage";
import type { RunsCommand } from "../args.js";
import { runsJson, runsText, type RunsJsonOutput } from "../format.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export async function runRunsCommand(
  command: RunsCommand,
  dependencies: { readonly stdout?: OutputWriter } = {}
): Promise<RunsJsonOutput> {
  const dataRoot = resolve(command.dataRoot);
  const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    });
    const runs = repository.listRuns({ limit: command.limit });
    const value = runsJson(runs);
    (dependencies.stdout ?? process.stdout).write(
      command.json ? `${JSON.stringify(value, null, 2)}\n` : runsText(runs)
    );
    return value;
  } finally {
    database.close();
  }
}
