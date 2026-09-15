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
  const { buildSupportUnits, buildSupportEvidence } = await import(
    pathToFileURL(path.join(root, "server/insights/support-schema.mjs"))
  );
  const importPreset = process.env.AGENTLENS_QA_SUPPORT_PRESET === "imports";
  let pair = makePair();
  if (process.env.AGENTLENS_QA_SUPPORT_PRESET === "facts") pair.checks.push({id:"unrun-boundary", title:"Unrun boundary check"});
  if (importPreset) pair.attempts[0].run.git.files = [{path:"src/entry.ts", truncated:false,
    content:'diff --git a/src/entry.ts b/src/entry.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/entry.ts\n@@ -0,0 +1 @@\n+import { QUEUE_LIMIT, warnOverflow } from "./policy";\n'}];
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
    review: async ({draft, bundle, model}) => {
      await new Promise(resolve => setTimeout(resolve, 2500));
      if (model === "offline-review-fail") throw Error("provider_unreachable");
      const evidence = buildSupportEvidence(bundle);
      return {output: {assessments: buildSupportUnits(draft).map(unit => {
        const fact = unit.field === "summary";
        const metadata = unit.field === "limitations";
        const importSide = importPreset && /^sides\[(\d+)\]\.observation$/.exec(unit.field);
        const owner = importSide ? draft.findings[0].sides[Number(importSide[1])].attemptKey : null;
        const record = importSide ? evidence.find(item => item.attemptKey === owner && (owner === "north" ? item.kind === "file" : item.kind === "event")) : evidence.find(item => fact ? item.kind === "attempt_facts" : item.sourceId === unit.sourceIds[0]);
        return { unitId: unit.id, claims: [{ text: unit.text,
          verdict: model !== "offline-review-supported" && fact ? "needs_review" : "supported",
          reason: "Offline UI fixture; this verdict does not measure model quality.",
          passages: [unit.field === "interpretation" ? "T1:t1" : `${record.ref}:${metadata ? "m" : "t"}1`],
        }] };
      })}, usage: {input_tokens: 100, output_tokens: 50, total_tokens: 150}};
    },
    analyze: async ({ bundle, model }) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (model === "offline-fail") throw Error("provider_unreachable");
      if (model === "offline-limit") {
        const error = Error("provider_incomplete");
        error.diagnostics = {finishReason: "length", outputTokens: 6000, reasoningTokens: 5994, answerCharacters: 0};
        throw error;
      }
      const draft = makeFinding(bundle);
      if (importPreset) for (const side of draft.findings[0].sides) side.observation = `${side.attemptKey} imports both QUEUE_LIMIT and warnOverflow from "./policy" into src/entry.ts.`;
      return {
        output:
          model === "offline-empty"
            ? {
                findings: [],
                abstentionReason:
                  "Offline fixture: no material difference is supported.",
              }
            : draft,
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      };
    },
  });
  const preset = process.env.AGENTLENS_QA_SUPPORT_PRESET;
  if (["needs_review", "supported", "imports"].includes(preset)) {
    const { randomUUID } = require("node:crypto");
    const ready = await service.configure({ model: preset !== "needs_review" ? "offline-review-supported" : "offline-review-concerns", enabled: true, authMode: "none" });
    await service.generate({ inputHash: ready.input.hash, settingsHash: ready.settingsHash, requestId: randomUUID() });
    const waitFor = async (predicate) => {
      for (let i = 0; i < 100; i++) {
        const state = await service.read();
        if (predicate(state)) return state;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error("Offline fixture did not settle");
    };
    const draft = await waitFor(state => state.state === "available");
    await service.reviewSupport({ analysisId: draft.analysis.id, inputHash: draft.input.hash,
      settingsHash: draft.settingsHash, reviewKey: draft.support.reviewKey, requestId: randomUUID() });
    await waitFor(state => state.support?.state === "available");
  }
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
  handle("agentlens:insight-review-support", (input) => service.reviewSupport(input));
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
