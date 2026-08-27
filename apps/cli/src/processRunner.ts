import { spawn } from "node:child_process";
import type { PromptInput } from "./promptInput.js";

export interface ChildProcessResult {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly terminatingSignal: NodeJS.Signals | null;
  readonly explicitlyInterrupted: boolean;
}

export interface ProcessRunnerInput {
  readonly childArgs: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly promptInput: PromptInput;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly onSpawn: (pid: number) => void | Promise<void>;
  readonly onLine: (
    stream: "stdout" | "stderr",
    line: string,
    receivedAt: number
  ) => void | Promise<void>;
}

export class ChildSpawnError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "ChildSpawnError";
  }
}

function lineConsumer(
  stream: NodeJS.ReadableStream,
  name: "stdout" | "stderr",
  beforeLine: Promise<void>,
  onLine: ProcessRunnerInput["onLine"],
  now: () => number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = "";
    let queue = beforeLine;
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        const receivedAt = now();
        queue = queue.then(async () => onLine(name, line, receivedAt));
      }
    });
    stream.once("error", reject);
    stream.once("end", () => {
      if (pending.length > 0) {
        const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
        const receivedAt = now();
        queue = queue.then(async () => onLine(name, line, receivedAt));
      }
      queue.then(resolve, reject);
    });
  });
}

function writeBufferedInput(stream: NodeJS.WritableStream, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
    };
    const onError = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.on("error", onError);
    stream.once("close", onClose);
    stream.end(bytes);
  });
}

export async function runChildProcess(input: ProcessRunnerInput): Promise<ChildProcessResult> {
  if (input.childArgs[0] !== "codex") throw new Error("Process runner only spawns the codex basename.");
  const child = spawn("codex", [...input.childArgs.slice(1)], {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    stdio: [input.promptInput.mode === "inherit" ? "inherit" : "pipe", "pipe", "pipe"]
  });

  let spawnResolve!: () => void;
  let spawnReject!: (error: unknown) => void;
  const spawned = new Promise<void>((resolve, reject) => {
    spawnResolve = resolve;
    spawnReject = reject;
  });
  child.once("spawn", () => {
    const pid = child.pid;
    if (pid === undefined) {
      spawnReject(new ChildSpawnError("Codex spawned without a process ID.", { cause: undefined }));
      return;
    }
    Promise.resolve(input.onSpawn(pid)).then(spawnResolve, spawnReject);
  });
  child.once("error", (error) => {
    spawnReject(new ChildSpawnError("Unable to spawn codex.", { cause: error }));
  });

  let explicitlyInterrupted = false;
  const abort = (): void => {
    explicitlyInterrupted = true;
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();

  const close = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
    (resolve) => child.once("close", (code, signal) => resolve({ code, signal }))
  );

  let streams: Promise<void[]> | undefined;
  try {
    await spawned;
    if (!child.stdout || !child.stderr) throw new Error("Codex stdout/stderr pipes were not created.");
    streams = Promise.all([
      lineConsumer(child.stdout, "stdout", spawned, input.onLine, input.now ?? Date.now),
      lineConsumer(child.stderr, "stderr", spawned, input.onLine, input.now ?? Date.now)
    ]);
    if (input.promptInput.mode === "buffered") {
      if (!child.stdin) throw new Error("Buffered Codex stdin pipe was not created.");
      await writeBufferedInput(child.stdin, input.promptInput.bytes);
    }

    const result = await close;
    await streams;
    const pid = child.pid;
    if (pid === undefined) throw new Error("Codex process ID disappeared after spawn.");
    return Object.freeze({
      pid,
      exitCode: result.code,
      terminatingSignal: result.signal,
      explicitlyInterrupted
    });
  } catch (error) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await close.catch(() => undefined);
    }
    await streams?.catch(() => undefined);
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}
