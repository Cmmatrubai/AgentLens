import type { CapturePolicy } from "./capturePolicy.js";

export interface ExclusionDecision {
  exclude: boolean;
  reason?: string;
}

export interface SensitivePathPolicy {
  readonly capture: CapturePolicy;
  readonly denyGlobs?: readonly string[];
}

export type PathPolicy = CapturePolicy | SensitivePathPolicy;

const pathRules: readonly { reason: string; matches: (path: string, segments: string[]) => boolean }[] = [
  {
    reason: "sensitive-path.env",
    matches: (_path, segments) => segments.some((segment) => /^\.env(?:\..*)?$/i.test(segment))
  },
  {
    reason: "sensitive-path.key",
    matches: (_path, segments) =>
      segments.some((segment) => /\.(?:pem|key)$/i.test(segment) || /^id_rsa/i.test(segment))
  },
  {
    reason: "sensitive-path.aws",
    matches: (_path, segments) => segments.some((segment) => segment.toLowerCase() === ".aws")
  },
  {
    reason: "sensitive-path.ssh",
    matches: (_path, segments) => segments.some((segment) => segment.toLowerCase() === ".ssh")
  },
  {
    reason: "sensitive-path.gnupg",
    matches: (_path, segments) => segments.some((segment) => segment.toLowerCase() === ".gnupg")
  },
  {
    reason: "sensitive-path.credentials",
    matches: (_path, segments) => segments.some((segment) => /^credentials(?:[._-].*)?$/i.test(segment))
  },
  {
    reason: "sensitive-path.secrets",
    matches: (_path, segments) => segments.some((segment) => /^secrets?(?:[._-].*)?$/i.test(segment))
  }
];

export function normalizedPath(path: string): string {
  let normalized = path.trim();
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    try {
      normalized = JSON.parse(normalized) as string;
    } catch {
      normalized = normalized.slice(1, -1);
    }
  }
  normalized = normalized.replaceAll("\\", "/");
  normalized = normalized.replace(/^\.\//, "");
  return normalized;
}

function globMatches(path: string, glob: string): boolean {
  let pattern = "";
  for (let index = 0; index < glob.length; ) {
    if (glob.startsWith("**/", index)) {
      pattern += "(?:.*/)?";
      index += 3;
    } else if (glob.startsWith("**", index)) {
      pattern += ".*";
      index += 2;
    } else if (glob[index] === "*") {
      pattern += "[^/]*";
      index += 1;
    } else if (glob[index] === "?") {
      pattern += "[^/]";
      index += 1;
    } else {
      const character = glob[index];
      if (character === undefined) break;
      pattern += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
      index += 1;
    }
  }
  return new RegExp(`^${pattern}$`, "i").test(path);
}

export function shouldExcludePath(path: string, policy: PathPolicy): ExclusionDecision {
  const capture = typeof policy === "string" ? policy : policy.capture;
  if (capture !== "standard") return { exclude: true, reason: "capture-policy.content-omitted" };

  const candidate = normalizedPath(path);
  const segments = candidate.split("/").filter(Boolean);
  for (const rule of pathRules) {
    if (rule.matches(candidate, segments)) return { exclude: true, reason: rule.reason };
  }

  const denyGlobs = typeof policy === "string" ? [] : (policy.denyGlobs ?? []);
  if (denyGlobs.some((glob) => globMatches(candidate, glob))) {
    return { exclude: true, reason: "sensitive-path.configured" };
  }

  return { exclude: false };
}
