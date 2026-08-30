import type { RecorderOwnership, RunRecord } from "@agentlens/storage";

import {
  systemProcessIdentityInspector,
  type ProcessIdentityInspector
} from "./processIdentity.js";

export type OwnershipDiagnosisValue =
  | "unavailable"
  | "active"
  | "likely_stale"
  | "unknown"
  | "released"
  | "orphan_child_active"
  | "identity_ambiguous";

export interface OwnershipDiagnosis {
  readonly storedCondition: RecorderOwnership["condition"] | null;
  readonly diagnosis: OwnershipDiagnosisValue;
}

export async function diagnoseOwnership(
  run: RunRecord,
  ownership: RecorderOwnership | null,
  inspector: ProcessIdentityInspector = systemProcessIdentityInspector
): Promise<OwnershipDiagnosis> {
  if (ownership === null) {
    return Object.freeze({ storedCondition: null, diagnosis: "unavailable" });
  }
  const storedCondition = ownership.condition;
  if (run.status !== "starting" && run.status !== "running") {
    return Object.freeze({ storedCondition, diagnosis: "released" });
  }
  if (
    storedCondition === "released" ||
    storedCondition === "orphan_child_active" ||
    storedCondition === "identity_ambiguous"
  ) {
    return Object.freeze({ storedCondition, diagnosis: storedCondition });
  }
  if (storedCondition !== "active" && storedCondition !== "reconciling") {
    return Object.freeze({ storedCondition, diagnosis: "unknown" });
  }
  try {
    const state = await inspector.inspect(
      ownership.recorderPid,
      ownership.recorderStartToken
    );
    return Object.freeze({
      storedCondition,
      diagnosis: state === "same"
        ? "active"
        : state === "gone" || state === "replaced"
          ? "likely_stale"
          : "unknown"
    });
  } catch {
    return Object.freeze({ storedCondition, diagnosis: "unknown" });
  }
}
