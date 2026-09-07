import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha256,
  stableJson,
  validateManifest,
  readEvidence,
} from "../server/comparison-integrity.mjs";
test("changed manifest or frozen input is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "comparison-integrity-"));
  try {
    await writeFile(join(root, "prompt.txt"), "original");
    const manifest: any = {
      inputs: { "prompt.txt": sha256("original") },
      id: "C01",
    };
    manifest.manifestHash = sha256(stableJson(manifest));
    await validateManifest(root, manifest);
    await writeFile(join(root, "prompt.txt"), "changed");
    await assert.rejects(validateManifest(root, manifest), /input/i);
    manifest.id = "different";
    await assert.rejects(validateManifest(root, manifest), /manifest/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("evaluator bytes must match their hash and cannot be a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "comparison-integrity-"));
  try {
    const path = join(root, "evidence.log");
    await writeFile(path, "checked");
    assert.equal(await readEvidence(path, sha256("checked")), "checked");
    await assert.rejects(readEvidence(path, sha256("different")), /hash/i);
    const link = join(root, "linked.log");
    await symlink(path, link);
    await assert.rejects(readEvidence(link, sha256("checked")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
