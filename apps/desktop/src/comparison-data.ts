import { appCapabilities } from "./app-capabilities";
import type { ComparisonResponse } from "./comparison-types";
import { loadPublicComparison } from "./public-demo-data";

export async function readComparisonData(): Promise<ComparisonResponse> {
  if (appCapabilities.publicDemo)
    return loadPublicComparison(import.meta.env.BASE_URL);
  if (window.agentlens) return window.agentlens.readComparison();
  const response = await fetch("/api/comparison", {
    headers: { "X-AgentLens-Read": "1" },
    cache: "no-store",
  });
  if (!response.ok) throw Error("Comparison unavailable");
  return response.json();
}
