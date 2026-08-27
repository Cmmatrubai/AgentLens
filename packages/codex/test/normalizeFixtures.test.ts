import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { EventDraftV1 } from "@agentlens/core";
import { decodeCodexLine } from "../src/lineDecoder.js";
import { normalizeCodexRecord } from "../src/normalize.js";

const fixturesDir = resolve(
  fileURLToPath(new URL("../../../tests/fixtures/codex/", import.meta.url))
);

async function normalizeFixture(file: string): Promise<EventDraftV1[]> {
  const body = await readFile(resolve(fixturesDir, file), "utf8");
  const drafts: EventDraftV1[] = [];

  for (const line of body.split("\n").filter((candidate) => candidate.length > 0)) {
    const decoded = decodeCodexLine(line, "stdout");
    expect(decoded.type).toBe("provider_record");
    if (decoded.type === "provider_record") {
      const normalized = normalizeCodexRecord(decoded.record);
      expect(normalized).toHaveLength(1);
      drafts.push(...normalized);
    }
  }

  return drafts;
}

describe("Codex sanitized lifecycle fixtures", () => {
  it("maps the read-success chronology one source record at a time", async () => {
    const drafts = await normalizeFixture("read-success.jsonl");

    expect(drafts.map(({ kind, status }) => [kind, status])).toEqual([
      ["thread.started", "in_progress"],
      ["turn.started", "in_progress"],
      ["message.agent", "completed"],
      ["command", "in_progress"],
      ["command", "completed"],
      ["message.agent", "completed"],
      ["turn.completed", "completed"]
    ]);
    expect(drafts.at(-1)).toMatchObject({
      kind: "turn.completed",
      status: "completed",
      source: { eventType: "turn.completed" },
      normalizedPayload: {
        usage: {
          input_tokens: 101,
          cached_input_tokens: 11,
          output_tokens: 202,
          reasoning_output_tokens: 31,
          cache_write_input_tokens: 7
        }
      }
    });
  });

  it("keeps file-change starts and completions separate", async () => {
    const drafts = await normalizeFixture("edit-success.jsonl");

    expect(drafts.filter((draft) => draft.kind === "file.change").map((draft) => draft.status))
      .toEqual(["in_progress", "completed"]);
  });

  it("preserves failed command then later recovery activity as separate events", async () => {
    const drafts = await normalizeFixture("failure-recovery.jsonl");

    expect(drafts.filter((event) => event.kind === "command").map((event) => event.status))
      .toEqual([
        "in_progress",
        "failed",
        "in_progress",
        "completed",
        "in_progress",
        "completed",
        "in_progress",
        "completed"
      ]);
    expect(drafts.filter((event) => event.kind === "command").map((event) => event.source.itemId))
      .toEqual([
        "fixture-item-recovery-command-001",
        "fixture-item-recovery-command-001",
        "fixture-item-recovery-command-002",
        "fixture-item-recovery-command-002",
        "fixture-item-recovery-command-003",
        "fixture-item-recovery-command-003",
        "fixture-item-recovery-command-004",
        "fixture-item-recovery-command-004"
      ]);
  });

  it("leaves the interrupted command as observed in_progress", async () => {
    const drafts = await normalizeFixture("interrupted.jsonl");

    expect(drafts.at(-1)).toMatchObject({
      kind: "command",
      status: "in_progress",
      provenance: "observed"
    });
    expect(drafts.some((event) => event.kind === "recorder.recovery")).toBe(false);
  });
});
