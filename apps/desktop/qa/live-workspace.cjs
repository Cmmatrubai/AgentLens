// Native acceptance harness: real recorder/controller, local fixture Codex only.
// All recordings, comparison selections, and Electron state stay in a temporary root.
const { app, BrowserWindow, ipcMain, dialog, session } = require("electron");
const {
  mkdtemp,
  mkdir,
  copyFile,
  chmod,
  writeFile,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, delimiter } = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const desktop = resolve(__dirname, "..");
let service, bridge, temporary, selected;
const prepare = async () => {
  temporary =
    process.env.AGENTLENS_LIVE_QA_ROOT ||
    (await mkdtemp(join(tmpdir(), "agentlens-live-ui-")));
  await mkdir(join(temporary, "electron"), { recursive: true });
  app.setPath("userData", join(temporary, "electron"));
  const project = join(temporary, "sample-project"),
    bin = join(temporary, "bin");
  await mkdir(project, { recursive: true });
  await mkdir(bin, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: project });
  if (!existsSync(join(project, ".git"))) {
    git("init", "-q");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    await writeFile(join(project, "task.txt"), "Initial task content\n");
    git("add", ".");
    git("commit", "-qm", "initial");
  }
  await copyFile(
    join(desktop, "tests/fixtures/live-codex.mjs"),
    join(bin, "codex"),
  );
  await chmod(join(bin, "codex"), 0o700);
  return { project, bin };
};
const prepared = prepare();
app.whenReady().then(async () => {
  const { project, bin } = await prepared;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_, callback) => callback({ cancel: true }),
  );
  const { createLiveController } = await import(
    pathToFileURL(join(desktop, "server/live/controller.mjs")).href
  );
  const { launchAttempt } = await import(
    pathToFileURL(join(desktop, "server/live/transport.mjs")).href
  );
  const { parseSelectedComparison } = await import(
    pathToFileURL(join(desktop, "server/live/selection.mjs")).href
  );
  const node = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
  service = createLiveController({
    root: join(temporary, "recordings"),
    preflight: async () => ({ version: "Fixture Codex — no provider access" }),
    launchAttempt: (input) =>
      launchAttempt({
        ...input,
        node,
        env: {
          PATH: bin + delimiter + process.env.PATH,
          HOME: temporary,
          CODEX_HOME: join(temporary, "codex"),
          AGENTLENS_FIXTURE_DELAY_MS: "1000",
          AGENTLENS_FIXTURE_STEPS: "35",
        },
      }),
  });
  // Optional deterministic transport outage for native reconnect acceptance.
  // Recording continues in the real controller while only snapshot reads fail.
  if (process.env.AGENTLENS_LIVE_QA_OUTAGE === "1") {
    const read = service.read.bind(service);
    let activeReads = 0;
    service.read = async (id) => {
      const snapshot = await read(id);
      if (snapshot.activeId && ++activeReads >= 3 && activeReads <= 7)
        throw Error("fixture_snapshot_outage");
      return snapshot;
    };
  }
  bridge = require("../electron/live-ipc.cjs").installLiveIPC({
    ipcMain,
    BrowserWindow,
    controller: service,
    dialog: {
      showOpenDialog: (win, options) =>
        dialog.showOpenDialog(win, { ...options, defaultPath: project }),
    },
    selectComparison: async (comparison) => {
      selected = parseSelectedComparison({
        source: "desktop-recording",
        comparison,
      });
    },
  });
  ipcMain.handle("agentlens:read-comparison", () =>
    selected
      ? { ok: true, comparison: selected }
      : { ok: false, error: "comparison_unavailable" },
  );
  ipcMain.handle("agentlens:insight-read", () => ({
    ok: false,
    error: "desktop_required",
  }));
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 820,
    minHeight: 600,
    title: "AgentLens — Offline live workspace QA",
    backgroundColor: "#111214",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(desktop, "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await win.loadFile(join(desktop, "dist/index.html"), {
    query: { desktop: "1" },
    hash: "/import",
  });
  console.log(JSON.stringify({ temporary, project, mode: "fixture-only" }));
});
let quitReady = false;
app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  Promise.resolve(bridge?.shutdown()).then(() => {
    quitReady = true;
    app.quit();
  });
});
app.on("window-all-closed", () => app.quit());
