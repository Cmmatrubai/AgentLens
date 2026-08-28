import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { PromptInput } from "./promptInput.js";
import {
  consumeSourceStream,
  type SourceStreamDiagnostic
} from "./sourceStreamDecoder.js";

export const DEFAULT_TERMINATION_GRACE_MS = 2_000;

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
  readonly forceTerminationSignal?: AbortSignal;
  readonly terminationGraceMs?: number;
  readonly now?: () => number;
  readonly onSpawn: (pid: number, processGroupId: number | null) => void | Promise<void>;
  readonly onLine: (
    stream: "stdout" | "stderr",
    line: string,
    receivedAt: number
  ) => void | Promise<void>;
  readonly onDiagnostic: (
    diagnostic: SourceStreamDiagnostic,
    receivedAt: number
  ) => void | Promise<void>;
}

export class ChildSpawnError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "ChildSpawnError";
  }
}

async function sourceConsumer(
  stream: Readable,
  name: "stdout" | "stderr",
  onLine: ProcessRunnerInput["onLine"],
  onDiagnostic: ProcessRunnerInput["onDiagnostic"],
  now: () => number
): Promise<void> {
  await consumeSourceStream(stream, name, async (record) => {
    const receivedAt = now();
    if (record.type === "line") await onLine(name, record.line, receivedAt);
    else await onDiagnostic(record, receivedAt);
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
  const terminationGraceMs = input.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  if (!Number.isFinite(terminationGraceMs) || terminationGraceMs < 0) {
    throw new Error("Termination grace period must be a non-negative number of milliseconds.");
  }
  const usesProcessGroup = process.platform !== "win32";
  const child = spawn("codex", [...input.childArgs.slice(1)], {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    detached: usesProcessGroup,
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
    Promise.resolve(input.onSpawn(pid, usesProcessGroup ? pid : null)).then(spawnResolve, spawnReject);
  });
  child.once("error", (error) => {
    spawnReject(new ChildSpawnError("Unable to spawn codex.", { cause: error }));
  });

  let explicitlyInterrupted = false;
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  const childIsOpen = (): boolean =>
    child.pid !== undefined && child.exitCode === null && child.signalCode === null;
  const signalChild = (signal: NodeJS.Signals): void => {
    if (!childIsOpen() || child.pid === undefined) return;
    if (!usesProcessGroup) {
      child.kill(signal);
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      child.kill(signal);
    }
  };
  const forceTerminate = (): void => {
    explicitlyInterrupted = true;
    if (terminationTimer !== undefined) {
      clearTimeout(terminationTimer);
      terminationTimer = undefined;
    }
    signalChild("SIGKILL");
  };
  const abort = (): void => {
    explicitlyInterrupted = true;
    signalChild("SIGTERM");
    if (childIsOpen() && terminationTimer === undefined) {
      terminationTimer = setTimeout(forceTerminate, terminationGraceMs);
    }
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  input.forceTerminationSignal?.addEventListener("abort", forceTerminate, { once: true });
  if (input.signal?.aborted) abort();
  if (input.forceTerminationSignal?.aborted) forceTerminate();

  const close = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
    (resolve) => child.once("close", (code, signal) => resolve({ code, signal }))
  );
  const waitForCloseOrGrace = async (): Promise<void> => {
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        close.then(() => undefined),
        new Promise<void>((resolve) => {
          graceTimer = setTimeout(resolve, terminationGraceMs);
        })
      ]);
    } finally {
      if (graceTimer !== undefined) clearTimeout(graceTimer);
    }
  };

  let streams: Promise<void[]> | undefined;
  try {
    await spawned;
    if (!child.stdout || !child.stderr) throw new Error("Codex stdout/stderr pipes were not created.");
    streams = Promise.all([
      sourceConsumer(child.stdout, "stdout", input.onLine, input.onDiagnostic, input.now ?? Date.now),
      sourceConsumer(child.stderr, "stderr", input.onLine, input.onDiagnostic, input.now ?? Date.now)
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
    if (childIsOpen()) {
      signalChild("SIGTERM");
      await waitForCloseOrGrace();
      if (childIsOpen()) signalChild("SIGKILL");
      await close.catch(() => undefined);
    }
    await streams?.catch(() => undefined);
    throw error;
  } finally {
    if (terminationTimer !== undefined) clearTimeout(terminationTimer);
    input.signal?.removeEventListener("abort", abort);
    input.forceTerminationSignal?.removeEventListener("abort", forceTerminate);
  }
}
