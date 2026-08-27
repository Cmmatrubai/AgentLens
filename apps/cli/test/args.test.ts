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
});
