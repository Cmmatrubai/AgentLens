import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { PromptInput } from "./promptInput.js";
import {
  systemProcessIdentityInspector,
  type ProcessGroupState
} from "./processIdentity.js";
import {
  consumeSourceStream,
  type SourceStreamDiagnostic
} from "./sourceStreamDecoder.js";

export const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const MINIMUM_GROUP_CONFIRMATION_MS = 250;
const GROUP_POLL_INTERVAL_MS = 10;

export interface ProcessGroupTerminationFact {
  readonly processGroupId: number;
  readonly initialSignal: NodeJS.Signals | null;
  readonly escalationSignal: NodeJS.Signals | null;
  readonly confirmedGone: true;
}

export interface ChildProcessResult {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly terminatingSignal: NodeJS.Signals | null;
  readonly explicitlyInterrupted: boolean;
  readonly processGroupTermination: ProcessGroupTerminationFact | null;
}

export interface ProcessRunnerInput {
  readonly childArgs: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly promptInput: PromptInput;
  readonly signal?: AbortSignal;
  readonly forceTerminationSignal?: AbortSignal;
  readonly terminationGraceMs?: number;
  readonly inspectProcessGroup?: (processGroupId: number) => ProcessGroupState;
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

export class ProcessGroupTerminationError extends Error {
  readonly processGroupId: number;

  constructor(processGroupId: number) {
    super(`AgentLens could not confirm owned process-group shutdown for ${processGroupId}.`);
    this.name = "ProcessGroupTerminationError";
    this.processGroupId = processGroupId;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  let initialGroupSignal: NodeJS.Signals | null = null;
  let groupEscalationSignal: NodeJS.Signals | null = null;
  let groupEscalationAttemptedAt: number | undefined;
  let processGroupTermination: Promise<ProcessGroupTerminationFact> | undefined;
  const childIsOpen = (): boolean =>
    child.pid !== undefined && child.exitCode === null && child.signalCode === null;
  const signalDirectChild = (signal: NodeJS.Signals): void => {
    if (childIsOpen()) child.kill(signal);
  };
  const inspectOwnedProcessGroup = (): ProcessGroupState => {
    const processGroupId = child.pid;
    if (processGroupId === undefined) return "ambiguous";
    try {
      return (input.inspectProcessGroup ?? systemProcessIdentityInspector.inspectGroup)(processGroupId);
    } catch {
      return "ambiguous";
    }
  };
  const signalOwnedProcessGroup = (signal: NodeJS.Signals): boolean => {
    const processGroupId = child.pid;
    if (processGroupId === undefined) return false;
    try {
      process.kill(-processGroupId, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      signalDirectChild(signal);
      return false;
    }
  };
  const startProcessGroupMonitor = (): Promise<ProcessGroupTerminationFact> => {
    const processGroupId = child.pid;
    if (processGroupId === undefined) {
      return Promise.reject(new ProcessGroupTerminationError(-1));
    }
    if (processGroupTermination !== undefined) return processGroupTermination;
    const confirmationMs = Math.max(terminationGraceMs, MINIMUM_GROUP_CONFIRMATION_MS);
    processGroupTermination = (async () => {
      while (true) {
        if (inspectOwnedProcessGroup() === "gone") {
          return Object.freeze({
            processGroupId,
            initialSignal: initialGroupSignal,
            escalationSignal: groupEscalationSignal,
            confirmedGone: true as const
          });
        }
        if (
          groupEscalationAttemptedAt !== undefined &&
          Date.now() - groupEscalationAttemptedAt >= confirmationMs
        ) {
          throw new ProcessGroupTerminationError(processGroupId);
        }
        await delay(GROUP_POLL_INTERVAL_MS);
      }
    })().finally(() => {
      if (terminationTimer !== undefined) {
        clearTimeout(terminationTimer);
        terminationTimer = undefined;
      }
    });
    void processGroupTermination.catch(() => undefined);
    return processGroupTermination;
  };
  const forceCleanup = (): void => {
    if (terminationTimer !== undefined) {
      clearTimeout(terminationTimer);
      terminationTimer = undefined;
    }
    if (!usesProcessGroup) {
      signalDirectChild("SIGKILL");
      return;
    }
    if (inspectOwnedProcessGroup() !== "gone") {
      groupEscalationAttemptedAt ??= Date.now();
      if (signalOwnedProcessGroup("SIGKILL")) groupEscalationSignal = "SIGKILL";
    }
    void startProcessGroupMonitor();
  };
  const forceTerminate = (): void => {
    explicitlyInterrupted = true;
    forceCleanup();
  };
  const abort = (): void => {
    explicitlyInterrupted = true;
    if (!usesProcessGroup) {
      signalDirectChild("SIGTERM");
      if (childIsOpen() && terminationTimer === undefined) {
        terminationTimer = setTimeout(forceTerminate, terminationGraceMs);
      }
      return;
    }
    if (signalOwnedProcessGroup("SIGTERM")) initialGroupSignal = "SIGTERM";
    void startProcessGroupMonitor();
    if (terminationTimer === undefined) {
      terminationTimer = setTimeout(forceTerminate, terminationGraceMs);
    }
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  input.forceTerminationSignal?.addEventListener("abort", forceTerminate, { once: true });
  if (input.signal?.aborted) abort();
  if (input.forceTerminationSignal?.aborted) forceTerminate();

  const cleanupAfterLeaderExit = (): void => {
    // `close` can wait on inherited stdout/stderr held by a background child.
    // Begin cleanup at leader exit, then let close and the consumers drain.
    if (usesProcessGroup && processGroupTermination === undefined && inspectOwnedProcessGroup() !== "gone") {
      if (signalOwnedProcessGroup("SIGTERM")) initialGroupSignal = "SIGTERM";
      void startProcessGroupMonitor();
      terminationTimer = setTimeout(forceCleanup, terminationGraceMs);
    }
  };
  child.once("exit", cleanupAfterLeaderExit);
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
    const execution = (async () => {
      if (input.promptInput.mode === "buffered") {
        if (!child.stdin) throw new Error("Buffered Codex stdin pipe was not created.");
        await writeBufferedInput(child.stdin, input.promptInput.bytes);
      }
      return close;
    })();
    // Storage/consumer failure must enter cleanup while the child is still alive.
    // Handling streams only after close can leave a detached process orphaned.
    const result = await Promise.race([execution, streams.then(() => execution)]);
    // A successful leader can leave background work behind. Final Git evidence
    // must wait until the owned group is gone, without relabeling provider success
    // as a user interruption merely because background cleanup was needed.
    cleanupAfterLeaderExit();
    const groupTermination = processGroupTermination === undefined
      ? null
      : await processGroupTermination;
    await streams;
    const pid = child.pid;
    if (pid === undefined) throw new Error("Codex process ID disappeared after spawn.");
    return Object.freeze({
      pid,
      exitCode: result.code,
      terminatingSignal: result.signal,
      explicitlyInterrupted,
      processGroupTermination: groupTermination
    });
  } catch (error) {
    let groupCleanupError: unknown;
    if (usesProcessGroup && child.pid !== undefined) {
      if (processGroupTermination === undefined) {
        if (signalOwnedProcessGroup("SIGTERM")) initialGroupSignal = "SIGTERM";
        void startProcessGroupMonitor();
        if (terminationTimer === undefined) {
          terminationTimer = setTimeout(forceTerminate, terminationGraceMs);
        }
      }
      try {
        await processGroupTermination;
      } catch (cleanupError) {
        groupCleanupError = cleanupError;
      }
      await close.catch(() => undefined);
    } else if (childIsOpen()) {
      signalDirectChild("SIGTERM");
      await waitForCloseOrGrace();
      if (childIsOpen()) signalDirectChild("SIGKILL");
      await close.catch(() => undefined);
    }
    await streams?.catch(() => undefined);
    if (groupCleanupError !== undefined) throw groupCleanupError;
    throw error;
  } finally {
    if (terminationTimer !== undefined) clearTimeout(terminationTimer);
    input.signal?.removeEventListener("abort", abort);
    input.forceTerminationSignal?.removeEventListener("abort", forceTerminate);
  }
}
