import { createHash } from "node:crypto";
import { parse } from "@babel/parser";

export const LOCAL_SUPPORT_POLICY_VERSION = "import-facts-v1";
const hash = (text) => createHash("sha256").update(text).digest("hex");

// Only a complete new regular file can be reconstructed without the base tree.
// Modified-file hunks, search output and selected excerpts are not whole source.
function addedFile(source) {
  if (
    source.kind !== "file" ||
    source.provenance !== "Final Git diff" ||
    source.truncated !== false ||
    !/\.(?:[cm]?[jt]s|[jt]sx)$/.test(source.path ?? "") ||
    typeof source.excerpt !== "string" ||
    hash(source.excerpt) !== source.sha256
  )
    return null;
  const lines = source.excerpt.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const path = source.path;
  if (
    lines[0] !== `diff --git a/${path} b/${path}` ||
    !/^new file mode 100(?:644|755)$/.test(lines[1] ?? "")
  )
    return null;
  let cursor = 2;
  if (/^index 0+\.\.[a-f0-9]+$/.test(lines[cursor] ?? "")) cursor++;
  if (
    lines[cursor++] !== "--- /dev/null" ||
    lines[cursor++] !== `+++ b/${path}`
  )
    return null;
  const hunk = /^@@ -0,0 \+1(?:,(\d+))? @@$/.exec(lines[cursor++] ?? "");
  if (!hunk) return null;
  const count = hunk[1] === undefined ? 1 : Number(hunk[1]);
  const body = lines.slice(cursor);
  if (body.at(-1) === "\\ No newline at end of file") body.pop();
  if (body.length !== count || !body.every((line) => line.startsWith("+")))
    return null;
  return body.map((line) => line.slice(1)).join("\n");
}

export function extractImportFacts(bundle) {
  const facts = [],
    coverage = [];
  for (const source of bundle.sources) {
    const code = addedFile(source);
    const base = {
      sourceId: source.id,
      attemptKey: source.attemptKey,
      sourceSha256: source.sha256,
      path: source.path,
    };
    if (code === null) {
      coverage.push({
        ...base,
        status: "unknown",
        reason: "A complete supported source file is unavailable.",
      });
      continue;
    }
    try {
      const isTS = /\.(?:[cm]?ts|tsx)$/.test(source.path);
      const tree = parse(code, {
        sourceType: "module",
        plugins: [
          ...(isTS ? ["typescript"] : []),
          ...(/\.[jt]sx$/.test(source.path) ? ["jsx"] : []),
        ],
      });
      for (const node of tree.program.body) {
        if (node.type !== "ImportDeclaration") continue;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const fact = {
            ...base,
            kind: "named_import",
            module: node.source.value,
            imported: specifier.imported.name ?? specifier.imported.value,
            local: specifier.local.name,
            importKind:
              node.importKind === "type" || specifier.importKind === "type"
                ? "type"
                : "value",
            line: node.loc.start.line,
            declaration: code.slice(node.start, node.end),
          };
          facts.push({ id: `fact_${hash(JSON.stringify(fact))}`, ...fact });
        }
      }
      coverage.push({
        ...base,
        status: "parsed",
        reason: "Complete added-file source parsed; presence facts only.",
      });
    } catch {
      coverage.push({
        ...base,
        status: "unknown",
        reason: "The saved source could not be parsed.",
      });
    }
  }
  return { version: LOCAL_SUPPORT_POLICY_VERSION, facts, coverage };
}

// This is deliberately a small positive grammar, not a natural-language truth
// detector. Other import wording stays unresolved; no absence claims are made.
function requestedImports(text) {
  const match =
    /^(.+?) imports (?:both )?(.+?) from ["'`]([^"'`]+)["'`] into `?([^`\s]+\.(?:[cm]?[jt]s|[jt]sx))`?\.$/.exec(
      text,
    );
  if (!match) return null;
  const names = match[2]
    .replace(/`/g, "")
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/);
  if (
    !names.length ||
    names.some((name) => !/^[$A-Z_a-z][$\w]*$/.test(name)) ||
    new Set(names).size !== names.length
  )
    return null;
  return { actor: match[1], names, module: match[3], path: match[4] };
}

export function applyLocalSupportPolicy(bundle, draft, checked) {
  const ledger = extractImportFacts(bundle);
  return {
    policyVersion: LOCAL_SUPPORT_POLICY_VERSION,
    importFacts: ledger,
    findings: checked.findings.map((finding) => {
      const original = draft.findings.find(
        (item) => item.id === finding.findingId,
      );
      const cursors = new Map();
      const claims = finding.claims.map((originalClaim) => {
        let claim = originalClaim;
        const side = /^sides\[(\d+)\]\.observation$/.exec(claim.field);
        const attemptKey = side
          ? original?.sides[Number(side[1])]?.attemptKey
          : null;
        if (attemptKey) claim = { ...claim, attemptKey };
        const unitText = side
          ? original?.sides[Number(side[1])]?.observation
          : original?.[claim.field];
        const start =
          typeof unitText === "string"
            ? unitText.indexOf(claim.text, cursors.get(claim.unitId) ?? 0)
            : -1;
        const end = start + claim.text.length;
        cursors.set(claim.unitId, end);
        // Match spans in the original unit: provider-selected claim boundaries
        // may split the word itself, even though coverage validation succeeded.
        const touchesImport =
          start >= 0 &&
          [...unitText.matchAll(/\bimport(?:s|ed|ing)?\b/gi)].some(
            (match) =>
              match.index < end && match.index + match[0].length > start,
          );
        if (!touchesImport && !/\bimport(?:s|ed|ing)?\b/i.test(claim.text))
          return claim;
        const request = requestedImports(claim.text);

        const attempt = bundle.attempts.find((item) => item.key === attemptKey);
        const actorMatches =
          request &&
          attempt &&
          [attempt.key, attempt.model].some(
            (name) =>
              typeof name === "string" &&
              name.toLowerCase() === request.actor.toLowerCase(),
          );
        const cited = new Set(
          claim.passages
            .filter((p) => p.attemptKey === attemptKey && p.kind === "file")
            .map((p) => p.sourceId),
        );
        const matches = actorMatches
          ? ledger.facts.filter(
              (fact) =>
                fact.attemptKey === attemptKey &&
                cited.has(fact.sourceId) &&
                fact.path === request.path &&
                fact.module === request.module &&
                fact.importKind === "value" &&
                fact.local === fact.imported &&
                request.names.includes(fact.imported),
            )
          : [];
        // Every requested binding must be established in the same saved file.
        const sources = [...new Set(matches.map((fact) => fact.sourceId))];
        const matchedSource = sources.find((id) =>
          request.names.every((name) =>
            matches.some(
              (fact) => fact.sourceId === id && fact.imported === name,
            ),
          ),
        );
        const matched = matchedSource !== undefined;
        const reason = matched
          ? "Named imports match the parsed complete added file. This does not establish runtime behavior or overall quality."
          : "This import relationship needs inspection: the claim could not be matched to named imports in a complete saved file for this attempt. Selected logs and partial diffs do not establish the relationship.";
        return {
          ...claim,
          providerAssessment: { verdict: claim.verdict, reason: claim.reason },
          localCheck: {
            version: LOCAL_SUPPORT_POLICY_VERSION,
            kind: "named_import",
            status: matched ? "matched" : "unknown",
            reason,
            factIds: matched
              ? matches
                  .filter((fact) => fact.sourceId === matchedSource)
                  .map((fact) => fact.id)
              : [],
          },
          verdict:
            !matched && claim.verdict === "supported"
              ? "needs_review"
              : claim.verdict,
          reason:
            !matched && claim.verdict === "supported" ? reason : claim.reason,
        };
      });
      const flagged = claims.filter((claim) => claim.verdict !== "supported");
      return {
        ...finding,
        claims,
        verdict: flagged.some((claim) => claim.verdict === "unsupported")
          ? "unsupported"
          : flagged.length
            ? "needs_review"
            : "supported",
        reason: flagged.length
          ? `${flagged.length} of ${claims.length} claims need review.`
          : finding.reason,
        issues: flagged.map((claim) => ({
          claim: claim.text,
          explanation: claim.reason,
          sourceIds: [
            ...new Set(
              claim.passages.map((p) => p.sourceId).filter((id) => id !== null),
            ),
          ],
          passages: claim.passages,
        })),
      };
    }),
  };
}
