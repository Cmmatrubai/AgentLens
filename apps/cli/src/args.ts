import { homedir } from "node:os";
import { join } from "node:path";
import { capturePolicies, type CapturePolicy } from "@agentlens/core";

export interface RecordCommand {
  readonly name: "record";
  readonly capture: CapturePolicy;
  readonly dataRoot: string;
  readonly childArgs: readonly string[];
  readonly label?: string;
}

export interface RunsCommand {
  readonly name: "runs";
  readonly dataRoot: string;
  readonly limit: number;
  readonly json: boolean;
}

export interface InspectCommand {
  readonly name: "inspect";
  readonly runId: string;
  readonly dataRoot: string;
  readonly json: boolean;
  readonly native: boolean;
}

export type AgentLensCommand = RecordCommand | RunsCommand | InspectCommand;

const defaultDataRoot = join(homedir(), ".agentlens");

function requiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function recordCommand(argv: readonly string[]): RecordCommand {
  const delimiterIndex = argv.indexOf("--");
  if (delimiterIndex < 0) throw new Error("record requires the -- delimiter before child arguments.");

  let capture: CapturePolicy = "standard";
  let dataRoot = defaultDataRoot;
  let label: string | undefined;
  for (let index = 1; index < delimiterIndex; index += 1) {
    const option = argv[index];
    if (option === "--capture") {
      const value = requiredValue(argv, index, option);
      if (!(capturePolicies as readonly string[]).includes(value)) {
        throw new Error(`Invalid capture policy: ${value}.`);
      }
      capture = value as CapturePolicy;
      index += 1;
    } else if (option === "--data-root") {
      dataRoot = requiredValue(argv, index, option);
      index += 1;
    } else if (option === "--label") {
      label = requiredValue(argv, index, option);
      index += 1;
    } else {
      throw new Error(`Unknown record option: ${option ?? ""}.`);
    }
  }

  const childArgs = argv.slice(delimiterIndex + 1);
  if (childArgs[0] !== "codex") {
    throw new Error("record requires a codex executable basename exactly equal to codex.");
  }
  if (childArgs[1] !== "exec") throw new Error("record requires the codex exec subcommand.");
  if (!childArgs.slice(2).includes("--json")) throw new Error("record requires the --json flag.");

  return {
    name: "record",
    capture,
    dataRoot,
    childArgs,
    ...(label === undefined ? {} : { label })
  };
}

function runsCommand(argv: readonly string[]): RunsCommand {
  let dataRoot = defaultDataRoot;
  let limit = 50;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--data-root") {
      dataRoot = requiredValue(argv, index, option);
      index += 1;
    } else if (option === "--limit") {
      const value = Number(requiredValue(argv, index, option));
      if (!Number.isInteger(value) || value <= 0) throw new Error("--limit requires a positive integer.");
      limit = value;
      index += 1;
    } else if (option === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown option for runs: ${option ?? ""}.`);
    }
  }
  return { name: "runs", dataRoot, limit, json };
}

function inspectCommand(argv: readonly string[]): InspectCommand {
  const runId = argv[1];
  if (runId === undefined || runId.startsWith("--")) throw new Error("inspect requires a run ID.");
  let dataRoot = defaultDataRoot;
  let json = false;
  let native = false;
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--data-root") {
      dataRoot = requiredValue(argv, index, option);
      index += 1;
    } else if (option === "--json") {
      json = true;
    } else if (option === "--native") {
      native = true;
    } else {
      throw new Error(`Unknown option for inspect: ${option ?? ""}.`);
    }
  }
  return { name: "inspect", runId, dataRoot, json, native };
}

export function parseAgentLensArgs(argv: readonly string[]): AgentLensCommand {
  switch (argv[0]) {
    case "record":
      return recordCommand(argv);
    case "runs":
      return runsCommand(argv);
    case "inspect":
      return inspectCommand(argv);
    default:
      throw new Error("Usage: agentlens <record|runs|inspect> ...");
  }
}
