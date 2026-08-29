import type { EventStatus } from "@agentlens/core";

export interface ObservedCommand {
  readonly command: string;
  readonly exitCode: number | null;
  readonly eventStatus: EventStatus;
}

export interface TestCommandClassification {
  readonly family:
    | "pytest"
    | "jest"
    | "vitest"
    | "npm"
    | "pnpm"
    | "yarn"
    | "cargo"
    | "go"
    | "maven"
    | "gradle";
  readonly confidence: "high" | "medium";
  readonly derivationVersion: "test-command/1";
}
