import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { privateRead, privateWrite } from "./private-files.mjs";
import {
  parseComparisonBundle,
  parseEvaluatedComparisonBundle,
} from "./import-pair.mjs";
import { createInsightService } from "./service.mjs";
import { DEFAULT_BASE_URL } from "./endpoint.mjs";
import { parseSelectedComparison } from "../live/selection.mjs";
export const prototypeRoot = fileURLToPath(new URL("../../", import.meta.url));
export const insightRoot = join(prototypeRoot, ".local/insight-engine");
export async function readSelectedComparison(root) {
  try {
    const selected = await privateRead(root, "selected-pair.json");
    if (!selected) return { ok: false, error: "comparison_not_selected" };
    return { ok: true, comparison: parseSelectedComparison(selected) };
  } catch {
    return { ok: false, error: "comparison_unavailable" };
  }
}
export async function readActiveComparison() {
  return readSelectedComparison(insightRoot);
}
export async function selectComparison(
  text,
  { requireChecks = false, root = insightRoot } = {},
) {
  const comparison = requireChecks
    ? parseEvaluatedComparisonBundle(text)
    : parseComparisonBundle(text);
  await privateWrite(root, "selected-pair.json", comparison);
  return { ok: true };
}
export async function selectRecordedComparison(comparison) {
  const selected = { source: "desktop-recording", comparison };
  parseSelectedComparison(selected);
  await privateWrite(insightRoot, "selected-pair.json", selected);
  return { ok: true };
}
export async function useOriginalComparison() {
  // Older renderers must not clear personal evidence to reveal a fallback case.
  return { ok: false, error: "example_separate" };
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
