import { validateInsightOutput } from "./schema.mjs";

export const SUPPORT_VERSION = "support-v5";
const verdicts = ["supported", "needs_review", "unsupported"];
const textSchema = (maximum) => ({ type: "string", minLength: 1, maxLength: maximum });

export const supportOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assessments"],
  properties: {
    assessments: {
      type: "array",
      maxItems: 21,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["unitId", "claims"],
        properties: {
          unitId: textSchema(80),
          claims: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "verdict", "reason", "passages"],
              properties: {
                text: textSchema(1600),
                verdict: { type: "string", enum: verdicts },
                reason: textSchema(500),
                passages: {
                  type: "array",
                  minItems: 1,
                  maxItems: 6,
                  items: textSchema(80),
                },
              },
            },
          },
        },
      },
    },
  },
};

export function buildSupportEvidence(bundle) {
  const sources = bundle.sources.map((source, index) => {
    const metadata = {
      provenance: source.provenance,
      path: source.path ?? null,
      identity: source.identity ?? null,
      command: source.command ?? null,
      exitCode: source.exitCode ?? null,
      truncated: source.truncated ?? false,
      sha256: source.sha256 ?? null,
      fromLine: source.fromLine ?? null,
      toLine: source.toLine ?? null,
    };
    return {
      ref: `S${index + 1}`,
      sourceId: source.id,
      attemptKey: source.attemptKey,
      kind: source.kind,
      label: source.label,
      ...metadata,
      text: source.excerpt,
      metadataText: JSON.stringify(metadata, null, 2),
    };
  });
  const attempts = bundle.attempts.map((attempt, index) => ({
    ref: `A${index + 1}`,
    sourceId: null,
    attemptKey: attempt.key,
    kind: "attempt_facts",
    label: `Attempt facts · ${attempt.model || attempt.key}`,
    provenance: "Saved comparison facts",
    text: JSON.stringify(attempt, null, 2),
  }));
  return [...sources, ...attempts];
}

export function supportEvidenceLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

// Partition only the selected text. Long lines are split by character offset,
// preserving every character; IDs are local to the consent-bound evidence hash.
function passageChunks(text, maxCharacters, maxLines) {
  const result = [];
  let chunk = "", count = 0;
  for (const line of supportEvidenceLines(text)) {
    if (chunk && (chunk.length + line.length > maxCharacters || count >= maxLines)) {
      result.push(chunk); chunk = ""; count = 0;
    }
    let rest = line;
    while (rest.length > maxCharacters) {
      result.push(rest.slice(0, maxCharacters)); rest = rest.slice(maxCharacters);
    }
    chunk += rest; count++;
  }
  if (chunk) result.push(chunk);
  return result;
}

export function buildSupportPassages(bundle) {
  const records = [...buildSupportEvidence(bundle), {
    ref: "T1", sourceId: null, attemptKey: "", kind: "task_context",
    label: "Task requirements", text: JSON.stringify(bundle.task, null, 2),
  }];
  return records.flatMap(record => ["text", "metadata"].flatMap(part => {
    const text = part === "text" ? record.text : record.metadataText;
    if (typeof text !== "string") return [];
    const compact = record.sourceId === null || part === "metadata";
    return passageChunks(text, compact ? 6000 : 2400, compact ? Infinity : 24)
      .map((quote, index) => ({
        id: `${record.ref}:${part === "text" ? "t" : "m"}${index + 1}`,
        ref: record.ref, part, sourceId: record.sourceId, attemptKey: record.attemptKey,
        kind: part === "metadata" ? "source_metadata" : record.kind,
        label: part === "metadata" ? `Source details · ${record.label}` : record.label,
        quote,
      }));
  }));
}

export function supportSchemaFor(bundle, draft) {
  const schema = structuredClone(supportOutputSchema);
  const assessment = schema.properties.assessments.items.properties;
  const units = buildSupportUnits(draft).map(unit => unit.id);
  if (units.length) assessment.unitId.enum = units;
  assessment.claims.items.properties.passages.items.enum = buildSupportPassages(bundle)
    .filter(passage => passage.quote.trim()).map(passage => passage.id);
  return schema;
}

export function buildSupportUnits(draft) {
  return draft.findings.flatMap((finding, findingIndex) => {
    const sourceIds = [...new Set(finding.sides.flatMap((side) => side.sourceIds))];
    const common = ["category", "title", "summary", "interpretation", "limitations"]
      .map((field) => ({
        id: `f${findingIndex}:${field}`,
        findingId: finding.id,
        field,
        text: finding[field],
        sourceIds: [...sourceIds],
      }));
    const observations = finding.sides.map((side, sideIndex) => ({
      id: `f${findingIndex}:observation:${sideIndex}`,
      findingId: finding.id,
      field: `sides[${sideIndex}].observation`,
      text: side.observation,
      sourceIds: [...sourceIds],
    }));
    return [...common, ...observations];
  });
}

function exactKeys(value, required, context) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) throw Error(`${context} must be an object`);
  if (
    Object.keys(value).some((key) => !required.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) throw Error(`${context} has invalid properties`);
}

function boundedText(value, maximum, context) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw Error(`${context} violates its text length bound`);
  return value;
}

export function validateSupportOutput(bundle, draftOutput, output) {
  validateInsightOutput(bundle, draftOutput);
  const units = buildSupportUnits(draftOutput);
  exactKeys(output, ["assessments"], "Support output");
  if (!Array.isArray(output.assessments) || output.assessments.length !== units.length)
    throw Error("Support output must review every text unit exactly once");
  const unitIndex = new Map(units.map((unit) => [unit.id, unit]));
  const evidence = new Map(buildSupportPassages(bundle).map((passage) => [passage.id, passage]));
  const checked = new Map();
  for (const assessment of output.assessments) {
    exactKeys(assessment, ["unitId", "claims"], "Support assessment");
    const unitId = boundedText(assessment.unitId, 80, "Unit ID");
    if (!unitIndex.has(unitId) || checked.has(unitId))
      throw Error("Support output has a foreign or duplicate unit");
    if (!Array.isArray(assessment.claims) || assessment.claims.length < 1 || assessment.claims.length > 6)
      throw Error("Each assessment requires one to six claims");
    const unit = unitIndex.get(unitId);
    let cursor = 0;
    const claims = assessment.claims.map((claim) => {
      exactKeys(claim, ["text", "verdict", "reason", "passages"], "Support claim");
      const text = boundedText(claim.text, 1600, "Claim text");
      const start = unit.text.indexOf(text, cursor);
      if (start < 0 || /\S/u.test(unit.text.slice(cursor, start)))
        throw Error("Claims must cover their unit in order without overlap or non-whitespace gaps");
      cursor = start + text.length;
      if (!verdicts.includes(claim.verdict)) throw Error("Unknown support verdict");
      const reason = boundedText(claim.reason, 500, "Support reason");
      if (!Array.isArray(claim.passages) || claim.passages.length < 1 || claim.passages.length > 6)
        throw Error("Each claim requires one to six passages");
      const seen = new Set();
      const passages = claim.passages.map((passageId) => {
        boundedText(passageId, 80, "Passage ID");
        const passage = evidence.get(passageId);
        if (!passage || !passage.quote.trim()) throw Error("Unknown or empty selected passage");
        if (seen.has(passageId)) throw Error("Duplicate support passage");
        seen.add(passageId);
        const { sourceId, attemptKey, kind, label, quote } = passage;
        return { sourceId, attemptKey, kind, label, quote };
      });
      return { unitId, field: unit.field, text, verdict: claim.verdict, reason, passages };
    });
    if (/\S/u.test(unit.text.slice(cursor)))
      throw Error("Claims must cover all non-whitespace unit text");
    checked.set(unitId, claims);
  }
  return {
    findings: draftOutput.findings.map((finding) => {
      const findingUnits = units.filter((unit) => unit.findingId === finding.id);
      const claims = findingUnits.flatMap((unit) => checked.get(unit.id));
      const flagged = claims.filter((claim) => claim.verdict !== "supported");
      const verdict = flagged.some((claim) => claim.verdict === "unsupported")
        ? "unsupported" : flagged.length ? "needs_review" : "supported";
      return {
        findingId: finding.id,
        verdict,
        reason: flagged.length
          ? `${flagged.length} of ${claims.length} claims need review.`
          : `AI reviewer found support for all ${claims.length} claims.`,
        claims,
        issues: flagged.map((claim) => ({
          claim: claim.text,
          explanation: claim.reason,
          sourceIds: [...new Set(claim.passages.map((passage) => passage.sourceId).filter((id) => id !== null))],
          passages: claim.passages.map((passage) => ({ ...passage })),
        })),
      };
    }),
  };
}
