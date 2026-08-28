import { redactText, type RedactionContext, type RedactionResult } from "./redaction.js";
import {
  normalizedPath,
  shouldExcludePath,
  type ExclusionDecision,
  type SensitivePathPolicy
} from "./sensitivePathPolicy.js";

export {
  shouldExcludePath,
  type ExclusionDecision,
  type SensitivePathPolicy
} from "./sensitivePathPolicy.js";

export interface GitDiffRedactionContext extends RedactionContext {
  readonly sensitivePathPolicy?: SensitivePathPolicy;
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
