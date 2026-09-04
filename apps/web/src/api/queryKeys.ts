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
  },
  eventDetail(runId: string, eventId: string) {
    return ["event-detail", runId, eventId] as const;
  },
  eventContent(runId: string, eventId: string) {
    return ["event-content", runId, eventId] as const;
  },
  eventNative(runId: string, eventId: string) {
    return ["event-native", runId, eventId] as const;
  },
  assessmentNote(runId: string, eventId: string) {
    return ["assessment-note", runId, eventId] as const;
  },
  gitDiff(runId: string) {
    return ["git-diff", runId] as const;
  },
  gitStatus(runId: string, phase: "initial" | "final") {
    return ["git-status", runId, phase] as const;
  },
  gitDiffCheck(runId: string) {
    return ["git-diff-check", runId] as const;
  },
  gitUntracked(runId: string) {
    return ["git-untracked", runId] as const;
  }
});
