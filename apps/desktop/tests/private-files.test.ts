import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";

test("desktop development does not expose neighboring workspace files", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "agentlens-workspace-boundary-")),
  );
  const root = join(workspace, "apps/desktop");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(workspace, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n",
  );
  await writeFile(
    join(workspace, "workspace-private.txt"),
    "workspace private marker",
  );
  await writeFile(join(root, "public-check.txt"), "desktop public marker");
  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(base + "/public-check.txt")).status, 200);
    const response = await fetch(
      base + "/@fs" + join(workspace, "workspace-private.txt"),
    );
    assert.equal(response.status, 403);
    assert.ok(!(await response.text()).includes("workspace private marker"));
  } finally {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("development server denies private connection and real-run QA files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlens-private-files-"));
  const files = [
    ".local/connection.json",
    "qa/real-run/report.json",
    "qa/insight-engine/selection.json",
    ".local/insight-engine/credential.json",
    ".env",
    "local.key",
  ];
  for (const file of files) {
    await mkdir(resolve(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "private test marker");
  }
  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== "string");
    for (const file of files) {
      for (const path of [`/${file}`, `/@fs${join(root, file)}`]) {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        assert.equal(response.status, 403, path);
        assert.ok(!(await response.text()).includes("private test marker"));
      }
    }
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
