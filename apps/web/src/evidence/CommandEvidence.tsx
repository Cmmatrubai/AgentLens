import type { EventDetailV1, NormalizedContentResponseV1 } from "@agentlens/api-contract";

import { AvailabilityNotice } from "./AvailabilityNotice.js";
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
  onRequestContent: () => void;
}>) {
  const unavailable = props.detail.output.state === "unavailable" ? props.detail.output.reason : null;
  return (
    <section className="command-evidence">
      <h3>Command lifecycle</h3>
      <dl className="evidence-facts">
        <div><dt>Status</dt><dd>{lifecycleLabels[props.detail.lifecycle]}</dd></div>
        <div><dt>Exit code</dt><dd>{props.detail.exitCode === null ? "Unavailable" : props.detail.exitCode}</dd></div>
      </dl>
      {props.content === null && unavailable !== null && <AvailabilityNotice state={unavailable} />}
      {props.content === null && unavailable === null && (
        <button type="button" onClick={props.onRequestContent} disabled={props.requestState === "loading"}>
          {props.requestState === "loading" ? "Loading command output…" : "Load command output"}
        </button>
      )}
      {props.requestState === "error" && <AvailabilityNotice state="corrupt" />}
      {props.content?.content.kind === "command_output" && (
        <TextEvidence title="Redacted command output" text={props.content.content.output} />
      )}
      {props.content?.content.kind === "command" && (
        <TextEvidence title="Redacted command" text={props.content.content.command} />
      )}
      {props.content !== null && props.content.content.kind !== "command" &&
        props.content.content.kind !== "command_output" && <AvailabilityNotice state="unsupported_kind" />}
    </section>
  );
}
