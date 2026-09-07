const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "agentlens",
  Object.freeze({
    readRecordedRun: () => ipcRenderer.invoke("agentlens:read-recorded-run"),
    readComparison: () => ipcRenderer.invoke("agentlens:read-comparison"),
    readInsights: () => ipcRenderer.invoke("agentlens:insight-read"),
    configureInsights: (input) =>
      ipcRenderer.invoke("agentlens:insight-configure", input),
    generateInsights: (input) =>
      ipcRenderer.invoke("agentlens:insight-generate", input),
    forgetInsightKey: () => ipcRenderer.invoke("agentlens:insight-forget-key"),
    openInsightPair: () => ipcRenderer.invoke("agentlens:insight-open-pair"),
    useOriginalComparison: () =>
      ipcRenderer.invoke("agentlens:insight-use-c01"),
  }),
);
