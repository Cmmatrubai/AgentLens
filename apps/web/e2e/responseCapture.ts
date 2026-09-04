export interface CapturedResponse {
  readonly body: Buffer;
  readonly headers: Buffer;
  readonly pathname: string;
  readonly status: number;
}

export interface ResponseCaptureSource {
  body(): Promise<Buffer>;
  headersArray(): Promise<readonly Readonly<{ name: string; value: string }>[]>
  request(): Readonly<{ method(): string }>;
  status(): number;
  url(): string;
}

interface FailedResponseCapture {
  readonly error: Error;
  readonly ok: false;
}

interface ReadableResponseCapture {
  readonly captured: CapturedResponse;
  readonly ok: true;
}

export type ResponseCapture = FailedResponseCapture | ReadableResponseCapture;

function safePathname(url: string): string {
  const pathname = new URL(url).pathname;
  return pathname.startsWith("/bootstrap/") ? "/bootstrap/[consumed]" : pathname;
}

function safeCaptureCause(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "unknown capture failure";
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/(https?:\/\/127\.0\.0\.1:\d+\/bootstrap\/)[^\s]+/g, "$1[consumed]");
}

function captureFailure(response: ResponseCaptureSource, phase: "body" | "headers", cause: unknown): FailedResponseCapture {
  const pathname = safePathname(response.url());
  return {
    error: new Error(
      `Unable to read raw response ${phase} for ${response.request().method()} ${pathname}: ${safeCaptureCause(cause)}`
    ),
    ok: false
  };
}

export async function captureResponse(response: ResponseCaptureSource): Promise<ResponseCapture> {
  let body: Buffer;
  try {
    body = await response.body();
  } catch (error) {
    return captureFailure(response, "body", error);
  }
  let headers: readonly Readonly<{ name: string; value: string }>[];
  try {
    headers = await response.headersArray();
  } catch (error) {
    return captureFailure(response, "headers", error);
  }
  return {
    captured: {
      body,
      headers: Buffer.from(headers.map(({ name, value }) => `${name}: ${value}\r\n`).join(""), "latin1"),
      pathname: safePathname(response.url()),
      status: response.status()
    },
    ok: true
  };
}

export async function drainResponseCaptures(
  pending: readonly Promise<ResponseCapture>[]
): Promise<CapturedResponse[]> {
  const captured: CapturedResponse[] = [];
  const failures: Error[] = [];
  let offset = 0;
  while (offset < pending.length) {
    const batch = pending.slice(offset);
    offset = pending.length;
    for (const result of await Promise.all(batch)) {
      if (result.ok) captured.push(result.captured);
      else failures.push(result.error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Privacy response capture failed closed.");
  return captured;
}
