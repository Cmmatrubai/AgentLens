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
        eventType: "turn.completed",
        usageCounters: {
          input: 101,
          cachedInput: 11,
          output: 202,
          reasoningOutput: 31,
          cacheWriteInput: 7
        }
      }
    });
  });

  it("keeps file-change starts and completions separate", async () => {
    const drafts = await normalizeFixture("edit-success.jsonl");

    const changes = drafts.filter((draft) => draft.kind === "file.change");
    expect(changes.map((draft) => draft.status)).toEqual(["in_progress", "completed"]);
    expect(changes[1]?.normalizedPayload).toEqual({
      eventType: "item.completed",
      itemType: "file_change",
      changes: [
        { path: "fixture/source-a.ts", kind: "modify" },
        { path: "fixture/source-b.ts", kind: "add" }
      ],
      status: "completed"
    });
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
    expect(drafts.filter((event) => event.kind === "command")[1]?.normalizedPayload)
      .toEqual({
        eventType: "item.completed",
        itemType: "command_execution",
        command: "fixture_command_fails",
        aggregatedOutput: "fixture failed output",
        exitCode: 1,
        status: "failed"
      });
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
