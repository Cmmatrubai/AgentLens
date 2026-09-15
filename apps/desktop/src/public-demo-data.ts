import type { ComparisonResponse } from "./comparison-types";

export const publicDestinations = [
  {
    id: "case",
    label: "Case study",
    description: "The task, result and model differences",
  },
  {
    id: "evidence",
    label: "Evidence",
    description: "Recorded work and independent checks",
  },
  {
    id: "about",
    label: "About AgentLens",
    description: "How the comparison is built",
  },
] as const;
export type PublicDestination = (typeof publicDestinations)[number]["id"];
export function publicDestination(hash: string): PublicDestination {
  return publicDestinations.find((d) => hash === `#/${d.id}`)?.id ?? "case";
}

// Verify the snapshot against its bundled manifest before rendering. This detects
// stale/mixed deployments, not a malicious host replacing both files.
export async function loadPublicComparison(
  base: string,
  transport: (url: string) => Promise<Response> = fetch,
): Promise<ComparisonResponse> {
  const root = `${base.endsWith("/") ? base : base + "/"}demo/`;
  const metadata = await transport(root + "manifest.json");
  if (!metadata.ok) throw Error("Public case unavailable");
  const manifest = await metadata.json();
  if (
    manifest.schemaVersion !== 1 ||
    manifest.exportVersion !== "public-demo-v1" ||
    manifest.comparisonFile !== "comparison.json" ||
    !/^[a-f0-9]{64}$/.test(manifest.comparisonSha256) ||
    !Number.isSafeInteger(manifest.comparisonBytes) ||
    manifest.comparisonBytes <= 0 ||
    manifest.comparisonBytes > 800_000
  )
    throw Error("Invalid public manifest");
  const response = await transport(root + "comparison.json");
  if (!response.ok) throw Error("Public case unavailable");
  const bytes = await response.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (
    bytes.byteLength !== manifest.comparisonBytes ||
    hash !== manifest.comparisonSha256
  )
    throw Error("Public case integrity mismatch");
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !result.ok ||
    result.comparison?.schemaVersion !== 1 ||
    result.comparison.attempts?.length !== 2 ||
    result.comparison.review?.state !== "available"
  )
    throw Error("Invalid public comparison");
  return result;
}
