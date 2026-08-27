import type { RecordCommand } from "../args.js";
import { recordRun, type RecordResult, type RecordRunDependencies } from "../recordRun.js";

export async function runRecordCommand(
  command: RecordCommand,
  dependencies: RecordRunDependencies = {}
): Promise<RecordResult> {
  return recordRun(command, dependencies);
}
