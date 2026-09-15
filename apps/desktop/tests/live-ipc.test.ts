import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const { installLiveIPC } = createRequire(import.meta.url)(
  "../electron/live-ipc.cjs",
);

test("model catalog IPC ignores renderer paths and never initializes recording work", async () => {
  const handlers = new Map();
  const frame = {
    url: pathToFileURL(
      fileURLToPath(new URL("../dist/index.html", import.meta.url)),
    ).href,
  };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  let calls = 0;
  installLiveIPC({
    ipcMain: {
      handle: (name: string, handler: any) => handlers.set(name, handler),
    },
    dialog: {},
    BrowserWindow: {},
    readModels: async (...args: any[]) => {
      assert.deepEqual(args, []);
      calls++;
      return { source: "codex-cache", fetchedAt: null, models: [] };
    },
  });
  assert.deepEqual(
    await handlers.get("agentlens:live-models")(event, {
      root: "/untrusted/path",
    }),
    {
      ok: true,
      catalog: { source: "codex-cache", fetchedAt: null, models: [] },
    },
  );
  assert.equal(calls, 1);
});

test("live IPC rejects foreign frames before loading the controller or opening a picker", async () => {
  const handlers = new Map();
  installLiveIPC({
    ipcMain: { handle: (n: string, f: any) => handlers.set(n, f) },
    dialog: {},
    BrowserWindow: {},
    controller: {
      start() {
        throw Error("must not call");
      },
    },
  });
  const foreign = { url: "http://127.0.0.1:5178/" };
  for (const handler of handlers.values())
    assert.deepEqual(
      await handler(
        { senderFrame: foreign, sender: { mainFrame: foreign } },
        {},
      ),
      { ok: false, error: "forbidden" },
    );
});

test("a cancelled project picker leaves selection unchanged and runtime errors never expose secrets", async () => {
  const handlers = new Map();
  const frame = {
    url:
      pathToFileURL(
        fileURLToPath(new URL("../dist/index.html", import.meta.url)),
      ).href + "?desktop=1#/workspace",
  };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  installLiveIPC({
    ipcMain: { handle: (n: string, f: any) => handlers.set(n, f) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    BrowserWindow: { fromWebContents: () => ({}) },
    controller: {
      start() {
        throw Error("secret fixture token");
      },
    },
  });
  assert.deepEqual(await handlers.get("agentlens:live-choose-project")(event), {
    ok: true,
    cancelled: true,
  });
  assert.deepEqual(await handlers.get("agentlens:live-start")(event, {}), {
    ok: false,
    error: "live_operation_failed",
  });
});
