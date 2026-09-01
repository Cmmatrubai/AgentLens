import type { EventDetailV1, NormalizedContentResponseV1 } from "@agentlens/api-contract";

import { AvailabilityNotice } from "./AvailabilityNotice.js";
import type { AvailabilityState } from "./AvailabilityNotice.js";
import { TextEvidence } from "./TextEvidence.js";

type CommandDetail = Extract<EventDetailV1, { presentationClass: "command" }>;

const lifecycleLabels = Object.freeze({
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  declined: "Declined",
  interrupted: "Interrupted",
  unknown: "Unknown"
});

export function CommandEvidence(props: Readonly<{
  detail: CommandDetail;
  content: NormalizedContentResponseV1 | null;
  requestState: "idle" | "loading" | "loaded" | "error";
  requestError?: AvailabilityState | null;
  onRequestContent: () => void;
}>) {
  const canRequest = props.detail.content.state === "available" || props.detail.output.state === "available";
  const unavailableReason = props.detail.content.state === "unavailable"
    ? props.detail.content.reason
    : props.detail.output.state === "unavailable"
      ? props.detail.output.reason
      : "not_captured";
  return (
    <section className="command-evidence">
      <h3>Command lifecycle</h3>
      <dl className="evidence-facts">
        <div><dt>Status</dt><dd>{lifecycleLabels[props.detail.lifecycle]}</dd></div>
        <div><dt>Exit code</dt><dd>{props.detail.exitCode === null ? "Unavailable" : props.detail.exitCode}</dd></div>
      </dl>
      {props.content === null && !canRequest && <AvailabilityNotice state={unavailableReason} />}
      {props.content === null && canRequest && props.requestState !== "error" && (
        <button type="button" onClick={props.onRequestContent} disabled={props.requestState === "loading"}>
          {props.requestState === "loading" ? "Loading command evidence…" : "Load command evidence"}
        </button>
      )}
      {props.requestState === "error" && <AvailabilityNotice state={props.requestError ?? "artifact_unreadable"} />}
      {props.content?.content.kind === "command_output" && (
        <TextEvidence title="Redacted command output" text={props.content.content.output} />
      )}
      {props.content?.content.kind === "command" && (
        <TextEvidence title="Redacted command" text={props.content.content.command} />
      )}
      {props.content?.content.kind === "command_evidence" && (
        <>
          {props.content.content.command.state === "available"
            ? <TextEvidence
                title="Redacted command"
                text={props.content.content.command.text}
                truncated={props.content.content.command.truncated}
              />
            : <AvailabilityNotice state={props.content.content.command.reason} />}
          {props.content.content.output.state === "available"
            ? <TextEvidence
                title="Redacted command output"
                text={props.content.content.output.text}
                truncated={props.content.content.output.truncated}
              />
            : <AvailabilityNotice state={props.content.content.output.reason} />}
        </>
      )}
      {props.content !== null && props.content.content.kind !== "command" &&
        props.content.content.kind !== "command_output" && props.content.content.kind !== "command_evidence" &&
        <AvailabilityNotice state="unsupported_kind" />}
    </section>
  );
}
