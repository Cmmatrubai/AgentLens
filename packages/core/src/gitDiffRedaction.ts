import type { CapturePolicy } from "./capturePolicy.js";
import { redactText, type RedactionContext, type RedactionResult } from "./redaction.js";

export interface ExclusionDecision {
  exclude: boolean;
  reason?: string;
}

export interface SensitivePathPolicy {
  readonly capture: CapturePolicy;
  readonly denyGlobs?: readonly string[];
}

type PathPolicy = CapturePolicy | SensitivePathPolicy;

export interface GitDiffRedactionContext extends RedactionContext {
  readonly sensitivePathPolicy?: SensitivePathPolicy;
}

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

function parseQuotedTokens(line: string): string[] {
  const matches = line.match(/"(?:\\.|[^"\\])*"|\S+/g) ?? [];
  return matches.map((token) => normalizedPath(token).replace(/^[ab]\//, ""));
}

function pathFromHeader(line: string): string | undefined {
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    const value = line.slice(4).split("\t", 1)[0];
    if (value === undefined || value === "/dev/null") return undefined;
    return normalizedPath(value).replace(/^[ab]\//, "");
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

export function redactGitDiff(input: string, context: GitDiffRedactionContext): RedactionResult {
  if (context.policy !== "standard") return redactText(input, context);

  const pathPolicy = context.sensitivePathPolicy ?? context.policy;
  if (typeof pathPolicy !== "string" && pathPolicy.capture !== context.policy) {
    throw new Error("Sensitive path policy capture mode must match the redaction context.");
  }

  const blocks = input.split(/(?=^diff --git )/m);
  const retained: string[] = [];
  for (const block of blocks) {
    if (!block.startsWith("diff --git ")) {
      retained.push(block);
      continue;
    }

    let exclusion: ExclusionDecision | undefined;
    for (const path of pathsInBlock(block)) {
      const decision = shouldExcludePath(path, pathPolicy);
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
