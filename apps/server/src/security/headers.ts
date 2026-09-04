import { randomBytes } from "node:crypto";

export function createResponseNonce(): string {
  return randomBytes(18).toString("base64url");
}

export function noStoreSecurityHeaders(nonce: string): Readonly<Record<string, string>> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'self' 'nonce-${nonce}'`,
      "connect-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'"
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

export const staticSecurityHeaders: Readonly<Record<string, string>> = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};
