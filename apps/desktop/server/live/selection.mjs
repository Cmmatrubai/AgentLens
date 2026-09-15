import { parseComparisonBundle } from "../insights/import-pair.mjs";

export function parseSelectedComparison(value) {
  // Only our outer storage envelope has recording authority. Imported bundles
  // can retain unknown fields, including a forged source/comparison pair.
  const recorded =
    value?.source === "desktop-recording" &&
    value.imported !== true &&
    !Object.hasOwn(value, "schemaVersion");
  const original = recorded ? value.comparison : value;
  const validated = parseComparisonBundle(JSON.stringify(original));
  if (!recorded) return { ...validated, desktopRecorded: false };
  return {
    ...validated,
    imported: false,
    desktopRecorded: true,
    attempts: validated.attempts.map((a, index) => ({
      ...a,
      controlNotes: original.attempts[index].controlNotes ?? [],
      coverageLimits: original.attempts[index].coverageLimits ?? [],
    })),
  };
}
