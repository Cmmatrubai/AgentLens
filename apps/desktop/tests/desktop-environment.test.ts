import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readDesktopEnvironment } from "../server/desktop-environment.mjs";
test("tool checks distinguish missing tools from unsupported versions without exposing errors", async () => {
  const r = await readDesktopEnvironment({
    storage: { root: "/local/evidence", mode: "existing-location" },
    packaged: false,
    exec: async (name: string) => {
      if (name === "git") throw Error("secret");
      return {
        stdout:
          name === "node"
            ? "v20.1.0"
            : name === "pnpm"
              ? "10.1.0"
              : "codex-cli 1.0.0",
      };
    },
  });
  assert.equal(r.tools.find((x: any) => x.id === "node").status, "unsupported");
  assert.equal(r.tools.find((x: any) => x.id === "git").status, "unavailable");
  assert.equal(r.tools.find((x: any) => x.id === "pnpm").status, "unsupported");
  assert(!JSON.stringify(r).includes("secret"));
});
test("desktop environment IPC rejects foreign frames and ignores renderer storage paths", async () => {
  const { installEnvironmentIPC } = createRequire(import.meta.url)(
    "../electron/environment-ipc.cjs",
  );
  const handlers = new Map();
  let calls = 0;
  installEnvironmentIPC({
    ipcMain: { handle: (n: string, f: any) => handlers.set(n, f) },
    read: async (...args: any[]) => {
      assert.deepEqual(args, []);
      calls++;
      return { storage: { root: "/actual" } };
    },
  });
  const frame = {
    url: pathToFileURL(
      fileURLToPath(new URL("../dist/index.html", import.meta.url)),
    ).href,
  };
  const handler = handlers.get("agentlens:environment-read");
  assert.equal(
    (
      await handler({
        senderFrame: { url: "https://bad" },
        sender: { mainFrame: frame },
      })
    ).error,
    "forbidden",
  );
  const r = await handler(
    { senderFrame: frame, sender: { mainFrame: frame } },
    { root: "/injected" },
  );
  assert.equal(r.environment.storage.root, "/actual");
  assert.equal(calls, 1);
});
