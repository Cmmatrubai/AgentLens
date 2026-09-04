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
  let command: Slot = props.detail.content.state === "available"
    ? { state: "available" }
    : { state: "unavailable", reason: props.detail.content.reason };
  let output: Slot = props.detail.output.state === "available"
    ? { state: "available" }
    : { state: "unavailable", reason: props.detail.output.reason };
  if (props.content?.content.kind === "command_evidence") {
    command = props.content.content.command.state === "available"
      ? { state: "available", text: props.content.content.command.text,
          truncated: props.content.content.command.truncated }
      : { state: "unavailable", reason: props.content.content.command.reason };
    output = props.content.content.output.state === "available"
      ? { state: "available", text: props.content.content.output.text,
          truncated: props.content.content.output.truncated }
      : { state: "unavailable", reason: props.content.content.output.reason };
  } else if (props.content?.content.kind === "command") {
    command = { state: "available", text: props.content.content.command };
  } else if (props.content?.content.kind === "command_output") {
    output = { state: "available", text: props.content.content.output };
  }
  return (
    <section className="command-evidence">
      <h3>Command lifecycle</h3>
      <dl className="evidence-facts">
        <div><dt>Status</dt><dd>{lifecycleLabels[props.detail.lifecycle]}</dd></div>
        <div><dt>Exit code</dt><dd>{props.detail.exitCode === null ? "Unavailable" : props.detail.exitCode}</dd></div>
      </dl>
      <CommandSlot title="Redacted command" slot={command} />
      <CommandSlot title="Redacted command output" slot={output} />
      {props.content === null && canRequest && props.requestState !== "error" && (
        <button type="button" onClick={props.onRequestContent} disabled={props.requestState === "loading"}>
          {props.requestState === "loading" ? "Loading command evidence…" : "Load command evidence"}
        </button>
      )}
      {props.requestState === "error" && (
        <section aria-label="Command evidence request" className="command-evidence__request-error">
          <h4>Command evidence request</h4>
          <AvailabilityNotice state={props.requestError ?? "artifact_unreadable"} />
        </section>
      )}
      {props.content !== null && props.content.content.kind !== "command" &&
        props.content.content.kind !== "command_output" && props.content.content.kind !== "command_evidence" &&
        <AvailabilityNotice state="unsupported_kind" />}
    </section>
  );
}

type Slot = Readonly<{ state: "available"; text?: string; truncated?: boolean }>
  | Readonly<{ state: "unavailable"; reason: AvailabilityState }>;

function CommandSlot(props: Readonly<{ title: string; slot: Slot }>) {
  if (props.slot.state === "available" && props.slot.text !== undefined) {
    return <TextEvidence title={props.title} text={props.slot.text}
      {...(props.slot.truncated === undefined ? {} : { truncated: props.slot.truncated })} />;
  }
  return (
    <section aria-label={props.title} className="command-evidence__slot">
      <h4>{props.title}</h4>
      <AvailabilityNotice state={props.slot.state === "available" ? "available" : props.slot.reason} />
    </section>
  );
}
