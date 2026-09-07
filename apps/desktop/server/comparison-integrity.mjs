import { open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableJson(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function validateManifest(root, manifest) {
  const { manifestHash, ...contents } = manifest;
  if (sha256(stableJson(contents)) !== manifestHash)
    throw new Error("Manifest hash mismatch");
  for (const [relative, hash] of Object.entries(manifest.inputs)) {
    const path = resolve(root, relative);
    if (
      !path.startsWith(resolve(root) + "/") ||
      sha256(await readFile(path)) !== hash
    )
      throw new Error("Frozen input mismatch");
  }
}
export async function readEvidence(path, hash) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw new Error("Invalid evaluator evidence");
    const bytes = await handle.readFile();
    if (bytes.length > 2 * 1024 * 1024 || sha256(bytes) !== hash)
      throw new Error("Evaluator hash mismatch");
    return bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}
