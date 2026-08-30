import { join } from "node:path";
import { openDatabaseReadOnly, RunRepository } from "@agentlens/storage";
import type { RunsCommand } from "../args.js";
import { diagnoseOwnership } from "../diagnoseOwnership.js";
import { runsJson, runsText, type RunsJsonOutput } from "../format.js";
import {
  systemProcessIdentityInspector,
  type ProcessIdentityInspector
} from "../processIdentity.js";
import { projectRunSummary } from "../projectRunSummary.js";
import { locateReadOnlyDataRoot } from "../readOnlyDataRoot.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export async function runRunsCommand(
  command: RunsCommand,
  dependencies: {
    readonly stdout?: OutputWriter;
    readonly cwd?: string;
    readonly processIdentityInspector?: ProcessIdentityInspector;
  } = {}
): Promise<RunsJsonOutput> {
  const located = await locateReadOnlyDataRoot(command.dataRoot);
  if (located.state === "missing") {
    const value = runsJson([]);
    (dependencies.stdout ?? process.stdout).write(
      command.json ? `${JSON.stringify(value, null, 2)}\n` : runsText([])
    );
    return value;
  }
  const database = openDatabaseReadOnly(located.databasePath);
  try {
    const artifactRoot = join(located.dataRoot, "artifacts", "sha256");
    const repository = new RunRepository(database, {
      artifactRoot
    });
    const runs = repository.listRuns({ limit: command.limit });
    const projected = await Promise.all(runs.map(async (run) => {
      const detail = repository.getRunDetail(run.id);
      return {
        run,
        summary: await projectRunSummary(detail, repository, artifactRoot),
        ownership: await diagnoseOwnership(
          detail.run,
          detail.ownership,
          dependencies.processIdentityInspector ?? systemProcessIdentityInspector
        )
      };
    }));
    const value = runsJson(projected);
    (dependencies.stdout ?? process.stdout).write(
      command.json ? `${JSON.stringify(value, null, 2)}\n` : runsText(projected)
    );
    return value;
  } finally {
    database.close();
  }
}
