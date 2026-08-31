import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

describe("production web entry", () => {
  it("keeps the manifest entry importable with the bootstrap boot export", async () => {
    const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
    execFileSync("pnpm", ["--filter", "@agentlens/web", "build"], {
      cwd: workspaceRoot,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe"
    });
    const webRoot = join(workspaceRoot, "apps", "server", "dist", "web");
    const manifest = JSON.parse(await readFile(
      join(webRoot, ".vite", "manifest.json"),
      "utf8"
    )) as Record<string, { file?: string; isEntry?: boolean }>;
    const entries = Object.values(manifest).filter(({ isEntry }) => isEntry === true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.file).toMatch(/^assets\/bootstrap-[A-Za-z0-9_-]+\.js$/);
    const entryPath = join(webRoot, entries[0]!.file!);
    expect(await readFile(entryPath, "utf8")).not.toContain("Download the React DevTools");
    const moduleUrl = pathToFileURL(entryPath).href;
    const exportedType = execFileSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `const module = await import(${JSON.stringify(moduleUrl)}); process.stdout.write(typeof module.boot);`
    ], { encoding: "utf8" });
    expect(exportedType).toBe("function");
  });
});
