import { useQuery } from "@tanstack/react-query";

import { useAgentLensApi } from "./queries.js";
import { queryKeys } from "./queryKeys.js";

export function useEventDetailQuery(runId: string, eventId: string, enabled = true) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.eventDetail(runId, eventId),
    queryFn: ({ signal }) => client.getEvent(runId, eventId, signal),
    enabled
  });
}

export function useEventContentQuery(runId: string, eventId: string, enabled: boolean) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.eventContent(runId, eventId),
    queryFn: ({ signal }) => client.getEventContent(runId, eventId, signal),
    enabled
  });
}

export function useEventNativeQuery(runId: string, eventId: string, enabled: boolean) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.eventNative(runId, eventId),
    queryFn: ({ signal }) => client.getEventNative(runId, eventId, signal),
    enabled
  });
}

export function useAssessmentNoteQuery(runId: string, eventId: string, enabled: boolean) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.assessmentNote(runId, eventId),
    queryFn: ({ signal }) => client.getAssessmentNote(runId, eventId, signal),
    enabled
  });
}

export function useGitDiffQuery(runId: string, enabled: boolean) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.gitDiff(runId),
    queryFn: ({ signal }) => client.getGitDiff(runId, signal),
    enabled
  });
}

export function useGitStatusQuery(runId: string, phase: "initial" | "final", enabled: boolean) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.gitStatus(runId, phase),
    queryFn: ({ signal }) => client.getGitStatus(runId, phase, signal),
    enabled
  });
}

export function useGitDiffCheckQuery(runId: string, enabled: boolean) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.gitDiffCheck(runId),
    queryFn: ({ signal }) => client.getGitDiffCheck(runId, signal),
    enabled
  });
}

export function useGitUntrackedQuery(runId: string, enabled: boolean) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.gitUntracked(runId),
    queryFn: ({ signal }) => client.getGitUntracked(runId, signal),
    enabled
  });
}
