import type { RunListQueryV1 } from "./client.js";

export const queryKeys = Object.freeze({
  runs(query: RunListQueryV1) {
    return ["runs", {
      limit: query.limit,
      cursor: query.cursor ?? null,
      status: query.status ?? null,
      repository: query.repository ?? null,
      assessment: query.assessment ?? null
    }] as const;
  },
  run(runId: string) {
    return ["run", runId] as const;
  }
});
