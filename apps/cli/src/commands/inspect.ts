import { join, resolve } from "node:path";
import { openDatabase, RunRepository } from "@agentlens/storage";
import type { InspectCommand } from "../args.js";
import { inspectJson, inspectText } from "../format.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export async function runInspectCommand(
  command: InspectCommand,
  dependencies: { readonly stdout?: OutputWriter } = {}
): Promise<Awaited<ReturnType<typeof inspectJson>>> {
  const dataRoot = resolve(command.dataRoot);
  const database = openDatabase(join(dataRoot, "agentlens.sqlite"));
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(dataRoot, "artifacts", "sha256")
    });
    const detail = repository.getRunDetail(command.runId);
    const value = await inspectJson(detail, command.native);
    (dependencies.stdout ?? process.stdout).write(
      command.json ? `${JSON.stringify(value, null, 2)}\n` : inspectText(detail, value.events)
    );
    return value;
  } finally {
    database.close();
  }
}
