// Runs under the installed AgentLens tsx runtime, using its existing read-only APIs.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const [repository, dataRoot, runId] = process.argv.slice(2);
const { runInspectCommand } = await import(
  pathToFileURL(join(repository, "apps/cli/src/commands/inspect.ts")).href
);
const { readValidatedArtifact } = await import(
  pathToFileURL(
    join(
      repository,
      "packages/application/src/artifacts/readValidatedArtifact.ts",
    ),
  ).href
);
const inspection = await runInspectCommand(
  { name: "inspect", runId, dataRoot, json: true, native: true },
  { stdout: { write() {} } },
);
let gitDiff = { state: "unavailable", reason: "not_captured" };
const ref = inspection.gitEvidence?.trackedFinalDiff;
if (inspection.run.capturePolicy === "standard" && ref?.state === "artifact") {
  const artifact = inspection.artifacts.find(
    (a) => a.id === ref.artifactId && a.runId === runId,
  );
  if (!artifact || artifact.byteLength > 2000000)
    throw new Error("Invalid or oversized final diff");
  const read = await readValidatedArtifact(
    artifact,
    join(dataRoot, "artifacts", "sha256"),
    {
      expectedKind: "git-tracked-final-diff",
      expectedMediaType: "text/x-diff",
      requireComplete: true,
      requireOwnerOnly: true,
    },
  );
  gitDiff = {
    state: "available",
    artifactId: artifact.id,
    content: new TextDecoder("utf-8", { fatal: true }).decode(read.bytes),
  };
}
process.stdout.write(JSON.stringify({ inspection, gitDiff }));
