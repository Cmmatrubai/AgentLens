import type { CapturePolicy } from "./capturePolicy.js";
import { redactText, type RedactionContext, type RedactionResult } from "./redaction.js";

export interface ExclusionDecision {
  exclude: boolean;
  reason?: string;
}

export interface SensitivePathPolicy {
  capture: CapturePolicy;
  denyGlobs?: readonly string[];
}

type PathPolicy = CapturePolicy | SensitivePathPolicy;

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

function normalizedPath(path: string): string {
  let normalized = path.trim();
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    try {
      normalized = JSON.parse(normalized) as string;
    } catch {
      normalized = normalized.slice(1, -1);
    }
  }
  normalized = normalized.replaceAll("\\", "/");
  normalized = normalized.replace(/^\.\//, "").replace(/^[ab]\//, "");
  return normalized;
}

function globMatches(path: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", "[^/]");
  return new RegExp(`^${escaped}$`, "i").test(path);
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

function parseQuotedTokens(line: string): string[] {
  const matches = line.match(/"(?:\\.|[^"\\])*"|\S+/g) ?? [];
  return matches.map((token) => normalizedPath(token));
}

function pathFromHeader(line: string): string | undefined {
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    const value = line.slice(4).split("\t", 1)[0];
    return value === "/dev/null" ? undefined : value;
  }

  const operation = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
  return operation?.[1];
}

function pathsInBlock(block: string): string[] {
  const lines = block.split("\n");
  const paths: string[] = [];
  const firstLine = lines[0];
  if (firstLine?.startsWith("diff --git ")) {
    paths.push(...parseQuotedTokens(firstLine.slice("diff --git ".length)).slice(0, 2));
  }

  for (const line of lines.slice(1)) {
    const path = pathFromHeader(line);
    if (path) paths.push(path);
  }
  return paths;
}

export function redactGitDiff(input: string, context: RedactionContext): RedactionResult {
  if (context.policy !== "standard") return redactText(input, context);

  const blocks = input.split(/(?=^diff --git )/m);
  const retained: string[] = [];
  for (const block of blocks) {
    if (!block.startsWith("diff --git ")) {
      retained.push(block);
      continue;
    }

    let exclusion: ExclusionDecision | undefined;
    for (const path of pathsInBlock(block)) {
      const decision = shouldExcludePath(path, context.policy);
      if (decision.exclude) {
        exclusion = decision;
        break;
      }
    }

    if (exclusion?.reason) retained.push(`[[EXCLUDED:${exclusion.reason}]]\n`);
    else retained.push(block);
  }

  return redactText(retained.join(""), context);
}
