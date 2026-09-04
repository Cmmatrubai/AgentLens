import { projectRunSummary as projectApplicationRunSummary } from "@agentlens/application";
import { codexExecCapabilities } from "@agentlens/core";
import type { RunSummary } from "@agentlens/derivations";
import type { RunDetail, RunRepository } from "@agentlens/storage";

type SummaryRepository = Pick<RunRepository, "getCurrentAssessment">;

export async function projectRunSummary(
  detail: RunDetail,
  repository: SummaryRepository,
  artifactRoot: string
): Promise<RunSummary> {
  return projectApplicationRunSummary({
    detail,
    repository,
    artifactRoot,
    providerCapabilities: {
      forProvider: () => codexExecCapabilities
    }
  });
}
