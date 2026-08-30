import type { DoctorCommand } from "../args.js";
import {
  diagnoseDoctor,
  type DoctorDependencies,
  type DoctorResultV1
} from "../doctor.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export interface DoctorCommandResult {
  readonly result: DoctorResultV1;
  readonly exitCode: 0 | 1;
}

function validateCommand(command: unknown): asserts command is DoctorCommand {
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    throw new Error("Doctor command must be an object.");
  }
  const candidate = command as Record<string, unknown>;
  if (candidate.name !== "doctor") throw new Error("Doctor command name must be doctor.");
  if (typeof candidate.dataRoot !== "string" || candidate.dataRoot === "") {
    throw new Error("Doctor data root must be a non-empty string.");
  }
  if (typeof candidate.json !== "boolean") throw new Error("Doctor json flag must be a boolean.");
}

function doctorText(result: DoctorResultV1): string {
  return `${[
    `AgentLens doctor: ${result.overall}`,
    ...result.checks.map(({ id, status, summary }) => `${id}: ${status} - ${summary}`)
  ].join("\n")}\n`;
}

export async function runDoctorCommand(
  command: DoctorCommand,
  dependencies: DoctorDependencies & Readonly<{ stdout?: OutputWriter }> = {}
): Promise<DoctorCommandResult> {
  validateCommand(command);
  const result = await diagnoseDoctor(command.dataRoot, dependencies);
  (dependencies.stdout ?? process.stdout).write(
    command.json ? `${JSON.stringify(result, null, 2)}\n` : doctorText(result)
  );
  return Object.freeze({
    result,
    exitCode: result.overall === "fail" ? 1 : 0
  });
}
