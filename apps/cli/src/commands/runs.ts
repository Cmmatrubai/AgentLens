import { join, resolve } from "node:path";
import { openDatabase, RunRepository } from "@agentlens/storage";
import type { RunsCommand } from "../args.js";
import { ownerOnlyDatabaseFiles, prepareDataRoot } from "../dataRoot.js";
import { runsJson, runsText, type RunsJsonOutput } from "../format.js";
import { recoverStaleRuns } from "../recoverRuns.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export async function runRunsCommand(
  command: RunsCommand,
  dependencies: { readonly stdout?: OutputWriter; readonly cwd?: string } = {}
): Promise<RunsJsonOutput> {
  const dataRoot = resolve(command.dataRoot);
  const databasePath = await prepareDataRoot(dataRoot);
  const database = openDatabase(databasePath);
  await ownerOnlyDatabaseFiles(databasePath);
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    });
    await recoverStaleRuns({
      repository,
      dataRoot,
      cwd: dependencies.cwd ?? process.cwd()
    });
    const runs = repository.listRuns({ limit: command.limit });
    const value = runsJson(runs);
    (dependencies.stdout ?? process.stdout).write(
      command.json ? `${JSON.stringify(value, null, 2)}\n` : runsText(runs)
    );
    return value;
  } finally {
    database.close();
    await ownerOnlyDatabaseFiles(databasePath);
  }
}
