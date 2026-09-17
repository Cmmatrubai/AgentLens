const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { trustedFrame } = require("./insight-ipc.cjs");
const errors = new Set([
  "dependency_setup_unsupported",
  "dependency_inputs_changed",
  "dependency_tools_unavailable",
  "dependency_version_mismatch",
  "dependency_platform_unavailable",
  "dependency_install_failed",
  "dependency_cancelled",
  "invalid_check_request",
  "check_busy",
  "check_not_running",
  "check_platform_unavailable",
  "check_workspace_unavailable",
  "check_evidence_unavailable",
  "check_storage_failed",
  "check_cleanup_unconfirmed",
  "invalid_launch",
  "invalid_task",
  "invalid_timeout",
  "invalid_models",
  "invalid_identical_models",
  "invalid_project",
  "invalid_git_project",
  "invalid_project_selection",
  "project_dirty",
  "project_submodules",
  "project_changed",
  "comparison_busy",
  "comparison_closing",
  "recorder_runtime_unavailable",
  "codex_unavailable",
  "codex_update_required",
  "codex_login_required",
  "invalid_job",
  "invalid_stop",
  "comparison_incomplete",
  "recording_invalid",
  "workspace_storage_failed",
  "cleanup_unconfirmed",
  "invalid_cleanup_acknowledgement",
]);

function installLiveIPC({
  ipcMain,
  dialog,
  BrowserWindow,
  controller,
  selectComparison,
  readModels,
}) {
  // Reading model metadata must not initialize recording storage or processes.
  ipcMain.handle("agentlens:live-models", async (event) => {
    if (!trustedFrame(event)) return { ok: false, error: "forbidden" };
    try {
      const read =
        readModels ??
        (
          await import(
            pathToFileURL(
              path.join(__dirname, "../server/live/model-catalog.mjs"),
            ).href
          )
        ).readModelCatalog;
      return { ok: true, catalog: await read() };
    } catch {
      return { ok: false, error: "model_catalog_unavailable" };
    }
  });
  let pending;
  const load = () =>
    (pending ??= (async () => {
      if (controller) return controller;
      const { createLiveController } = await import(
        pathToFileURL(path.join(__dirname, "../server/live/controller.mjs"))
          .href
      );
      return createLiveController({
        root: path.join(
          require("../server/data-root.cjs").getDataRoot(),
          "live-workspace",
        ),
      });
    })());
  const handle = (name, action) =>
    ipcMain.handle("agentlens:live-" + name, async (event, input) => {
      if (!trustedFrame(event)) return { ok: false, error: "forbidden" };
      try {
        return { ok: true, ...(await action(await load(), input, event)) };
      } catch (error) {
        return {
          ok: false,
          error: errors.has(error?.message)
            ? error.message
            : "live_operation_failed",
        };
      }
    });
  handle("choose-project", async (service, _input, event) => {
    const selected = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      { title: "Choose a Git project", properties: ["openDirectory"] },
    );
    if (selected.canceled || selected.filePaths.length !== 1)
      return { cancelled: true };
    return { project: await service.chooseProject(selected.filePaths[0]) };
  });
  handle("prerequisites", async (service) => ({
    prerequisites: await service.prerequisites(),
  }));
  handle("checks-read", (service, input) => service.readChecks(input?.id));
  handle("checks-start", (service, input) =>
    service.startChecks(input?.id, input?.check),
  );
  handle("checks-stop", (service, input) => service.stopChecks(input?.id));
  handle("checks-acknowledge", (service, input) =>
    service.acknowledgeChecks(input?.id, input?.confirmed),
  );
  handle("start", async (service, input) => ({
    job: await service.start(input),
  }));
  handle("read", (service, input) => service.read(input?.id));
  handle("stop", (service, input) => service.stop(input?.id, input?.key));
  handle("acknowledge-cleanup", (service, input) =>
    service.acknowledgeCleanup(input?.id, input?.acknowledged),
  );
  handle("open-comparison", async (service, input) => {
    const comparison = await service.comparison(input?.id);
    const select =
      selectComparison ??
      (
        await import(
          pathToFileURL(path.join(__dirname, "../server/insights/runtime.mjs"))
            .href
        )
      ).selectRecordedComparison;
    await select(comparison);
    return {};
  });
  return {
    async shutdown() {
      if (pending) await (await pending).shutdown();
    },
  };
}
module.exports = { installLiveIPC };
