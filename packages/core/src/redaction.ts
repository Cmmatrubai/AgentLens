import { createHmac } from "node:crypto";
import type { CapturePolicy } from "./capturePolicy.js";

export type ContentClass =
  | "summary"
  | "label"
  | "prompt"
  | "message"
  | "command"
  | "output"
  | "tool"
  | "git-diff"
  | "native"
  | "stderr"
  | "diagnostic"
  | "path";

export interface RedactionContext {
  policy: CapturePolicy;
  key: Buffer;
  contentClass: ContentClass;
}

export interface JsonRedactionContext extends RedactionContext {
  runId: string;
}

export interface RedactionAudit {
  readonly reason: string;
  readonly count: number;
}

const redactedResultBrand: unique symbol = Symbol("agentlens.redacted-result");
const authenticRedactionResults = new WeakSet<object>();
const MAX_JSON_REDACTION_DEPTH = 100;
const JSON_MAX_DEPTH_REASON = "json-max-depth";
const JSON_MAX_DEPTH_MARKER = `[[REDACTED:${JSON_MAX_DEPTH_REASON}]]`;

export interface RedactionResult {
  readonly [redactedResultBrand]: true;
  readonly text: string;
  readonly audits: readonly RedactionAudit[];
}

export class RedactedBytes {
  readonly #bytes: Buffer;

  private constructor(bytes: Buffer) {
    this.#bytes = Buffer.from(bytes);
    Object.freeze(this);
  }

  static fromText(result: RedactionResult): RedactedBytes {
    if (
      result[redactedResultBrand] !== true ||
      !authenticRedactionResults.has(result) ||
      !Object.isFrozen(result) ||
      !Object.isFrozen(result.audits) ||
      result.audits.some((audit) => !Object.isFrozen(audit))
    ) {
      throw new TypeError("RedactedBytes require an in-memory redaction result.");
    }
    return new RedactedBytes(Buffer.from(result.text, "utf8"));
  }

  get byteLength(): number {
    return this.#bytes.byteLength;
  }

  copy(): Buffer {
    return Buffer.from(this.#bytes);
  }
}

export type ImmutableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ImmutableJsonValue[]
  | { readonly [key: string]: ImmutableJsonValue };

export type RedactedJsonResult =
  | Readonly<{
      readonly storage: "content";
      readonly runId: string;
      readonly redacted: ImmutableJsonValue;
      readonly redactedBytes: RedactedBytes;
      readonly audits: readonly RedactionAudit[];
    }>
  | Readonly<{
      readonly storage: "omitted";
      readonly runId: string;
      readonly reason: "metadata-only" | "strict";
    }>;

function freezeAudits(audits: readonly RedactionAudit[]): readonly RedactionAudit[] {
  return Object.freeze(
    audits.map((audit) => Object.freeze({ reason: audit.reason, count: audit.count }))
  );
}

function createResult(text: string, audits: readonly RedactionAudit[]): RedactionResult {
  const result: RedactionResult = {
    [redactedResultBrand]: true,
    text,
    audits: freezeAudits(audits)
  };
  authenticRedactionResults.add(result);
  return Object.freeze(result);
}

function immutableJsonArray(values: ImmutableJsonValue[]): readonly ImmutableJsonValue[] {
  return Object.freeze(values);
}

function immutableJsonObject(
  values: Record<string, ImmutableJsonValue>
): { readonly [key: string]: ImmutableJsonValue } {
  return Object.freeze(values);
}

function immutableJsonResult(
  runId: string,
  redacted: ImmutableJsonValue,
  redactedBytes: RedactedBytes,
  audits: readonly RedactionAudit[]
): RedactedJsonResult {
  return Object.freeze({
    storage: "content" as const,
    runId,
    redacted,
    redactedBytes,
    audits
  });
}

function omittedJsonResult(
  runId: string,
  reason: "metadata-only" | "strict"
): RedactedJsonResult {
  return Object.freeze({ storage: "omitted" as const, reason, runId });
}

export const fixedMetadataText: Readonly<Record<ContentClass, string>> = {
  summary: "Event summary",
  label: "Run label omitted",
  prompt: "Prompt omitted",
  message: "Agent message event",
  command: "Command event",
  output: "Command output omitted",
  tool: "Tool event",
  "git-diff": "Git diff omitted",
  native: "Native payload omitted",
  stderr: "Recorder diagnostic",
  diagnostic: "Recorder diagnostic",
  path: "Path omitted"
};

function marker(reason: string, value: string, key: Buffer): string {
  const digest = createHmac("sha256", key).update(value, "utf8").digest("hex").slice(0, 32);
  return `[[REDACTED:${reason}:hmac-sha256:${digest}]]`;
}

function strictLabelReason(contentClass: "command" | "path"): string {
  return `strict-${contentClass}-label`;
}

function redactDetectedTokens(
  input: string,
  key: Buffer
): { text: string; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const count = (reason: string): void => {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  };

  let text = input.replace(
    /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi,
    (_match, secret: string) => {
      count("auth-bearer");
      return `Bearer ${marker("auth-bearer", secret, key)}`;
    }
  );

  text = text.replace(
    /\b((?:[A-Za-z0-9]+[_-])*(api[_-]?key|access[_-]?token|password|secret))\s*([:=])\s*([^\s,;]+)/gi,
    (_match, label: string, category: string, separator: string, secret: string) => {
      const reason = `assignment-${category.toLowerCase().replaceAll("_", "-")}`;
      count(reason);
      return `${label}${separator}${marker(reason, secret, key)}`;
    }
  );

  return { text, counts };
}

export function redactText(input: string, context: RedactionContext): RedactionResult {
  if (context.policy === "metadata-only") {
    return createResult(fixedMetadataText[context.contentClass], []);
  }

  if (context.policy === "strict") {
    if (context.contentClass === "command" || context.contentClass === "path") {
      const reason = strictLabelReason(context.contentClass);
      return createResult(marker(reason, input, context.key), [{ reason, count: 1 }]);
    }
    return createResult(fixedMetadataText[context.contentClass], []);
  }

  const redacted = redactDetectedTokens(input, context.key);
  const audits = [...redacted.counts].map(([reason, count]) => ({ reason, count }));
  return createResult(redacted.text, audits);
}

function sensitiveJsonReason(key: string): string | undefined {
  const rules: readonly [RegExp, string][] = [
    [/(?:^|[_-])authorizations?(?:$|[_-])/i, "json-authorization"],
    [/(?:^|[_-])api[_-]?keys?(?:$|[_-])/i, "json-api-key"],
    [/(?:^|[_-])(?:access[_-]?|refresh[_-]?)?tokens?(?:$|[_-])/i, "json-token"],
    [/(?:^|[_-])passwords?(?:$|[_-])/i, "json-password"],
    [/(?:^|[_-])secrets?(?:$|[_-])/i, "json-secret"],
    [/(?:^|[_-])credentials?(?:$|[_-])/i, "json-credential"]
  ];
  return rules.find(([pattern]) => pattern.test(key))?.[1];
}

function stableSecretValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function reachesJsonDepthLimit(value: object, startingDepth: number): boolean {
  const pending: Array<{ value: object; depth: number }> = [{ value, depth: startingDepth }];
  const greatestVisitedDepth = new WeakMap<object, number>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth >= MAX_JSON_REDACTION_DEPTH) return true;
    const visitedDepth = greatestVisitedDepth.get(current.value);
    if (visitedDepth !== undefined && visitedDepth >= current.depth) continue;
    greatestVisitedDepth.set(current.value, current.depth);

    for (const entry of Object.values(current.value)) {
      if (entry !== null && typeof entry === "object") {
        pending.push({ value: entry, depth: current.depth + 1 });
      }
    }
  }

  return false;
}

function redactJsonValue(
  value: unknown,
  key: Buffer,
  audits: Map<string, number>,
  propertyName?: string,
  depth = 0
): ImmutableJsonValue {
  if (depth >= MAX_JSON_REDACTION_DEPTH && value !== null && typeof value === "object") {
    audits.set(JSON_MAX_DEPTH_REASON, (audits.get(JSON_MAX_DEPTH_REASON) ?? 0) + 1);
    return JSON_MAX_DEPTH_MARKER;
  }

  const reason = propertyName ? sensitiveJsonReason(propertyName) : undefined;
  if (reason) {
    if (
      value !== null &&
      typeof value === "object" &&
      reachesJsonDepthLimit(value, depth)
    ) {
      audits.set(JSON_MAX_DEPTH_REASON, (audits.get(JSON_MAX_DEPTH_REASON) ?? 0) + 1);
      return JSON_MAX_DEPTH_MARKER;
    }
    audits.set(reason, (audits.get(reason) ?? 0) + 1);
    return marker(reason, stableSecretValue(value), key);
  }

  if (typeof value === "string") {
    const result = redactText(value, { policy: "standard", key, contentClass: "native" });
    for (const audit of result.audits) {
      audits.set(audit.reason, (audits.get(audit.reason) ?? 0) + audit.count);
    }
    return result.text;
  }

  if (Array.isArray(value)) {
    return immutableJsonArray(
      value.map((entry) => redactJsonValue(entry, key, audits, undefined, depth + 1))
    );
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, ImmutableJsonValue> = Object.create(null);
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactJsonValue(entryValue, key, audits, entryKey, depth + 1);
    }
    return immutableJsonObject(output);
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  throw new TypeError("Native payload must contain only JSON values.");
}

export function redactJson(input: unknown, context: JsonRedactionContext): RedactedJsonResult {
  if (context.policy !== "standard") {
    return omittedJsonResult(context.runId, context.policy);
  }

  const auditCounts = new Map<string, number>();
  const redacted = redactJsonValue(input, context.key, auditCounts);
  const audits = freezeAudits([...auditCounts].map(([reason, count]) => ({ reason, count })));
  const serialized = JSON.stringify(redacted);
  if (serialized === undefined) throw new Error("Native payload must be JSON-serializable.");
  return immutableJsonResult(
    context.runId,
    redacted,
    RedactedBytes.fromText(createResult(serialized, audits)),
    audits
  );
}
