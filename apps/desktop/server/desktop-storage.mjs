import { mkdir, lstat, realpath, open, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { privateRead, privateWrite } from "./insights/private-files.mjs";

// Existing worktrees and journals contain absolute paths. Pin their location;
// do not copy or rename them as part of application bootstrap.
export async function resolveDesktopStorage({ userData, legacyRoot }) {
  try {
    if (!isAbsolute(userData) || !isAbsolute(legacyRoot))
      throw Error("invalid");
    const config = join(userData, "storage");
    const saved = await privateRead(config, "location.json");
    let selected;
    if (saved) {
      if (
        saved.schemaVersion !== 1 ||
        typeof saved.root !== "string" ||
        !isAbsolute(saved.root) ||
        !["application-data", "existing-location"].includes(saved.mode)
      )
        throw Error("invalid");
      const canonical = await realpath(saved.root);
      if (canonical !== saved.root) throw Error("changed");
      selected = { root: canonical, mode: saved.mode };
    } else {
      let legacy;
      try {
        legacy = await lstat(legacyRoot);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (legacy) {
        selected = {
          root: await realpath(legacyRoot),
          mode: "existing-location",
        };
      } else {
        const root = join(userData, "data");
        await mkdir(root, { recursive: true, mode: 0o700 });
        if ((await lstat(root)).isSymbolicLink()) throw Error("unsafe");
        selected = { root: await realpath(root), mode: "application-data" };
      }
    }
    if (!(await lstat(selected.root)).isDirectory()) throw Error("invalid");
    const probe = join(selected.root, ".agentlens-write-probe-" + randomUUID());
    const file = await open(probe, "wx", 0o600);
    try {
      await file.writeFile("");
      await file.sync();
    } finally {
      await file.close();
      await unlink(probe);
    }
    if (!saved)
      await privateWrite(config, "location.json", {
        schemaVersion: 1,
        ...selected,
      });
    return selected;
  } catch (error) {
    throw Object.assign(Error("desktop_storage_unavailable"), { cause: error });
  }
}
