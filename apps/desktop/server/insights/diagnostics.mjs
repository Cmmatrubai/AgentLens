const finishReasons = new Set([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "function_call",
]);
const statuses = new Set([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "queued",
  "in_progress",
]);
const counts = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "answerCharacters",
];

export function sanitizeDiagnostics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  if (finishReasons.has(value.finishReason))
    result.finishReason = value.finishReason;
  if (statuses.has(value.status)) result.status = value.status;
  for (const key of counts) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0)
      result[key] = value[key];
  }
  return Object.keys(result).length ? result : null;
}
