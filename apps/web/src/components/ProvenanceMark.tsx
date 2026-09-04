import type { ProvenanceV1 } from "@agentlens/api-contract";

const labels: Record<ProvenanceV1, string> = {
  observed: "Observed evidence",
  derived: "Derived evidence",
  git_recovered: "Git-recovered evidence",
  recorder: "Recorder evidence",
  human: "Human evidence"
};

export function ProvenanceMark({ provenance }: Readonly<{ provenance: ProvenanceV1 }>) {
  return (
    <span className={`provenance-mark provenance-mark--${provenance}`}>
      <span aria-hidden="true" className="provenance-mark__shape" />
      {labels[provenance]}
    </span>
  );
}
