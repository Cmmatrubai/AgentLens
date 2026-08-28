import { join, resolve } from "node:path";
import { openDatabase, RunRepository } from "@agentlens/storage";
import type { InspectCommand } from "../args.js";
import { ownerOnlyDatabaseFiles, prepareDataRoot } from "../dataRoot.js";
import { inspectJson, inspectText } from "../format.js";
import { recoverStaleRuns } from "../recoverRuns.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export async function runInspectCommand(
  command: InspectCommand,
  dependencies: { readonly stdout?: OutputWriter; readonly cwd?: string } = {}
): Promise<Awaited<ReturnType<typeof inspectJson>>> {
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
    const detail = repository.getRunDetail(command.runId);
    const value = await inspectJson(detail, command.native, join(dataRoot, "artifacts", "sha256"));
    (dependencies.stdout ?? process.stdout).write(
      command.json ? `${JSON.stringify(value, null, 2)}\n` : inspectText(detail, value.events)
    );
    return value;
  } finally {
    database.close();
    await ownerOnlyDatabaseFiles(databasePath);
  }
}
