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
  reason: string;
  count: number;
}

const redactedResultBrand: unique symbol = Symbol("agentlens.redacted-result");

export interface RedactionResult {
  readonly [redactedResultBrand]: true;
  text: string;
  audits: readonly RedactionAudit[];
}

export class RedactedBytes {
  readonly #bytes: Buffer;

  private constructor(bytes: Buffer) {
    this.#bytes = Buffer.from(bytes);
  }

  static fromText(result: RedactionResult): RedactedBytes {
    if (result[redactedResultBrand] !== true) {
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

export type RedactedJsonResult =
  | {
      storage: "content";
      runId: string;
      redacted: unknown;
      redactedBytes: RedactedBytes;
      audits: readonly RedactionAudit[];
    }
  | {
      storage: "omitted";
      runId: string;
      reason: "metadata-only" | "strict";
    };

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

function createResult(text: string, audits: readonly RedactionAudit[]): RedactionResult {
  return { [redactedResultBrand]: true, text, audits };
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

function redactJsonValue(
  value: unknown,
  key: Buffer,
  audits: Map<string, number>,
  propertyName?: string
): unknown {
  const reason = propertyName ? sensitiveJsonReason(propertyName) : undefined;
  if (reason) {
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
    return value.map((entry) => redactJsonValue(entry, key, audits));
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactJsonValue(entryValue, key, audits, entryKey);
    }
    return output;
  }

  return value;
}

export function redactJson(input: unknown, context: JsonRedactionContext): RedactedJsonResult {
  if (context.policy !== "standard") {
    return { storage: "omitted", reason: context.policy, runId: context.runId };
  }

  const auditCounts = new Map<string, number>();
  const redacted = redactJsonValue(input, context.key, auditCounts);
  const audits = [...auditCounts].map(([reason, count]) => ({ reason, count }));
  const serialized = JSON.stringify(redacted);
  if (serialized === undefined) throw new Error("Native payload must be JSON-serializable.");
  return {
    storage: "content",
    runId: context.runId,
    redacted,
    redactedBytes: RedactedBytes.fromText(createResult(serialized, audits)),
    audits
  };
}
