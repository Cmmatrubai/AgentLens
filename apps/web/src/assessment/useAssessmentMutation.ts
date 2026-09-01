import type {
  AssessmentResponseV1,
  CurrentAssessmentV1,
  RunDetailV1,
  RunPageV1
} from "@agentlens/api-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  AgentLensAssessmentConflictError,
  assessmentEtagFor,
  type AssessmentDraft
} from "../api/client.js";
import { useAgentLensApi } from "../api/queries.js";
import { queryKeys } from "../api/queryKeys.js";

function replaceAssessment<T extends RunDetailV1>(run: T, assessment: CurrentAssessmentV1): T {
  return {
    ...run,
    summary: { ...run.summary, assessment }
  };
}

export function useAssessmentMutation(input: Readonly<{
  runId: string;
  assessment: CurrentAssessmentV1;
  onConfirmed: (eventId: string) => void;
}>) {
  const client = useAgentLensApi();
  const queryClient = useQueryClient();
  const [etag, setEtag] = useState(() => assessmentEtagFor(input.assessment.currentEventId));
  const [conflict, setConflict] = useState<AgentLensAssessmentConflictError | null>(null);

  useEffect(() => {
    if (conflict === null) setEtag(assessmentEtagFor(input.assessment.currentEventId));
  }, [conflict, input.assessment.currentEventId, input.runId]);

  const commitAssessment = (assessment: CurrentAssessmentV1): void => {
    queryClient.setQueryData<RunDetailV1>(queryKeys.run(input.runId), (current) =>
      current === undefined ? current : replaceAssessment(current, assessment)
    );
    queryClient.setQueriesData<RunPageV1>({ queryKey: ["runs"] }, (page) => page === undefined
      ? page
      : {
          ...page,
          items: page.items.map((item) => item.runId === input.runId
            ? { ...item, summary: { ...item.summary, assessment } }
            : item)
        }
    );
  };
  const refreshRunFacts = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.run(input.runId), exact: true });
  };

  const mutation = useMutation({
    retry: false,
    mutationFn: (draft: AssessmentDraft) => client.updateAssessment({
      runId: input.runId,
      etag,
      draft
    }),
    onSuccess: (response: AssessmentResponseV1) => {
      setConflict(null);
      setEtag(response.etag);
      commitAssessment(response.assessment);
      refreshRunFacts();
      if (response.assessment.state === "explicit") {
        input.onConfirmed(response.assessment.currentEventId);
      }
    },
    onError: (error: unknown) => {
      if (error instanceof AgentLensAssessmentConflictError) setConflict(error);
    }
  });

  const save = async (draft: AssessmentDraft): Promise<boolean> => {
    mutation.reset();
    try {
      await mutation.mutateAsync(draft);
      return true;
    } catch {
      return false;
    }
  };

  const reviewLatest = (): void => {
    if (conflict === null) return;
    commitAssessment(conflict.assessment);
    refreshRunFacts();
    setEtag(conflict.etag);
    setConflict(null);
    mutation.reset();
  };

  return {
    save,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    conflict,
    reviewLatest
  } as const;
}
