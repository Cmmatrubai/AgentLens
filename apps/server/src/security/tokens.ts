import { randomBytes, timingSafeEqual } from "node:crypto";

export const processTokenByteLength = 32;

export type TokenBytesFactory = () => Buffer;

export function createTokenBytes(factory: TokenBytesFactory = () => randomBytes(processTokenByteLength)): Buffer {
  const bytes = factory();
  if (!Buffer.isBuffer(bytes) || bytes.byteLength !== processTokenByteLength) {
    throw new Error("AgentLens server tokens must contain exactly 32 bytes.");
  }
  return Buffer.from(bytes);
}

export function encodeToken(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function matchesBearer(header: string | undefined, expected: Buffer): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const encoded = header.slice("Bearer ".length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) return false;

  let candidate: Buffer;
  try {
    candidate = Buffer.from(encoded, "base64url");
  } catch {
    return false;
  }
  if (candidate.byteLength !== expected.byteLength) return false;
  if (candidate.toString("base64url") !== encoded) return false;
  return timingSafeEqual(candidate, expected);
}

export function serializeForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
