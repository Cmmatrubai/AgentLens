import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  realpath,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDesktopStorage } from "../server/desktop-storage.mjs";
async function fixture(t: any) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "agentlens-storage-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    userData: join(root, "profile"),
    legacyRoot: join(root, "legacy"),
  };
}
test("fresh desktop stores outside checkout and reopens the same location", async (t) => {
  const f = await fixture(t);
  const r = await resolveDesktopStorage(f);
  assert.equal(r.mode, "application-data");
  assert.equal(r.root, join(f.userData, "data"));
  await writeFile(join(r.root, "evidence.json"), "preserved");
  assert.deepEqual(
    await resolveDesktopStorage({
      ...f,
      legacyRoot: join(f.root, "other-checkout"),
    }),
    r,
  );
  assert.equal(
    await readFile(join(r.root, "evidence.json"), "utf8"),
    "preserved",
  );
});
test("legacy symlink is pinned canonically without moving evidence or worktrees", async (t) => {
  const f = await fixture(t);
  const old = join(f.root, "original");
  await mkdir(old);
  await writeFile(join(old, "job.json"), "original bytes");
  await symlink(old, f.legacyRoot);
  const r = await resolveDesktopStorage(f);
  assert.equal(r.root, old);
  assert.equal(r.mode, "existing-location");
  await rm(f.legacyRoot);
  assert.deepEqual(await resolveDesktopStorage(f), r);
  assert.equal(await readFile(join(old, "job.json"), "utf8"), "original bytes");
  assert.deepEqual(await readdir(old), ["job.json"]);
});
test("missing pinned storage never silently creates an empty replacement", async (t) => {
  const f = await fixture(t);
  const r = await resolveDesktopStorage(f);
  await rm(r.root, { recursive: true });
  await assert.rejects(resolveDesktopStorage(f), /desktop_storage_unavailable/);
  await assert.rejects(readFile(r.root));
});
test("damaged pointer and dangling legacy links fail closed", async (t) => {
  const f = await fixture(t);
  await mkdir(f.userData, { recursive: true });
  await symlink(join(f.root, "missing"), f.legacyRoot);
  await assert.rejects(resolveDesktopStorage(f), /desktop_storage_unavailable/);
  await rm(f.legacyRoot);
  await resolveDesktopStorage(f);
  await writeFile(join(f.userData, "storage", "location.json"), "{broken");
  await assert.rejects(resolveDesktopStorage(f), /desktop_storage_unavailable/);
});
