import { describe, expect, it } from "vitest";

import { parseAgentLensArgs } from "../src/args.js";

describe("AgentLens argument parsing", () => {
  it("preserves every child argument and its ordering after the delimiter", () => {
    const childArgs = [
      "codex",
      "exec",
      "--json",
      "--model",
      "fixture model with spaces",
      "--config",
      "sandbox_permissions=['disk-read']",
      "literal $() and `ticks`"
    ];

    expect(parseAgentLensArgs([
      "record",
      "--label",
      "fixture run",
      "--capture",
      "standard",
      "--data-root",
      "/tmp/agentlens-data",
      "--",
      ...childArgs
    ])).toEqual({
      name: "record",
      label: "fixture run",
      capture: "standard",
      dataRoot: "/tmp/agentlens-data",
      childArgs
    });
  });

  it.each([
    [["record", "codex", "exec", "--json"], /delimiter/i],
    [["record", "--", "other", "exec", "--json"], /codex executable basename/i],
    [["record", "--", "/tmp/codex-wrapper", "exec", "--json"], /codex executable basename/i],
    [["record", "--", "codex", "resume", "--json"], /exec/i],
    [["record", "--", "codex", "exec", "fixture prompt"], /--json/i]
  ])("refuses an invalid record invocation %#", (argv, message) => {
    expect(() => parseAgentLensArgs(argv)).toThrow(message);
  });

  it("parses read commands without accepting unknown options", () => {
    expect(parseAgentLensArgs(["runs", "--data-root", "/tmp/data", "--limit", "12", "--json"]))
      .toEqual({ name: "runs", dataRoot: "/tmp/data", limit: 12, json: true });
    expect(parseAgentLensArgs([
      "inspect", "run-123", "--data-root", "/tmp/data", "--json", "--native"
    ])).toEqual({
      name: "inspect",
      runId: "run-123",
      dataRoot: "/tmp/data",
      json: true,
      native: true
    });
    expect(() => parseAgentLensArgs(["runs", "--future-option"])).toThrow(/unknown option/i);
  });

  it.each(["unreviewed", "success", "partial", "failure"] as const)(
    "parses the %s assessment verdict",
    (verdict) => {
      expect(parseAgentLensArgs(["assess", "run-123", "--verdict", verdict])).toEqual({
        name: "assess",
        runId: "run-123",
        verdict,
        taskCompleted: "uncertain",
        dataRoot: expect.any(String),
        json: false
      });
    }
  );

  it.each(["yes", "no", "uncertain"] as const)(
    "parses the %s task-completion value",
    (taskCompleted) => {
      expect(parseAgentLensArgs([
        "assess",
        "run-123",
        "--verdict",
        "partial",
        "--task-completed",
        taskCompleted
      ])).toMatchObject({ taskCompleted });
    }
  );

  it("parses assessment note, data-root, and JSON options while preserving an empty note", () => {
    expect(parseAgentLensArgs([
      "assess",
      "run-123",
      "--verdict",
      "success",
      "--task-completed",
      "yes",
      "--note",
      "reviewed note",
      "--data-root",
      "/tmp/assessment-data",
      "--json"
    ])).toEqual({
      name: "assess",
      runId: "run-123",
      verdict: "success",
      taskCompleted: "yes",
      note: "reviewed note",
      dataRoot: "/tmp/assessment-data",
      json: true
    });
    expect(parseAgentLensArgs([
      "assess", "run-123", "--verdict", "partial", "--note", ""
    ])).toMatchObject({ note: "" });
    expect(parseAgentLensArgs([
      "assess", "run-123", "--verdict", "unreviewed", "--note", "review context"
    ])).toMatchObject({
      verdict: "unreviewed",
      taskCompleted: "uncertain",
      note: "review context"
    });
  });

  it("enforces the assessment-note limit as UTF-8 bytes", () => {
    const exact = "é".repeat(8 * 1024);
    expect(Buffer.byteLength(exact, "utf8")).toBe(16 * 1024);
    expect(parseAgentLensArgs([
      "assess", "run-123", "--verdict", "partial", "--note", exact
    ])).toMatchObject({ note: exact });
    expect(() => parseAgentLensArgs([
      "assess", "run-123", "--verdict", "partial", "--note", `${exact}a`
    ])).toThrow(/16 KiB|16384|note.*large/i);
  });

  it.each([
    [["assess"], /run ID/i],
    [["assess", ""], /run ID/i],
    [["assess", "run-123"], /requires.*verdict/i],
    [["assess", "run-123", "--verdict"], /requires a value/i],
    [["assess", "run-123", "--verdict", "unknown"], /invalid.*verdict/i],
    [["assess", "run-123", "--verdict", "success", "--task-completed"], /requires a value/i],
    [["assess", "run-123", "--verdict", "success", "--task-completed", "maybe"], /invalid.*task/i],
    [["assess", "run-123", "--verdict", "success", "--note"], /requires a value/i],
    [["assess", "run-123", "--verdict", "success", "--data-root"], /requires a value/i],
    [["assess", "run-123", "--verdict", "success", "--future"], /unknown.*assess/i],
    [["assess", "run-123", "--verdict", "success", "extra-run"], /unknown.*assess|positional/i],
    [[
      "assess", "run-123", "--verdict", "unreviewed", "--task-completed", "yes"
    ], /unreviewed.*uncertain/i],
    [[
      "assess", "run-123", "--verdict", "unreviewed", "--task-completed", "no"
    ], /unreviewed.*uncertain/i]
  ] as const)("refuses an invalid assess invocation %#", (argv, message) => {
    expect(() => parseAgentLensArgs(argv)).toThrow(message);
  });

  it.each([
    ["verdict", [
      "assess", "run-123", "--verdict", "success", "--verdict", "failure"
    ]],
    ["task-completed", [
      "assess", "run-123", "--verdict", "success",
      "--task-completed", "yes", "--task-completed", "uncertain"
    ]],
    ["note", [
      "assess", "run-123", "--verdict", "success", "--note", "one", "--note", "two"
    ]],
    ["data-root", [
      "assess", "run-123", "--verdict", "success",
      "--data-root", "/tmp/one", "--data-root", "/tmp/two"
    ]],
    ["json", [
      "assess", "run-123", "--verdict", "success", "--json", "--json"
    ]]
  ] as const)("rejects the duplicate --%s assessment option", (_option, argv) => {
    expect(() => parseAgentLensArgs(argv)).toThrow(/duplicate/i);
  });
});
