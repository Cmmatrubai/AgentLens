import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  MAX_SOURCE_LINE_BYTES,
  consumeSourceStream,
  type SourceStreamRecord
} from "../src/sourceStreamDecoder.js";

function byteChunks(value: string): Buffer[] {
  return [...Buffer.from(value)].map((byte) => Buffer.from([byte]));
}

describe("bounded source stream decoder", () => {
  it("handles arbitrary byte boundaries, multiple records, CRLF, blanks, and final no-newline", async () => {
    const records: SourceStreamRecord[] = [];
    const stream = Readable.from([
      ...byteChunks("one\r\n"),
      Buffer.from("\nTwo\nthree")
    ]);

    const metrics = await consumeSourceStream(stream, "stdout", async (record) => {
      records.push(record);
    });

    expect(records).toEqual([
      { type: "line", stream: "stdout", line: "one", byteLength: 3 },
      { type: "line", stream: "stdout", line: "Two", byteLength: 3 },
      { type: "line", stream: "stdout", line: "three", byteLength: 5 }
    ]);
    expect(metrics).toMatchObject({
      lineCount: 3,
      diagnosticCount: 0,
      maxInFlightCallbacks: 1,
      maxRetainedBytes: 5
    });
  });

  it.each([
    {
      streamName: "stdout" as const,
      prefix: Buffer.from('{"type":"future.event","value":"'),
      suffix: Buffer.from('"}')
    },
    {
      streamName: "stderr" as const,
      prefix: Buffer.from("malformed diagnostic "),
      suffix: Buffer.alloc(0)
    }
  ])(
    "discards a 64 MiB $streamName record without decoding it and resumes with the next record",
    async ({ streamName, prefix, suffix }) => {
      const records: SourceStreamRecord[] = [];
      const oversizedBytes = 64 * 1024 * 1024;
      const stream = Readable.from([
        prefix,
        Buffer.alloc(oversizedBytes - prefix.byteLength - suffix.byteLength, 0x78),
        suffix,
        Buffer.from('\n{"type":"following"}\n')
      ]);

      const metrics = await consumeSourceStream(stream, streamName, async (record) => {
        records.push(record);
      });

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        type: "diagnostic",
        stream: streamName,
        reason: "line_too_large",
        limitBytes: MAX_SOURCE_LINE_BYTES,
        observedBytes: oversizedBytes
      });
      expect(records[1]).toEqual({
        type: "line",
        stream: streamName,
        line: '{"type":"following"}',
        byteLength: 20
      });
      expect(metrics.maxRetainedBytes).toBeLessThanOrEqual(MAX_SOURCE_LINE_BYTES);
      expect(metrics.maxInFlightCallbacks).toBe(1);
    },
    15_000
  );

  it("applies callback backpressure instead of building a promise backlog", async () => {
    const lineCount = 2_000;
    let callbackCount = 0;
    let inFlight = 0;
    let observedMaxInFlight = 0;
    const stream = Readable.from([Buffer.from("{}\n".repeat(lineCount))]);

    const metrics = await consumeSourceStream(stream, "stdout", async () => {
      inFlight += 1;
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      callbackCount += 1;
      inFlight -= 1;
    });

    expect(callbackCount).toBe(lineCount);
    expect(observedMaxInFlight).toBe(1);
    expect(metrics).toMatchObject({
      lineCount,
      diagnosticCount: 0,
      maxInFlightCallbacks: 1,
      maxRetainedBytes: 2
    });
  });
});
