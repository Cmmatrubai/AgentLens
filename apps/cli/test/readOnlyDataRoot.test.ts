import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

async function locate(path: string) {
  return import("../src/readOnlyDataRoot.js")
    .then(({ locateReadOnlyDataRoot }) => locateReadOnlyDataRoot(path));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only data-root location", () => {
  it("returns resolved existing regular paths without creating or changing bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-read-root-"));
    roots.push(root);
    const dataRoot = join(root, "data");
    const databasePath = join(dataRoot, "agentlens.sqlite");
    await mkdir(dataRoot);
    await writeFile(databasePath, "READ_ONLY_DATABASE_SENTINEL");

    await expect(locate(dataRoot)).resolves.toEqual({
      state: "existing",
      dataRoot: resolve(dataRoot),
      databasePath: resolve(databasePath)
    });
    expect(await readFile(databasePath, "utf8")).toBe("READ_ONLY_DATABASE_SENTINEL");
  });

  it("does not create a missing root or database", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-read-root-missing-"));
    roots.push(root);
    const missingRoot = join(root, "missing");
    const emptyRoot = join(root, "empty");
    await mkdir(emptyRoot);

    await expect(locate(missingRoot)).resolves.toEqual({
      state: "missing",
      dataRoot: resolve(missingRoot),
      databasePath: resolve(join(missingRoot, "agentlens.sqlite"))
    });
    await expect(locate(emptyRoot)).resolves.toEqual({
      state: "missing",
      dataRoot: resolve(emptyRoot),
      databasePath: resolve(join(emptyRoot, "agentlens.sqlite"))
    });
    await expect(readFile(join(emptyRoot, "agentlens.sqlite"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reports wal_present when a regular WAL exists without the main database", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-read-root-orphan-wal-"));
    roots.push(root);
    const dataRoot = join(root, "data");
    const databasePath = join(dataRoot, "agentlens.sqlite");
    const walPath = `${databasePath}-wal`;
    await mkdir(dataRoot);
    await writeFile(walPath, "ORPHAN_WAL_SENTINEL");

    await expect(locate(dataRoot)).rejects.toMatchObject({
      name: "ReadOnlyDatabaseError",
      reason: "wal_present"
    });
    expect(await readFile(walPath, "utf8")).toBe("ORPHAN_WAL_SENTINEL");
    await expect(readFile(databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects final-component root and database symlinks without mutating targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlens-read-root-symlink-"));
    roots.push(root);
    const targetRoot = join(root, "target");
    const rootLink = join(root, "root-link");
    const dataRoot = join(root, "data");
    const targetDatabase = join(root, "outside.sqlite");
    await mkdir(targetRoot);
    await writeFile(join(targetRoot, "sentinel"), "ROOT_TARGET_SENTINEL");
    await symlink(targetRoot, rootLink);
    await mkdir(dataRoot);
    await writeFile(targetDatabase, "DATABASE_TARGET_SENTINEL");
    await symlink(targetDatabase, join(dataRoot, "agentlens.sqlite"));

    await expect(locate(rootLink)).rejects.toThrow(/symbolic|regular|directory/i);
    await expect(locate(dataRoot)).rejects.toThrow(/symbolic|regular|database/i);
    expect(await readFile(join(targetRoot, "sentinel"), "utf8")).toBe("ROOT_TARGET_SENTINEL");
    expect(await readFile(targetDatabase, "utf8")).toBe("DATABASE_TARGET_SENTINEL");
  });
});
