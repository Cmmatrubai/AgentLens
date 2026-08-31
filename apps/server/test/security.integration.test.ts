import { request } from "node:http";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile
} from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startAgentLensServer,
  type AgentLensServerHandle
} from "../src/startServer.js";
import { createBootstrapHtml } from "../src/bootstrap.js";
import { noStoreSecurityHeaders } from "../src/security/headers.js";
import { loadStaticAssets } from "../src/staticAssets.js";
import { boot as fixtureBoot } from "./fixtures/web/assets/fixture.js";

const fixtureWebRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "web");
const fixtureModule = join(fixtureWebRoot, "assets", "fixture.js");
const handles: AgentLensServerHandle[] = [];

async function startFixtureServer(): Promise<AgentLensServerHandle> {
  let seed = 1;
  const handle = await startAgentLensServer({
    dataRoot: "/tmp/agentlens-security-sentinel",
    webRoot: fixtureWebRoot,
    host: "127.0.0.1",
    port: 0,
    tokenBytes: () => Buffer.alloc(32, seed++)
  });
  handles.push(handle);
  return handle;
}

function rawRequest(
  origin: string,
  path: string,
  options: Readonly<{
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    setHost?: boolean;
  }> = {}
): Promise<Readonly<{ status: number; headers: typeof import("node:http").IncomingHttpHeaders; body: string }>> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const outbound = request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? "GET",
      headers: options.headers,
      setHost: options.setHost
    }, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => { body += chunk; });
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body
      }));
    });
    outbound.once("error", reject);
    if (options.body !== undefined) outbound.write(options.body);
    outbound.end();
  });
}

function rawSocketRequest(
  origin: string,
  path: string,
  headerLines: readonly string[]
): Promise<Readonly<{ status: number; body: string }>> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    socket.setEncoding("utf8");
    let response = "";
    socket.once("connect", () => {
      socket.end([
        `GET ${path} HTTP/1.1`,
        ...headerLines,
        "Connection: close",
        "",
        ""
      ].join("\r\n"));
    });
    socket.on("data", (chunk: string) => { response += chunk; });
    socket.once("error", reject);
    socket.once("close", () => {
      const [head = "", body = ""] = response.split("\r\n\r\n", 2);
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0);
      resolve({ status, body });
    });
  });
}

async function consumeBootstrap(html: string): Promise<string> {
  const script = /<script id="agentlens-bootstrap" type="module" nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error("bootstrap script missing");
  const executable = script.replace(
    'const { boot } = await import("/assets/fixture.js");',
    ""
  );
  let bearer: string | undefined;
  let removed = false;
  const scope = globalThis as typeof globalThis & {
    __AGENTLENS_TEST_BOOT__?: (token: string | null) => void;
  };
  scope.__AGENTLENS_TEST_BOOT__ = (token) => {
    if (typeof token === "string") bearer = token;
  };
  try {
    const execute = new Function(
      "history",
      "document",
      "boot",
      `return (async () => {${executable}})();`
    );
    await execute(
      { replaceState: vi.fn() },
      { getElementById: () => ({ remove: () => { removed = true; } }) },
      fixtureBoot
    );
  } finally {
    delete scope.__AGENTLENS_TEST_BOOT__;
  }
  expect(removed).toBe(true);
  if (!bearer) throw new Error("fixture module did not receive the bearer");
  return bearer;
}

function expectNoStoreSecurityHeaders(headers: Headers): void {
  expect(headers.get("cache-control")).toBe("no-store");
  expect(headers.get("referrer-policy")).toBe("no-referrer");
  expect(headers.get("x-content-type-options")).toBe("nosniff");
  expect(headers.get("x-frame-options")).toBe("DENY");
  expect(headers.get("content-security-policy")).toMatch(
    /default-src 'none'.*script-src 'self' 'nonce-[^']+'.*frame-ancestors 'none'/
  );
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe("AgentLens loopback security boundary", () => {
  it("does not expose a missing web-root path through startup errors", async () => {
    const missingRoot = join(fixtureWebRoot, "private-path-sentinel");
    let failure: unknown;
    try {
      await startAgentLensServer({ dataRoot: "/tmp/data-root-sentinel", webRoot: missingRoot });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("AgentLens web assets are unavailable.");
    expect((failure as Error).message).not.toContain(missingRoot);
    expect((failure as Error).message).not.toContain("data-root-sentinel");
  });

  it("rejects a manifest that canonically resolves outside the web root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-static-containment-"));
    const webRoot = join(root, "web");
    const externalManifestRoot = join(root, "external-manifest");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await mkdir(externalManifestRoot, { recursive: true });
    await writeFile(join(webRoot, "assets", "fixture.js"), "export const value = 1;\n", "utf8");
    await writeFile(join(externalManifestRoot, "manifest.json"), JSON.stringify({
      entry: { file: "assets/fixture.js", isEntry: true }
    }), "utf8");
    await symlink(externalManifestRoot, join(webRoot, ".vite"));
    let handle: AgentLensServerHandle | undefined;
    let failure: unknown;
    try {
      handle = await startAgentLensServer({ dataRoot: join(root, "data"), webRoot });
    } catch (error) {
      failure = error;
    } finally {
      await handle?.close();
      await rm(root, { recursive: true, force: true });
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("AgentLens web assets are unavailable.");
  });

  it("escapes every inline-script value before HTML embedding", () => {
    const html = createBootstrapHtml(
      "token<&>\u2028\u2029",
      "/assets/</script><script>foreign()</script>.js",
      "fixture-nonce"
    );

    expect(html).not.toContain("token<&>");
    expect(html).not.toContain("</script><script>foreign()</script>");
    expect(html).toContain("\\u003c");
    expect(html).toContain("\\u2028");
    expect(html).toContain("\\u2029");
  });

  it("allows only the nonce-bearing bootstrap and its same-origin module", () => {
    expect(noStoreSecurityHeaders("fixture-nonce")["Content-Security-Policy"])
      .toContain("script-src 'self' 'nonce-fixture-nonce'");
  });

  it("selects exactly loopback and rejects foreign, malformed, and missing Host values", async () => {
    const handle = await startFixtureServer();
    expect(new URL(handle.origin).hostname).toBe("127.0.0.1");
    const bootstrapPath = new URL(handle.bootstrapUrl).pathname;
    const expectedHost = new URL(handle.origin).host;

    for (const host of [
      "localhost",
      "evil.test",
      "127.0.0.1:1, evil.test",
      "[::1]",
      `${expectedHost}, evil.test`,
      `evil.test, ${expectedHost}`
    ]) {
      const rejected = await rawRequest(handle.origin, bootstrapPath, { headers: { Host: host } });
      expect(rejected.status).toBe(400);
      expect(rejected.body).not.toContain("agentlens-security-sentinel");
    }
    const missing = await rawRequest(handle.origin, bootstrapPath, { setHost: false });
    expect(missing.status).toBe(400);

    const valid = await fetch(handle.bootstrapUrl);
    expect(valid.status).toBe(200);
  });

  it("rejects duplicate Host fields in either order without consuming bootstrap", async () => {
    const handle = await startFixtureServer();
    const bootstrapPath = new URL(handle.bootstrapUrl).pathname;
    const expectedHost = new URL(handle.origin).host;

    for (const headers of [
      [`Host: evil.test`, `hOsT: ${expectedHost}`],
      [`HOST: ${expectedHost}`, "Host: evil.test"]
    ]) {
      const rejected = await rawSocketRequest(handle.origin, bootstrapPath, headers);
      expect(rejected.status).toBe(400);
      expect(rejected.body).not.toContain("agentlens-bootstrap");
    }

    const accepted = await rawSocketRequest(handle.origin, bootstrapPath, [
      `Host: ${expectedHost}`
    ]);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toContain("agentlens-bootstrap");
  });

  it("authenticates every API request with the bearer obtained by executing bootstrap once", async () => {
    const handle = await startFixtureServer();
    const ordinaryStdout = vi.spyOn(process.stdout, "write");
    const first = await fetch(handle.bootstrapUrl);
    const html = await first.text();
    const bearer = await consumeBootstrap(html);

    expect(first.status).toBe(200);
    expectNoStoreSecurityHeaders(first.headers);
    expect(html).toContain("history.replaceState(null, '', '/runs')");
    expect(html).toMatch(/<script id="agentlens-bootstrap" type="module" nonce="[^"]+">/);
    expect(html).toContain('document.getElementById("agentlens-bootstrap")?.remove()');
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|window\.|location\.(?:search|hash)/i);
    expect(handle.bootstrapUrl).not.toContain(bearer);

    const second = await fetch(handle.bootstrapUrl);
    expect(second.status).toBe(404);
    expect((await fetch(`${handle.origin}/api/v1/health`)).status).toBe(401);
    expect((await fetch(`${handle.origin}/api/v1/health`, {
      headers: { Authorization: "Bearer malformed" }
    })).status).toBe(401);
    const health = await fetch(`${handle.origin}/api/v1/health`, {
      headers: { Authorization: `Bearer ${bearer}` }
    });
    expect(health.status).toBe(200);
    expectNoStoreSecurityHeaders(health.headers);
    expect(await health.json()).toEqual({
      schemaVersion: 1,
      ready: true,
      readModel: "ready"
    });
    expect(ordinaryStdout).not.toHaveBeenCalledWith(expect.stringContaining(bearer));
    ordinaryStdout.mockRestore();
  });

  it("serves allowlisted static assets without authentication or token material", async () => {
    const handle = await startFixtureServer();
    const bootstrap = await fetch(handle.bootstrapUrl);
    const bearer = await consumeBootstrap(await bootstrap.text());
    const asset = await fetch(`${handle.origin}/assets/fixture.js`);

    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("content-type")).toMatch(/javascript/);
    const source = await asset.text();
    expect(source).toBe(await readFile(fixtureModule, "utf8"));
    expect(source).not.toContain(bearer);
    expect((await fetch(`${handle.origin}/assets/../.vite/manifest.json`)).status).toBe(404);
    expect((await fetch(`${handle.origin}/.vite/manifest.json`)).status).toBe(404);
  });

  it.each(["final", "intermediate"] as const)(
    "refuses an allowlisted asset with a %s symlink component",
    async (symlinkKind) => {
      if (process.platform === "win32") return;
      const root = await mkdtemp(join(tmpdir(), "agentlens-static-nofollow-"));
      const webRoot = join(root, "web");
      await mkdir(join(webRoot, ".vite"), { recursive: true });
      let assetUrl: string;
      if (symlinkKind === "final") {
        await mkdir(join(webRoot, "assets"), { recursive: true });
        await writeFile(join(webRoot, "assets", "real.js"), "export const secret = 1;\n", "utf8");
        await symlink("real.js", join(webRoot, "assets", "link.js"));
        assetUrl = "assets/link.js";
      } else {
        await mkdir(join(webRoot, "real-assets"), { recursive: true });
        await writeFile(
          join(webRoot, "real-assets", "fixture.js"),
          "export const secret = 1;\n",
          "utf8"
        );
        await symlink("real-assets", join(webRoot, "assets"));
        assetUrl = "assets/fixture.js";
      }
      await writeFile(join(webRoot, ".vite", "manifest.json"), JSON.stringify({
        entry: { file: assetUrl, isEntry: true }
      }), "utf8");
      let handle: AgentLensServerHandle | undefined;
      try {
        handle = await startAgentLensServer({ dataRoot: join(root, "data"), webRoot });
        expect((await fetch(`${handle.origin}/${assetUrl}`)).status).toBe(404);
      } finally {
        await handle?.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it("bounds an allowlisted asset through the opened descriptor", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-static-bounded-"));
    const webRoot = join(root, "web");
    await mkdir(join(webRoot, ".vite"), { recursive: true });
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "assets", "oversized.js"), Buffer.alloc(8 * 1024 * 1024 + 1));
    await writeFile(join(webRoot, ".vite", "manifest.json"), JSON.stringify({
      entry: { file: "assets/oversized.js", isEntry: true }
    }), "utf8");
    let handle: AgentLensServerHandle | undefined;
    try {
      handle = await startAgentLensServer({ dataRoot: join(root, "data"), webRoot });
      expect((await fetch(`${handle.origin}/assets/oversized.js`)).status).toBe(404);
    } finally {
      await handle?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["growth", "abc", async (path: string) => appendFile(path, "def")],
    ["shrink", "abcdefgh", async (path: string) => truncate(path, 3)]
  ] as const)("rejects descriptor content after an in-read %s", async (
    _change,
    initialContent,
    mutate
  ) => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-static-stability-"));
    const webRoot = join(root, "web");
    const assetPath = join(webRoot, "assets", "mutable.js");
    await mkdir(join(webRoot, ".vite"), { recursive: true });
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(assetPath, initialContent, "utf8");
    await writeFile(join(webRoot, ".vite", "manifest.json"), JSON.stringify({
      entry: { file: "assets/mutable.js", isEntry: true }
    }), "utf8");
    const canonicalAssetPath = await realpath(assetPath);
    let changed = false;
    const fileAccess = {
      lstat,
      realpath,
      async open(path: string, flags: number) {
        const handle = await open(path, flags);
        if (path !== canonicalAssetPath) return handle;
        return {
          stat: () => handle.stat(),
          async read(
            buffer: Buffer,
            offset: number,
            length: number,
            position: number
          ) {
            if (!changed) {
              changed = true;
              await mutate(canonicalAssetPath);
            }
            return handle.read(buffer, offset, length, position);
          },
          close: () => handle.close()
        };
      }
    };

    try {
      const assets = await loadStaticAssets(webRoot, fileAccess);
      expect(await assets.read("/assets/mutable.js")).toBeNull();
      expect(changed).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves an unchanged empty allowlisted asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-static-empty-"));
    const webRoot = join(root, "web");
    await mkdir(join(webRoot, ".vite"), { recursive: true });
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "assets", "empty.js"), Buffer.alloc(0));
    await writeFile(join(webRoot, ".vite", "manifest.json"), JSON.stringify({
      entry: { file: "assets/empty.js", isEntry: true }
    }), "utf8");

    try {
      const assets = await loadStaticAssets(webRoot);
      expect((await assets.read("/assets/empty.js"))?.bytes).toEqual(Buffer.alloc(0));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["/runs", "/runs/run-fixture"])(
    "serves a token-free expired-authentication shell for %s reloads",
    async (path) => {
      const handle = await startFixtureServer();
      const bootstrap = await fetch(handle.bootstrapUrl);
      const bearer = await consumeBootstrap(await bootstrap.text());
      const reload = await fetch(`${handle.origin}${path}`);
      const html = await reload.text();

      expect(reload.status).toBe(200);
      expectNoStoreSecurityHeaders(reload.headers);
      expect(html).toContain("boot(null)");
      expect(html).toContain("Authentication expired");
      expect(html).not.toContain(bearer);
      expect(html).not.toMatch(/fetch\s*\(|\/api\/v1/);
    }
  );

  it("rejects foreign/null mutation origins and oversized bodies before route work", async () => {
    const handle = await startFixtureServer();
    const bootstrap = await fetch(handle.bootstrapUrl);
    const bearer = await consumeBootstrap(await bootstrap.text());
    const authorization = `Bearer ${bearer}`;

    for (const origin of ["https://foreign.invalid", "null"]) {
      const response = await fetch(`${handle.origin}/api/v1/health`, {
        method: "PUT",
        headers: { Authorization: authorization, Origin: origin, "Content-Type": "application/json" },
        body: "{}"
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        schemaVersion: 1,
        error: {
          code: "forbidden_origin",
          message: "Request origin is not allowed.",
          retryable: false
        }
      });
    }

    const oversized = await rawRequest(handle.origin, "/api/v1/health", {
      method: "PUT",
      headers: {
        Authorization: authorization,
        Origin: handle.origin,
        "Content-Type": "application/json",
        "Content-Length": String(1024 * 1024 + 1)
      },
      body: "{}"
    });
    expect(oversized.status).toBe(413);
    expect(JSON.parse(oversized.body)).toMatchObject({
      schemaVersion: 1,
      error: { code: "invalid_request", retryable: false }
    });
    expect(oversized.body).not.toMatch(/agentlens-security-sentinel|Error:| at /);
  });

  it("closes promptly even after rejecting an incomplete oversized request", async () => {
    const handle = await startFixtureServer();
    const bootstrap = await fetch(handle.bootstrapUrl);
    const bearer = await consumeBootstrap(await bootstrap.text());
    await rawRequest(handle.origin, "/api/v1/health", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Origin: handle.origin,
        "Content-Type": "application/json",
        "Content-Length": String(1024 * 1024 + 1)
      },
      body: "{}"
    });

    const startedAt = Date.now();
    await handle.close();
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
