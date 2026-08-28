import type { Readable } from "node:stream";

export const MAX_SOURCE_LINE_BYTES = 1_048_576;

export type SourceStreamName = "stdout" | "stderr";

export interface SourceStreamLine {
  readonly type: "line";
  readonly stream: SourceStreamName;
  readonly line: string;
  readonly byteLength: number;
}

export interface SourceStreamDiagnostic {
  readonly type: "diagnostic";
  readonly stream: SourceStreamName;
  readonly reason: "line_too_large";
  readonly limitBytes: number;
  readonly observedBytes: number;
}

export type SourceStreamRecord = SourceStreamLine | SourceStreamDiagnostic;

export interface SourceIngestionMetrics {
  readonly lineCount: number;
  readonly diagnosticCount: number;
  readonly maxRetainedBytes: number;
  readonly maxInFlightCallbacks: number;
}

export interface ConsumeSourceStreamOptions {
  readonly maxLineBytes?: number;
}

export async function consumeSourceStream(
  stream: Readable,
  streamName: SourceStreamName,
  onRecord: (record: SourceStreamRecord) => void | Promise<void>,
  options: ConsumeSourceStreamOptions = {}
): Promise<SourceIngestionMetrics> {
  const limitBytes = options.maxLineBytes ?? MAX_SOURCE_LINE_BYTES;
  if (!Number.isInteger(limitBytes) || limitBytes <= 0) {
    throw new Error("Source line byte limit must be a positive integer.");
  }

  const retained = Buffer.allocUnsafe(limitBytes);
  let retainedBytes = 0;
  let observedBytes = 0;
  let lastByte: number | undefined;
  let lineCount = 0;
  let diagnosticCount = 0;
  let inFlightCallbacks = 0;
  let maxInFlightCallbacks = 0;
  let maxRetainedBytes = 0;

  const deliver = async (record: SourceStreamRecord): Promise<void> => {
    inFlightCallbacks += 1;
    maxInFlightCallbacks = Math.max(maxInFlightCallbacks, inFlightCallbacks);
    try {
      await onRecord(record);
    } finally {
      inFlightCallbacks -= 1;
    }
  };

  const finishRecord = async (): Promise<void> => {
    const hasTrailingCarriageReturn = lastByte === 0x0d;
    const contentBytes = observedBytes - (hasTrailingCarriageReturn ? 1 : 0);
    if (contentBytes > limitBytes) {
      diagnosticCount += 1;
      await deliver(Object.freeze({
        type: "diagnostic",
        stream: streamName,
        reason: "line_too_large",
        limitBytes,
        observedBytes: contentBytes
      }));
    } else if (contentBytes > 0) {
      lineCount += 1;
      await deliver(Object.freeze({
        type: "line",
        stream: streamName,
        line: retained.subarray(0, contentBytes).toString("utf8"),
        byteLength: contentBytes
      }));
    }
    retainedBytes = 0;
    observedBytes = 0;
    lastByte = undefined;
  };

  for await (const sourceChunk of stream) {
    const chunk = Buffer.isBuffer(sourceChunk) ? sourceChunk : Buffer.from(sourceChunk);
    let offset = 0;
    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.byteLength : newline;
      const segmentBytes = end - offset;
      if (segmentBytes > 0) {
        const available = limitBytes - retainedBytes;
        const copiedBytes = Math.min(available, segmentBytes);
        if (copiedBytes > 0) {
          chunk.copy(retained, retainedBytes, offset, offset + copiedBytes);
          retainedBytes += copiedBytes;
          maxRetainedBytes = Math.max(maxRetainedBytes, retainedBytes);
        }
        observedBytes += segmentBytes;
        lastByte = chunk[end - 1];
      }
      if (newline === -1) break;
      await finishRecord();
      offset = newline + 1;
    }
  }

  if (observedBytes > 0) await finishRecord();
  return Object.freeze({
    lineCount,
    diagnosticCount,
    maxRetainedBytes,
    maxInFlightCallbacks
  });
}
