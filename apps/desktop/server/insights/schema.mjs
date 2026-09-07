export const INSIGHT_VERSION = "insights-v1";

const LIMITS = {
  id: 80,
  category: 80,
  title: 160,
  summary: 1200,
  interpretation: 1600,
  limitations: 1200,
  attemptKey: 200,
  observation: 1200,
  sourceId: 200,
  abstentionReason: 1200,
};

const boundedString = (maximum, minimum = 1) => ({
  type: "string",
  minLength: minimum,
  maxLength: maximum,
});

const sideSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptKey", "observation", "sourceIds"],
  properties: {
    attemptKey: boundedString(LIMITS.attemptKey),
    observation: boundedString(LIMITS.observation),
    sourceIds: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: boundedString(LIMITS.sourceId),
    },
  },
};

const findingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "category",
    "title",
    "summary",
    "interpretation",
    "limitations",
    "sides",
  ],
  properties: {
    id: boundedString(LIMITS.id),
    category: boundedString(LIMITS.category),
    title: boundedString(LIMITS.title),
    summary: boundedString(LIMITS.summary),
    interpretation: boundedString(LIMITS.interpretation),
    limitations: boundedString(LIMITS.limitations),
    sides: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: sideSchema,
    },
  },
};

export const insightOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "abstentionReason"],
  properties: {
    findings: {
      type: "array",
      maxItems: 3,
      items: findingSchema,
    },
    abstentionReason: boundedString(LIMITS.abstentionReason, 0),
  },
};

const plainObject = (value) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

function exactKeys(value, required, context) {
  if (!plainObject(value)) throw new Error(`${context} must be an object`);
  const allowed = new Set(required);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`${context} has unknown property ${unknown[0]}`);
  const missing = required.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missing.length)
    throw new Error(`${context} is missing required property ${missing[0]}`);
}

function boundedText(value, name, maximum, allowEmpty = false) {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  if ((!allowEmpty && !value.trim()) || value.length > maximum)
    throw new Error(`${name} violates its text length bound`);
  return value;
}

function validateBundle(bundle) {
  if (!plainObject(bundle) || bundle.eligible !== true)
    throw new Error("An eligible insight bundle is required");
  if (!Array.isArray(bundle.attempts) || bundle.attempts.length !== 2)
    throw new Error("The insight bundle must contain two attempts");
  const attemptKeys = bundle.attempts.map((attempt) => attempt?.key);
  if (
    attemptKeys.some((key) => typeof key !== "string" || !key) ||
    new Set(attemptKeys).size !== 2
  )
    throw new Error("The insight bundle has invalid attempt identities");
  if (!Array.isArray(bundle.sources))
    throw new Error("The insight bundle has no source index");
  const sourceIds = bundle.sources.map((source) => source?.id);
  if (
    sourceIds.some((id) => typeof id !== "string" || !id) ||
    new Set(sourceIds).size !== sourceIds.length ||
    bundle.sources.some((source) => !attemptKeys.includes(source?.attemptKey))
  )
    throw new Error("The insight bundle has invalid source identities");
}

export function validateInsightOutput(bundle, output) {
  validateBundle(bundle);
  exactKeys(output, ["findings", "abstentionReason"], "Insight output");
  if (!Array.isArray(output.findings))
    throw new Error("findings must be an array");
  if (output.findings.length > 3)
    throw new Error("A maximum of three findings is allowed");
  const abstentionReason = boundedText(
    output.abstentionReason,
    "abstentionReason",
    LIMITS.abstentionReason,
    true,
  );
  if (output.findings.length === 0 && !abstentionReason.trim())
    throw new Error("Zero findings requires an abstention reason");

  const findingIds = output.findings.map((finding) => finding?.id);
  if (new Set(findingIds).size !== findingIds.length)
    throw new Error("Duplicate finding IDs are not allowed");
  const attempts = new Map(
    bundle.attempts.map((attempt) => [attempt.key, attempt]),
  );
  const sources = new Map(bundle.sources.map((source) => [source.id, source]));
  const projected = output.findings.map((finding, findingIndex) => {
    exactKeys(
      finding,
      [
        "id",
        "category",
        "title",
        "summary",
        "interpretation",
        "limitations",
        "sides",
      ],
      `Finding ${findingIndex + 1}`,
    );
    const common = {
      id: boundedText(finding.id, "finding id", LIMITS.id),
      category: boundedText(finding.category, "category", LIMITS.category),
      title: boundedText(finding.title, "title", LIMITS.title),
      summary: boundedText(finding.summary, "summary", LIMITS.summary),
      interpretation: boundedText(
        finding.interpretation,
        "interpretation",
        LIMITS.interpretation,
      ),
      limitations: boundedText(
        finding.limitations,
        "limitations",
        LIMITS.limitations,
      ),
    };
    if (!Array.isArray(finding.sides) || finding.sides.length !== 2)
      throw new Error("Each finding must have exactly two sides");
    const sideKeys = finding.sides.map((side) => side?.attemptKey);
    if (new Set(sideKeys).size !== 2)
      throw new Error("Finding sides must use distinct attempts");
    if (
      sideKeys.some((key) => !attempts.has(key)) ||
      bundle.attempts.some((attempt) => !sideKeys.includes(attempt.key))
    )
      throw new Error("Finding side references a foreign attempt");
    const inputSides = new Map(
      finding.sides.map((side, sideIndex) => {
        exactKeys(
          side,
          ["attemptKey", "observation", "sourceIds"],
          `Finding ${findingIndex + 1} side ${sideIndex + 1}`,
        );
        const attemptKey = boundedText(
          side.attemptKey,
          "attemptKey",
          LIMITS.attemptKey,
        );
        const observation = boundedText(
          side.observation,
          "observation",
          LIMITS.observation,
        );
        if (
          !Array.isArray(side.sourceIds) ||
          side.sourceIds.length < 1 ||
          side.sourceIds.length > 12
        )
          throw new Error("Each side requires one to twelve source IDs");
        if (new Set(side.sourceIds).size !== side.sourceIds.length)
          throw new Error("Duplicate source IDs are not allowed within a side");
        const resolved = side.sourceIds.map((sourceId) => {
          boundedText(sourceId, "source ID", LIMITS.sourceId);
          const source = sources.get(sourceId);
          if (!source)
            throw new Error(`Finding references foreign source ${sourceId}`);
          if (source.attemptKey !== attemptKey)
            throw new Error(
              "Finding source is associated with another attempt",
            );
          return { ...source };
        });
        return [attemptKey, { observation, sources: resolved }];
      }),
    );
    return {
      ...common,
      sides: bundle.attempts.map((attempt) => {
        const side = inputSides.get(attempt.key);
        return {
          attemptKey: attempt.key,
          model: attempt.model,
          reasoningEffort: attempt.reasoningEffort,
          runId: attempt.runId,
          observation: side.observation,
          sources: side.sources,
        };
      }),
    };
  });
  return { findings: projected, abstentionReason };
}
