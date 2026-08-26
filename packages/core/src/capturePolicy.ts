export type CapturePolicy = "standard" | "metadata-only" | "strict";

export const capturePolicies = ["standard", "metadata-only", "strict"] as const;

export function storesContent(policy: CapturePolicy): policy is "standard" {
  return policy === "standard";
}
