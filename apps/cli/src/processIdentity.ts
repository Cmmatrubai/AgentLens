import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type ProcessIdentityState = "same" | "gone" | "replaced" | "ambiguous";
export type ProcessGroupState = "alive" | "gone" | "ambiguous";

export interface ProcessIdentityInspector {
  captureStartToken(pid: number): Promise<string | null>;
  inspect(pid: number, expectedStartToken: string): Promise<ProcessIdentityState>;
  inspectGroup(processGroupId: number): ProcessGroupState;
}

function processExists(pid: number): "alive" | "gone" | "ambiguous" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === "ESRCH") return "gone";
    if (code === "EPERM") return "alive";
    return "ambiguous";
  }
}

async function captureStartToken(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Process identity requires a positive PID.");
  try {
    const { stdout } = await execFile("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      maxBuffer: 4 * 1024,
      timeout: 1_000
    });
    const token = stdout.trim();
    return token.length === 0 ? null : token;
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === 1 || code === "ESRCH") return null;
    return null;
  }
}

export const systemProcessIdentityInspector: ProcessIdentityInspector = Object.freeze({
  captureStartToken,
  inspect: async (pid: number, expectedStartToken: string) => {
    const first = processExists(pid);
    if (first === "gone") return "gone";
    if (first === "ambiguous") return "ambiguous";
    const actual = await captureStartToken(pid);
    if (actual !== null) return actual === expectedStartToken ? "same" : "replaced";
    const second = processExists(pid);
    return second === "gone" ? "gone" : "ambiguous";
  },
  inspectGroup: (processGroupId: number) => {
    if (!Number.isInteger(processGroupId) || processGroupId <= 0) return "ambiguous";
    if (process.platform === "win32") return "ambiguous";
    try {
      process.kill(-processGroupId, 0);
      return "alive";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") return "gone";
      if (code === "EPERM") return "alive";
      return "ambiguous";
    }
  }
});
