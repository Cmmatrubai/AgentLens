import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { readComparison } from "../comparison-reader.mjs";
import { privateRead, privateWrite, privateRemove } from "./private-files.mjs";
import { parseComparisonBundle } from "./import-pair.mjs";
import { createInsightService } from "./service.mjs";
import { DEFAULT_BASE_URL } from "./endpoint.mjs";
export const prototypeRoot = fileURLToPath(new URL("../../", import.meta.url));
export const insightRoot = join(prototypeRoot, ".local/insight-engine");
export async function readActiveComparison() {
  try {
    const imported = await privateRead(insightRoot, "selected-pair.json");
    if (imported)
      return {
        ok: true,
        comparison: parseComparisonBundle(JSON.stringify(imported)),
      };
    const result = await readComparison();
    if (!result.ok) return result;
    return {
      ok: true,
      comparison: {
        ...result.comparison,
        taskPrompt: await readFile(
          join(prototypeRoot, "experiments/C01/prompt.md"),
          "utf8",
        ),
      },
    };
  } catch {
    return { ok: false, error: "comparison_unavailable" };
  }
}
export async function selectComparison(text) {
  const comparison = parseComparisonBundle(text);
  await privateWrite(insightRoot, "selected-pair.json", comparison);
  return { ok: true };
}
export async function useOriginalComparison() {
  await privateRemove(insightRoot, "selected-pair.json");
  return { ok: true };
}
export function createRuntime(credentialStore) {
  return createInsightService({
    root: insightRoot,
    readComparison: readActiveComparison,
    credentialStore: credentialStore ?? {
      has: async (baseUrl) => {
        const saved = await privateRead(insightRoot, "credential.json");
        return !!saved && (saved.baseUrl ?? DEFAULT_BASE_URL) === baseUrl;
      },
      get: async () => null,
    },
    desktopRequired: !credentialStore,
  });
}
let browserRuntime;
export function readBrowserInsights() {
  browserRuntime ??= createRuntime();
  return browserRuntime.read();
}
