import type { CurrentAssessmentV1 } from "@agentlens/api-contract";
import { useId, useRef, useState, type FormEvent } from "react";

import {
  AgentLensAssessmentConflictError,
  AgentLensClientError,
  type AssessmentDraft
} from "../api/client.js";
import { AssessmentSummary } from "./AssessmentSummary.js";
import { useAssessmentMutation } from "./useAssessmentMutation.js";

const verdicts = ["unreviewed", "success", "partial", "failure"] as const;
const completions = ["yes", "no", "uncertain"] as const;
const labels = Object.freeze({
  unreviewed: "Not reviewed",
  success: "Success",
  partial: "Partial",
  failure: "Failure",
  yes: "Yes",
  no: "No",
  uncertain: "Uncertain"
});

function initialDraft(assessment: CurrentAssessmentV1): AssessmentDraft {
  return {
    verdict: assessment.verdict,
    taskCompleted: assessment.taskCompleted,
    note: ""
  };
}

function errors(draft: AssessmentDraft): Readonly<{
  completion?: string;
  note?: string;
}> {
  const result: { completion?: string; note?: string } = {};
  if (draft.verdict === "unreviewed" && draft.taskCompleted !== "uncertain") {
    result.completion = "Not reviewed requires task completion to be Uncertain.";
  }
  if (new TextEncoder().encode(draft.note).byteLength > 16 * 1024) {
    result.note = "Note must be 16 KiB or less in UTF-8.";
  }
  return result;
}

function failureText(error: unknown): string | null {
  if (error instanceof AgentLensClientError && error.code === "network_error") {
    return "Save status unknown. Review the latest assessment before trying again.";
  }
  if (error instanceof AgentLensAssessmentConflictError) return null;
  if (error instanceof AgentLensClientError) {
    return "Assessment could not be saved. Your draft is unchanged.";
  }
  return null;
}

export function AssessmentEditor(props: Readonly<{
  runId: string;
  assessment: CurrentAssessmentV1;
  onConfirmed: (eventId: string) => void;
}>) {
  const id = useId().replaceAll(":", "");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AssessmentDraft>(() => initialDraft(props.assessment));
  const [validation, setValidation] = useState<ReturnType<typeof errors>>({});
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const mutation = useAssessmentMutation({
    runId: props.runId,
    assessment: props.assessment,
    onConfirmed: props.onConfirmed
  });

  const restoreButtonFocus = (): void => {
    queueMicrotask(() => openButtonRef.current?.focus());
  };
  const close = (): void => {
    if (mutation.isPending) return;
    setOpen(false);
    setValidation({});
    setDraft(initialDraft(props.assessment));
    restoreButtonFocus();
  };
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (mutation.isPending || mutation.conflict !== null) return;
    const nextValidation = errors(draft);
    setValidation(nextValidation);
    if (nextValidation.completion !== undefined || nextValidation.note !== undefined) return;
    if (await mutation.save(draft)) {
      setOpen(false);
      restoreButtonFocus();
    }
  };

  return (
    <section className="assessment-workflow" aria-label="Human assessment workflow">
      <button
        ref={openButtonRef}
        className="assessment-workflow__open"
        type="button"
        onClick={() => {
          setDraft(initialDraft(props.assessment));
          setValidation({});
          setOpen(true);
        }}
        aria-expanded={open}
      >
        {props.assessment.state === "projected" ? "Add human assessment" : "Edit human assessment"}
      </button>
      {open && (
        <form className="assessment-editor" aria-label="Human assessment" onSubmit={(event) => { void submit(event); }}>
          <div className="assessment-editor__groups">
            <fieldset>
              <legend>Reviewer verdict</legend>
              <div className="assessment-editor__segments">
                {verdicts.map((verdict, index) => (
                  <label key={verdict}>
                    <input
                      autoFocus={index === 0}
                      type="radio"
                      name={`${id}-verdict`}
                      value={verdict}
                      checked={draft.verdict === verdict}
                      disabled={mutation.isPending}
                      onChange={() => setDraft((current) => ({ ...current, verdict }))}
                    />
                    <span>{labels[verdict]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset aria-describedby={validation.completion === undefined ? undefined : `${id}-completion-error`}>
              <legend>Task completed</legend>
              <div className="assessment-editor__segments">
                {completions.map((taskCompleted) => (
                  <label key={taskCompleted}>
                    <input
                      type="radio"
                      name={`${id}-completion`}
                      value={taskCompleted}
                      checked={draft.taskCompleted === taskCompleted}
                      disabled={mutation.isPending}
                      onChange={() => setDraft((current) => ({ ...current, taskCompleted }))}
                    />
                    <span>{labels[taskCompleted]}</span>
                  </label>
                ))}
              </div>
              {validation.completion !== undefined && (
                <p id={`${id}-completion-error`} className="assessment-editor__error" role="alert">
                  {validation.completion}
                </p>
              )}
            </fieldset>
          </div>
          <label className="assessment-editor__note" htmlFor={`${id}-note`}>
            Reviewer note (optional)
          </label>
          <textarea
            id={`${id}-note`}
            maxLength={16_384}
            rows={4}
            value={draft.note}
            disabled={mutation.isPending}
            aria-invalid={validation.note !== undefined}
            aria-describedby={`${id}-note-help${validation.note === undefined ? "" : ` ${id}-note-error`}`}
            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          />
          <p id={`${id}-note-help`} className="assessment-editor__help">
            Notes are full replacements. Leaving this blank records no note.
          </p>
          {validation.note !== undefined && (
            <p id={`${id}-note-error`} className="assessment-editor__error" role="alert">{validation.note}</p>
          )}
          {mutation.conflict !== null && (
            <section className="assessment-editor__conflict" aria-label="Latest server assessment">
              <p role="alert">This assessment changed before your save completed. Your draft has not been applied.</p>
              <AssessmentSummary assessment={mutation.conflict.assessment} />
              <button type="button" onClick={mutation.reviewLatest}>Review latest assessment</button>
            </section>
          )}
          {failureText(mutation.error) !== null && <p className="assessment-editor__error" role="alert">{failureText(mutation.error)}</p>}
          {mutation.isSuccess && <p role="status">Assessment saved as one human evidence event.</p>}
          <div className="assessment-editor__actions">
            <button type="submit" disabled={mutation.isPending || mutation.conflict !== null}>
              {mutation.isPending ? "Saving assessment…" : "Save assessment"}
            </button>
            <button type="button" onClick={close} disabled={mutation.isPending}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
