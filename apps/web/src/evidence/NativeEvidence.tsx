import type { NativeContentResponseV1 } from "@agentlens/api-contract";

import { TextEvidence } from "./TextEvidence.js";

export function NativeEvidence(props: Readonly<{ response: NativeContentResponseV1 }>) {
  return (
    <section className="native-evidence">
      <p className="evidence-boundary-copy">
        Redacted provider payload is provider evidence, not canonical AgentLens truth.
      </p>
      <TextEvidence
        title={`Redacted provider payload · ${props.response.content.format}`}
        text={props.response.content.text}
        truncated={props.response.content.truncated}
      />
    </section>
  );
}
