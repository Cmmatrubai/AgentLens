const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { open } = require("node:fs/promises");
const { constants } = require("node:fs");
const { createCredentialStore } = require("./insight-credentials.cjs");
function trustedFrame(event) {
  const frame = event.senderFrame;
  const expected = pathToFileURL(
    path.join(__dirname, "../dist/index.html"),
  ).href;
  return (
    !!frame &&
    frame === event.sender.mainFrame &&
    frame.url.split("?")[0].split("#")[0] === expected
  );
}
function installInsightIPC({ ipcMain, safeStorage, dialog, BrowserWindow }) {
  let runtime;
  let service;
  const load = async () => {
    runtime ??= await import(
      pathToFileURL(path.join(__dirname, "../server/insights/runtime.mjs")).href
    );
    service ??= runtime.createRuntime(
      createCredentialStore({ safeStorage, root: runtime.insightRoot }),
    );
    return { runtime, service };
  };
  const handle = (name, fn) =>
    ipcMain.handle("agentlens:insight-" + name, async (event, payload) => {
      if (!trustedFrame(event)) return { ok: false, error: "forbidden" };
      try {
        return await fn(await load(), payload, event);
      } catch {
        return { ok: false, error: "insight_operation_failed" };
      }
    });
  handle("read", ({ service }) => service.read());
  handle("configure", ({ service }, payload) => service.configure(payload));
  handle("generate", ({ service }, payload) => service.generate(payload));
  handle("forget-key", ({ service }) => service.forgetKey());
  handle("use-c01", ({ runtime }) => runtime.useOriginalComparison());
  handle("open-pair", async ({ runtime }, _payload, event) => {
    const selected = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title: "Open a saved comparison bundle",
        properties: ["openFile"],
        filters: [{ name: "AgentLens comparison", extensions: ["json"] }],
      },
    );
    if (selected.canceled || selected.filePaths.length !== 1)
      return { ok: true, cancelled: true };
    const file = await open(
      selected.filePaths[0],
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
        return { ok: false, error: "invalid_comparison_bundle" };
      return await runtime.selectComparison(await file.readFile("utf8"));
    } finally {
      await file.close();
    }
  });
}
module.exports = { trustedFrame, installInsightIPC };
