import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  privateRead,
  privateWrite,
} from "../server/insights/private-files.mjs";
test("private state persists atomically with owner-only permissions and rejects path escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "insight-files-"));
  try {
    await privateWrite(root, "settings.json", { model: "chosen" });
    assert.deepEqual(await privateRead(root, "settings.json"), {
      model: "chosen",
    });
    assert.equal((await stat(join(root, "settings.json"))).mode & 0o777, 0o600);
    await assert.rejects(privateWrite(root, "../escape.json", {}));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a symlink cannot substitute a settings file", async () => {
  const root = await mkdtemp(join(tmpdir(), "insight-link-"));
  try {
    await privateWrite(root, "real.json", { secret: "test" });
    await symlink(join(root, "real.json"), join(root, "settings.json"));
    await assert.rejects(privateRead(root, "settings.json"));
    await assert.rejects(privateWrite(root, "settings.json", {}));
    assert.equal(
      (await readFile(join(root, "real.json"), "utf8")).includes("test"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
