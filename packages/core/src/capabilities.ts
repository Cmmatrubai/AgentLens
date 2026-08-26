export interface AdapterCapabilities {
  sourceTimestamps: boolean;
  fileReads: "native" | "partial" | "unavailable";
  toolOutput: "native" | "partial" | "unavailable";
  toolDurations: "native" | "partial" | "unavailable";
  interruptionSignal: "native" | "recorder_only" | "partial";
}

export const codexExecCapabilities: AdapterCapabilities = {
  sourceTimestamps: false,
  fileReads: "unavailable",
  toolOutput: "partial",
  toolDurations: "unavailable",
  interruptionSignal: "partial"
};
