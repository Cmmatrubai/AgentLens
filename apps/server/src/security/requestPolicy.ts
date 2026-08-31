import type { IncomingMessage } from "node:http";

export const maximumRequestBodyBytes = 1024 * 1024;

export function hasExactHost(request: IncomingMessage, expectedHost: string): boolean {
  let hostCount = 0;
  let hostValue: string | undefined;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() !== "host") continue;
    hostCount += 1;
    hostValue = request.rawHeaders[index + 1];
  }
  return hostCount === 1 && hostValue === expectedHost;
}

export function isMutationMethod(method: string | undefined): boolean {
  return method !== undefined && ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

export function hasExactOrigin(request: IncomingMessage, expectedOrigin: string): boolean {
  return request.headers.origin === expectedOrigin;
}

function declaredContentLength(request: IncomingMessage): number | null {
  const header = request.headers["content-length"];
  if (header === undefined) return null;
  if (!/^\d+$/.test(header)) throw new Error("invalid_content_length");
  const length = Number(header);
  if (!Number.isSafeInteger(length)) throw new Error("invalid_content_length");
  return length;
}

export async function readBoundedRequestBody(
  request: IncomingMessage,
  maximumBytes = maximumRequestBodyBytes
): Promise<Buffer> {
  const declared = declaredContentLength(request);
  if (declared !== null && declared > maximumBytes) {
    request.resume();
    throw new Error("request_body_too_large");
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > maximumBytes) {
      request.resume();
      throw new Error("request_body_too_large");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}
