import { createHmac, randomBytes } from "node:crypto";

import type { BrowserSourceRefV1 } from "@agentlens/api-contract";

import { projectProviderFieldV1 } from "./projectors.js";

const SOURCE_DOMAIN = "agentlens/source-ref/v1";
const LIFECYCLE_DOMAIN = "agentlens/lifecycle-group/v1";

export interface BrowserSourceInput {
  readonly provider: string;
  readonly sessionId?: string | undefined;
  readonly threadId?: string | undefined;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly toolId?: string | undefined;
  readonly eventType?: string | undefined;
  readonly itemType?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface SourceRefProjector {
  project(source: BrowserSourceInput): BrowserSourceRefV1;
  lifecycleGroup(source: BrowserSourceInput): string;
}

function keyBytes(key: Uint8Array): Buffer {
  const bytes = Buffer.from(key);
  if (bytes.byteLength !== 32) throw new Error("API HMAC keys must contain exactly 32 bytes.");
  return bytes;
}

function lengthDelimited(fields: readonly (string | undefined)[]): Buffer {
  const chunks: Buffer[] = [];
  for (const field of fields) {
    if (field === undefined) {
      const missing = Buffer.allocUnsafe(4);
      missing.writeUInt32BE(0xffff_ffff);
      chunks.push(missing);
      continue;
    }
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function sourceTuple(source: BrowserSourceInput): readonly (string | undefined)[] {
  return [
    source.provider,
    source.sessionId,
    source.threadId,
    source.turnId,
    source.itemId,
    source.toolId,
    source.eventType,
    source.itemType,
    source.correlationId
  ];
}

function lifecycleTuple(source: BrowserSourceInput): readonly (string | undefined)[] {
  return [
    source.provider,
    source.sessionId,
    source.threadId,
    source.turnId,
    source.itemId,
    source.toolId,
    source.itemType,
    source.correlationId
  ];
}

function digest(
  key: Buffer,
  domain: string,
  tuple: readonly (string | undefined)[]
): string {
  return createHmac("sha256", key)
    .update(lengthDelimited([domain]))
    .update(lengthDelimited(tuple))
    .digest("hex");
}

export function createSourceRefProjector(
  sourceKey: Uint8Array = randomBytes(32)
): SourceRefProjector {
  const key = keyBytes(sourceKey);
  return Object.freeze({
    project(source: BrowserSourceInput): BrowserSourceRefV1 {
      return Object.freeze({
        opaqueRef: `src_${digest(key, SOURCE_DOMAIN, sourceTuple(source))}`,
        provider: projectProviderFieldV1(source.provider),
        hasSessionOrThread: source.sessionId !== undefined || source.threadId !== undefined,
        hasTurn: source.turnId !== undefined,
        hasItemOrTool: source.itemId !== undefined || source.toolId !== undefined,
        hasCorrelation: source.correlationId !== undefined
      });
    },
    lifecycleGroup(source: BrowserSourceInput): string {
      return `grp_${digest(key, LIFECYCLE_DOMAIN, lifecycleTuple(source))}`;
    }
  });
}
