// Isolated UI acceptance harness. It cannot contact a provider or alter real insight state.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../..");
let temporary;
app.whenReady().then(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "agentlens-offline-ui-"));
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_, callback) => callback({ cancel: true }),
  );
  const { makePair, makeFinding } = await import(
    pathToFileURL(path.join(root, "tests/fixtures/insight-comparisons.mjs"))
  );
  const { createInsightService } = await import(
    pathToFileURL(path.join(root, "server/insights/service.mjs"))
  );
  const { parseComparisonBundle } = await import(
    pathToFileURL(path.join(root, "server/insights/import-pair.mjs"))
  );
  let pair = makePair();
  pair.title = "OFFLINE QA · Compare validation approaches";
  pair = parseComparisonBundle(JSON.stringify(pair));
  let empty = process.env.AGENTLENS_QA_EMPTY === "1";
  const readPair = async () =>
    empty
      ? { ok: false, error: "comparison_unavailable" }
      : { ok: true, comparison: pair };
  let key = null;
  const service = createInsightService({
    root: temporary,
    readComparison: readPair,
    credentialStore: {
      has: async () => !!key,
      get: async () => key,
      set: async (value) => {
        key = value;
      },
      remove: async () => {
        key = null;
      },
    },
    analyze: async ({ bundle, model }) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (model === "offline-fail") throw Error("provider_unreachable");
      return {
        output:
          model === "offline-empty"
            ? {
                findings: [],
                abstentionReason:
                  "Offline fixture: no material difference is supported.",
              }
            : makeFinding(bundle),
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      };
    },
  });
  const { trustedFrame } = require(path.join(root, "electron/insight-ipc.cjs"));
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, input) =>
      trustedFrame(event) ? fn(input) : { ok: false, error: "forbidden" },
    );
  handle("agentlens:read-comparison", readPair);
  handle("agentlens:read-recorded-run", () => ({
    ok: false,
    error: "offline_fixture",
  }));
  handle("agentlens:insight-read", () => service.read());
  handle("agentlens:insight-configure", (input) => service.configure(input));
  handle("agentlens:insight-generate", (input) => service.generate(input));
  handle("agentlens:insight-forget-key", () => service.forgetKey());
  handle("agentlens:insight-open-pair", () => {
    if (empty) {
      empty = false;
      return { ok: true };
    }
    pair = {
      ...pair,
      id: "offline-disjoint",
      title: "OFFLINE QA · Missing check coverage",
      attempts: pair.attempts.map((a, i) => ({
        ...a,
        checks: [{ ...a.checks[0], id: "condition-" + i, outcome: "pass" }],
      })),
    };
    pair = parseComparisonBundle(JSON.stringify(pair));
    return { ok: true };
  });
  handle("agentlens:insight-use-c01", () => ({ ok: true, cancelled: true }));
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    title: "AgentLens · OFFLINE QA",
    webPreferences: {
      preload: path.join(root, "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(root, "dist/index.html"), {
    hash: "/comparison",
    query: { desktop: "1" },
  });
  console.log(
    "Offline UI ready; provider network disabled; all state temporary.",
  );
});
app.on("window-all-closed", async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  app.quit();
});
