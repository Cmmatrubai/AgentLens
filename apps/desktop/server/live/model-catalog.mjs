import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// This adapter reads Codex's local cache, not an account-entitlement API.
// Keep provider instructions and unrelated cache metadata out of the renderer.
export function parseModelCatalog(value) {
  if (!Array.isArray(value?.models)) throw Error("model_catalog_unavailable");
  const models = [],
    seen = new Set();
  for (const model of value.models.slice(0, 500)) {
    if (
      model?.visibility !== "list" ||
      typeof model.slug !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model.slug) ||
      seen.has(model.slug)
    )
      continue;
    const efforts = ["low", "medium", "high", "xhigh"].filter(
      (e) =>
        Array.isArray(model.supported_reasoning_levels) &&
        model.supported_reasoning_levels.some((v) => v?.effort === e),
    );
    if (!efforts.length) continue;
    seen.add(model.slug);
    models.push({
      id: model.slug,
      name:
        typeof model.display_name === "string"
          ? model.display_name.slice(0, 120)
          : model.slug,
      description:
        typeof model.description === "string"
          ? model.description.slice(0, 300)
          : "",
      efforts,
    });
  }
  const timestamp =
    typeof value.fetched_at === "string" ? Date.parse(value.fetched_at) : NaN;
  return {
    source: "codex-cache",
    fetchedAt: Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : null,
    models,
  };
}

export async function readModelCatalog(
  root = process.env.CODEX_HOME || join(homedir(), ".codex"),
) {
  let file;
  try {
    file = await open(
      join(root, "models_cache.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await file.stat();
    const limit = 2 * 1024 * 1024;
    if (!stat.isFile() || stat.size > limit) throw Error("invalid");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw Error("invalid");
    return parseModelCatalog(
      JSON.parse(buffer.subarray(0, size).toString("utf8")),
    );
  } catch {
    throw Error("model_catalog_unavailable");
  } finally {
    await file?.close();
  }
}
