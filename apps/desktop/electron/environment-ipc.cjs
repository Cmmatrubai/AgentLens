const { trustedFrame } = require("./insight-ipc.cjs");
function installEnvironmentIPC({ ipcMain, read }) {
  let pending;
  ipcMain.handle("agentlens:environment-read", async (event) => {
    if (!trustedFrame(event)) return { ok: false, error: "forbidden" };
    try {
      pending ??= Promise.resolve()
        .then(() => read())
        .finally(() => {
          pending = undefined;
        });
      return { ok: true, environment: await pending };
    } catch {
      return { ok: false, error: "desktop_environment_unavailable" };
    }
  });
}
module.exports = { installEnvironmentIPC };
