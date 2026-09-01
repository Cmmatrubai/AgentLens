import { useEffect, useRef } from "react";

import { AgentLensClientError } from "../api/client.js";
import { useGitDiffQuery } from "../api/evidenceQueries.js";
import {
  GitDiffViewer,
  type GitDiffEvidence,
  type GitDiffViewState
} from "../evidence/GitDiffViewer.js";

function diffEvidence(error: unknown): GitDiffEvidence {
  if (error instanceof AgentLensClientError) {
    if (error.code === "evidence_binding_mismatch") return { state: "unavailable", reason: "corrupt" };
    if (error.code === "content_unavailable") return { state: "unavailable", reason: "artifact_omitted" };
  }
  return { state: "unavailable", reason: "artifact_unreadable" };
}

export function DeepEvidencePanel(props: Readonly<{
  runId: string;
  open: boolean;
  onClose: () => void;
  viewState?: GitDiffViewState;
  onViewStateChange?: (state: GitDiffViewState) => void;
  autoFocus?: boolean;
  onAutoFocusComplete?: () => void;
  onMount?: (element: HTMLElement | null) => void;
}>) {
  const heading = useRef<HTMLHeadingElement>(null);
  const diff = useGitDiffQuery(props.runId, props.open);
  useEffect(() => {
    if (!props.open || props.autoFocus !== true) return;
    heading.current?.focus();
    props.onAutoFocusComplete?.();
  }, [props.open, props.autoFocus]);
  if (!props.open) return null;
  return (
    <section
      ref={props.onMount}
      className="deep-evidence-panel"
      aria-labelledby="deep-evidence-title"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onClose();
      }}
    >
      <header>
        <div>
          <p className="page-eyebrow">Bounded deep evidence</p>
          <h2 id="deep-evidence-title" ref={heading} tabIndex={-1}>Final Git evidence · tracked final diff</h2>
        </div>
        <button type="button" onClick={props.onClose}>Close deep evidence</button>
      </header>
      {diff.isPending && <p role="status">Loading structured tracked final diff…</p>}
      {diff.isError && <GitDiffViewer
        evidence={diffEvidence(diff.error)}
        {...(props.viewState === undefined ? {} : { viewState: props.viewState })}
        {...(props.onViewStateChange === undefined ? {} : { onViewStateChange: props.onViewStateChange })}
      />}
      {diff.data !== undefined && <GitDiffViewer
        evidence={{ state: "available", value: diff.data }}
        {...(props.viewState === undefined ? {} : { viewState: props.viewState })}
        {...(props.onViewStateChange === undefined ? {} : { onViewStateChange: props.onViewStateChange })}
      />}
    </section>
  );
}
