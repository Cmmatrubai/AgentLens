export type AvailabilityState =
  | "available"
  | "capture_policy"
  | "provider_capability"
  | "not_captured"
  | "not_yet_available"
  | "artifact_omitted"
  | "truncated"
  | "corrupt"
  | "artifact_unreadable"
  | "unsupported_kind"
  | "unknown";

const labels: Readonly<Record<AvailabilityState, string>> = Object.freeze({
  available: "Evidence available",
  capture_policy: "Omitted by capture policy",
  provider_capability: "Provider capability unavailable",
  not_captured: "Not captured",
  not_yet_available: "Not yet available",
  artifact_omitted: "Artifact omitted",
  truncated: "Evidence truncated at the response bound",
  corrupt: "Evidence corrupt or binding-invalid",
  artifact_unreadable: "Artifact unreadable",
  unsupported_kind: "Unsupported event kind",
  unknown: "Unsupported future evidence state"
});

export function AvailabilityNotice(props: Readonly<{ state: AvailabilityState }>) {
  return (
    <p className={`availability-notice availability-notice--${props.state}`}>
      {labels[props.state]}
    </p>
  );
}
