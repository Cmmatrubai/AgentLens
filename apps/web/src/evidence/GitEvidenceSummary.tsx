import type { RunDetailV1 } from "@agentlens/api-contract";
import { useState } from "react";

import { AgentLensClientError } from "../api/client.js";
import {
  useGitDiffCheckQuery,
  useGitStatusQuery,
  useGitUntrackedQuery
} from "../api/evidenceQueries.js";
import { AvailabilityNotice, type AvailabilityState } from "./AvailabilityNotice.js";
import { GitStatusView } from "./GitStatusView.js";
import { TextEvidence } from "./TextEvidence.js";
import { UntrackedMetadataView } from "./UntrackedMetadataView.js";

function failureState(error: unknown): AvailabilityState {
  if (error instanceof AgentLensClientError) {
    if (error.code === "evidence_binding_mismatch") return "corrupt";
    if (error.code === "content_unavailable") return "artifact_omitted";
  }
  return "artifact_unreadable";
}

export function GitEvidenceSummary(props: Readonly<{
  runId: string;
  run?: RunDetailV1;
  onOpenDiff: () => void;
}>) {
  const [requests, setRequests] = useState({
    runId: "", initial: false, final: false, untracked: false, check: false
  });
  const current = requests.runId === props.runId
    ? requests
    : { runId: props.runId, initial: false, final: false, untracked: false, check: false };
  const request = (key: "initial" | "final" | "untracked" | "check"): void => {
    setRequests({ ...current, runId: props.runId, [key]: true });
  };
  const initial = useGitStatusQuery(props.runId, "initial", current.initial);
  const final = useGitStatusQuery(props.runId, "final", current.final);
  const untracked = useGitUntrackedQuery(props.runId, current.untracked);
  const diffCheck = useGitDiffCheckQuery(props.runId, current.check);
  const git = props.run?.finalGitEvidence;
  const state = props.run?.gitState;
  const tracked = props.run?.summary.trackedFinalDiff;
  const untrackedCount = props.run?.summary.untrackedFiles;

  return (
    <section className="git-evidence-summary" aria-labelledby="final-git-evidence-title">
      <h3 id="final-git-evidence-title">Final Git evidence</h3>
      <p>Final-state Git evidence does not establish authorship.</p>
      <dl className="evidence-facts">
        <div><dt>Initial HEAD</dt><dd>{state?.state === "available" ? state.initialHead : "Unavailable"}</dd></div>
        <div><dt>Final HEAD</dt><dd>{state?.state === "available" ? state.finalHead : "Unavailable"}</dd></div>
        <div><dt>Initial branch</dt><dd>{state?.state === "available" ? (state.initialBranch.state === "attached" ? state.initialBranch.value : "Detached HEAD") : "Unavailable"}</dd></div>
        <div><dt>Final branch</dt><dd>{state?.state === "available" ? (state.finalBranch.state === "attached" ? state.finalBranch.value : "Detached HEAD") : "Unavailable"}</dd></div>
        <div><dt>HEAD change warning</dt><dd>{git?.state === "available" ? (git.headChanged ? "Changed" : "No change recorded") : "Unavailable"}</dd></div>
        <div><dt>Branch change warning</dt><dd>{git?.state === "available" ? (git.branchChanged ? "Changed" : "No change recorded") : "Unavailable"}</dd></div>
        <div><dt>Tracked final diff</dt><dd>{tracked?.state === "available" ? (tracked.value === "artifact" ? "Available" : "Absent") : tracked?.reason ?? "Unavailable"}</dd></div>
        <div><dt>Untracked-file metadata</dt><dd>{untrackedCount?.state === "available" ? `${untrackedCount.value} validated entries` : untrackedCount?.reason ?? "Unavailable"}</dd></div>
      </dl>
      {git?.state === "unavailable" && <AvailabilityNotice state={git.reason} />}
      {state?.state === "unavailable" && <AvailabilityNotice state={state.reason} />}
      <div className="git-evidence-summary__actions">
        <button type="button" onClick={() => request("initial")}>Load initial Git status</button>
        <button type="button" onClick={() => request("final")}>Load final Git status</button>
        <button type="button" onClick={() => request("untracked")}>Load untracked-file metadata</button>
        <button type="button" onClick={() => request("check")}>Load git diff --check</button>
        <button type="button" onClick={props.onOpenDiff}>Open tracked final diff</button>
      </div>
      {initial.isFetching && <p>Loading initial Git status…</p>}
      {initial.isError && <AvailabilityNotice state={failureState(initial.error)} />}
      {initial.data !== undefined && <GitStatusView title="Initial Git status" value={initial.data} />}
      {final.isFetching && <p>Loading final Git status…</p>}
      {final.isError && <AvailabilityNotice state={failureState(final.error)} />}
      {final.data !== undefined && <GitStatusView title="Final Git status" value={final.data} />}
      {untracked.isFetching && <p>Loading untracked-file metadata…</p>}
      {untracked.isError && <AvailabilityNotice state={failureState(untracked.error)} />}
      {untracked.data !== undefined && <UntrackedMetadataView value={untracked.data} />}
      {diffCheck.isFetching && <p>Loading git diff --check…</p>}
      {diffCheck.isError && <AvailabilityNotice state={failureState(diffCheck.error)} />}
      {diffCheck.data !== undefined && (
        <section className="git-diff-check">
          <p><strong>git diff --check:</strong> {diffCheck.data.passed ? "Passed" : "Reported diagnostics"}</p>
          {diffCheck.data.output.length === 0
            ? <p>No diagnostics were recorded.</p>
            : <TextEvidence title="git diff --check diagnostics" text={diffCheck.data.output} />}
        </section>
      )}
    </section>
  );
}
