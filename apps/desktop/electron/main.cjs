const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  dialog,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
require("./identity.cjs").applyDesktopIdentity(app);
let reader;
let comparisonReader;
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
require("./insight-ipc.cjs").installInsightIPC({
  ipcMain,
  safeStorage,
  dialog,
  BrowserWindow,
});
const live = require("./live-ipc.cjs").installLiveIPC({ ipcMain, dialog, BrowserWindow });
let quitReady = false;
app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  live.shutdown().then(() => { quitReady = true; app.quit(); }).catch(() => {
    // Keep the app open when recorder finalization cannot be confirmed.
    dialog.showErrorBox("Recording is still closing", "AgentLens could not confirm that recording has finished. Keep the app open and check the live workspace before quitting again.");
  });
});
ipcMain.handle("agentlens:read-comparison", async (event) => {
  const frame = event.senderFrame;
  const expected = pathToFileURL(
    path.join(__dirname, "../dist/index.html"),
  ).href;
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    frame.url.split("?")[0].split("#")[0] !== expected
  )
    return { ok: false, error: "forbidden" };
  comparisonReader ??= import(
    pathToFileURL(path.join(__dirname, "../server/insights/runtime.mjs")).href
  );
  return (await comparisonReader).readActiveComparison();
});
ipcMain.handle("agentlens:read-recorded-run", async (event) => {
  const frame = event.senderFrame;
  const expected = pathToFileURL(
    path.join(__dirname, "../dist/index.html"),
  ).href;
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    frame.url.split("?")[0].split("#")[0] !== expected
  )
    return { ok: false, error: "forbidden" };
  reader ??= import(
    pathToFileURL(path.join(__dirname, "../server/recorded-reader.mjs")).href
  );
  return (await reader).readRecordedRun();
});
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 820,
    minHeight: 600,
    title: "AgentLens",
    backgroundColor: "#111214",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, "../dist/index.html"), {
    query: { desktop: "1" },
  });
}
app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
