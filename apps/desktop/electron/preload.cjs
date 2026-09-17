const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "agentlens",
  Object.freeze({
    readDesktopEnvironment: () =>
      ipcRenderer.invoke("agentlens:environment-read"),
    liveChecksRead: (id) =>
      ipcRenderer.invoke("agentlens:live-checks-read", { id }),
    liveChecksStart: (id, check) =>
      ipcRenderer.invoke("agentlens:live-checks-start", { id, check }),
    liveChecksStop: (id) =>
      ipcRenderer.invoke("agentlens:live-checks-stop", { id }),
    liveChecksAcknowledge: (id, confirmed) =>
      ipcRenderer.invoke("agentlens:live-checks-acknowledge", {
        id,
        confirmed,
      }),
    liveModels: () => ipcRenderer.invoke("agentlens:live-models"),
    liveChooseProject: () =>
      ipcRenderer.invoke("agentlens:live-choose-project"),
    livePrerequisites: () => ipcRenderer.invoke("agentlens:live-prerequisites"),
    liveStart: (input) => ipcRenderer.invoke("agentlens:live-start", input),
    liveRead: (id) => ipcRenderer.invoke("agentlens:live-read", { id }),
    liveStop: (id, key) =>
      ipcRenderer.invoke("agentlens:live-stop", { id, key }),
    liveOpenComparison: (id) =>
      ipcRenderer.invoke("agentlens:live-open-comparison", { id }),
    liveAcknowledgeCleanup: (id, acknowledged) =>
      ipcRenderer.invoke("agentlens:live-acknowledge-cleanup", {
        id,
        acknowledged,
      }),
    readRecordedRun: () => ipcRenderer.invoke("agentlens:read-recorded-run"),
    readComparison: () => ipcRenderer.invoke("agentlens:read-comparison"),
    readInsights: () => ipcRenderer.invoke("agentlens:insight-read"),
    configureInsights: (input) =>
      ipcRenderer.invoke("agentlens:insight-configure", input),
    generateInsights: (input) =>
      ipcRenderer.invoke("agentlens:insight-generate", input),
    reviewInsightSupport: (input) =>
      ipcRenderer.invoke("agentlens:insight-review-support", input),
    forgetInsightKey: () => ipcRenderer.invoke("agentlens:insight-forget-key"),
    openInsightPair: (input) =>
      ipcRenderer.invoke("agentlens:insight-open-pair", input),
    useOriginalComparison: () =>
      ipcRenderer.invoke("agentlens:insight-use-c01"),
  }),
);
