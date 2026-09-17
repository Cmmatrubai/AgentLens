import type { RunDetailV1 } from "@agentlens/api-contract";

import { AssessmentEditor } from "../assessment/AssessmentEditor.js";
import { words } from "../runs/runFacts.js";
import { RunEvidenceStrip } from "./RunEvidenceStrip.js";

export function RunHeader({ run, onAssessmentSaved }: Readonly<{
  run: RunDetailV1;
  onAssessmentSaved?: (eventId: string) => void;
}>) {
  return (
    <header className="run-detail-header">
      <div>
        <p className="page-eyebrow">Run evidence</p>
        <h1>{run.label ?? "Unlabeled run"}</h1>
        <p className="run-detail-header__identity">{run.runId}</p>
      </div>
      <RunEvidenceStrip run={run} />
      <div className="run-detail-header__evidence-boundary">
        <p>Provider file-read telemetry unavailable. Shell commands may incidentally show possible access; AgentLens does not infer complete reads.</p>
        <p>Provider tool duration unavailable. Completed lifecycle pairs show recorder-observed elapsed time when both events are loaded.</p>
      </div>
      {onAssessmentSaved !== undefined && (
        <AssessmentEditor
          runId={run.runId}
          assessment={run.summary.assessment}
          onConfirmed={onAssessmentSaved}
        />
      )}
      {(run.warningCodes.length > 0 || run.contradictionCodes.length > 0) && (
        <div className="run-detail-header__signals" aria-label="Run warnings and contradictions">
          {run.contradictionCodes.map((code) => (
            <span className="signal signal--contradiction" key={`contradiction-${code}`}>
              Contradiction: {words(code)}
            </span>
          ))}
          {run.warningCodes.map((code) => (
            <span className="signal signal--warning" key={`warning-${code}`}>
              Warning: {words(code)}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
