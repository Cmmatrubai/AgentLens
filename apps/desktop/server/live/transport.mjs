import { fork, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { privateRead, privateWrite } from "../insights/private-files.mjs";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const tsx = createRequire(import.meta.url).resolve("tsx");

export async function preflight() {
  try {
    await exec(
      "node",
      [
        "--import",
        tsx,
        "--conditions=development",
        "-e",
        "import('./apps/cli/src/recordRun.ts')",
      ],
      { cwd: repository, timeout: 15000, maxBuffer: 16000 },
    );
  } catch {
    throw Error("recorder_runtime_unavailable");
  }
  let help, version;
  try {
    help = (
      await exec("codex", ["exec", "--help"], {
        timeout: 8000,
        maxBuffer: 32000,
      })
    ).stdout;
    version = (
      await exec("codex", ["--version"], { timeout: 8000, maxBuffer: 4000 })
    ).stdout.trim();
  } catch {
    throw Error("codex_unavailable");
  }
  if (
    ![
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--sandbox",
    ].every((flag) => help.includes(flag))
  )
    throw Error("codex_update_required");
  try {
    await exec("codex", ["login", "status"], {
      timeout: 8000,
      maxBuffer: 8000,
    });
  } catch {
    throw Error("codex_login_required");
  }
  return { version };
}

export async function launchAttempt(input) {
  const request = {
    repository,
    workspace: input.workspace,
    root: input.root,
    task: input.task,
    model: input.model,
    effort: input.effort,
  };
  try {
    await privateWrite(input.root, "request.json", request);
  } catch (error) {
    throw Object.assign(error, { cleanupConfirmed: true });
  }
  if (input.signal.aborted)
    throw Object.assign(Error("attempt_cancelled"), { cleanupConfirmed: true });
  return new Promise((resolve, reject) => {
    const child = fork(worker, [join(input.root, "request.json")], {
      execPath: input.node ?? "node",
      execArgv: ["--import", tsx, "--conditions=development"],
      cwd: repository,
      env: input.env ?? process.env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let cleanupConfirmed = false;
    let failure,
      complete = false,
      chain = Promise.resolve();
    const abort = () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
    };
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
    child.on("message", (message) => {
      chain = chain
        .then(async () => {
          if (!message || !Number.isSafeInteger(message.sequence))
            throw Error("worker_protocol_failed");
          if (message.type === "event") await input.onEvent(message.event);
          else if (message.type === "run") await input.onRunId(message.id);
          else if (message.type === "complete") {
            complete = true;
            cleanupConfirmed = true;
          } else if (message.type === "failed") {
            cleanupConfirmed = message.cleanupConfirmed === true;
            failure ??= Error("worker_failed");
          } else throw Error("worker_protocol_failed");
          if (child.connected) child.send({ ack: message.sequence });
        })
        .catch((error) => {
          failure = error;
          abort();
        });
    });
    child.once("error", () => {
      cleanupConfirmed = !child.pid;
      failure = Error("worker_spawn_failed");
    });
    child.once("close", async (code) => {
      input.signal.removeEventListener("abort", abort);
      await chain;
      if (failure || code !== 0 || !complete) {
        reject(
          Object.assign(failure ?? Error("worker_failed"), {
            cleanupConfirmed,
          }),
        );
        return;
      }
      try {
        const run = await privateRead(input.root, "run.json");
        if (!run) throw Error("recording_missing");
        resolve(run);
      } catch (error) {
        error.cleanupConfirmed = true;
        reject(error);
      }
    });
  });
}
