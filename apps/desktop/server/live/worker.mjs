import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { privateWrite } from "../insights/private-files.mjs";
import { displayText, projectRecordedRun } from "../recorded-projector.mjs";

const stop = new AbortController();
process.on("SIGTERM", () => stop.abort());
process.on("SIGINT", () => stop.abort());
process.on("disconnect", () => stop.abort());
let sequence = 0;
const waiting = new Map();
process.on("message", (message) => waiting.get(message?.ack)?.());
async function send(message) {
  if (!process.connected) {
    stop.abort();
    return;
  }
  const id = ++sequence;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      stop.abort();
      reject(Error("parent_unresponsive"));
    }, 15000);
    waiting.set(id, () => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve();
    });
    process.send({ ...message, sequence: id }, (error) => {
      if (error) {
        clearTimeout(timer);
        waiting.delete(id);
        stop.abort();
        reject(error);
      }
    });
  });
}
function activity(event) {
  const p = event.normalizedPayload ?? {};
  const clip = (v) => displayText(v).slice(0, 8000);
  return {
    id: event.id,
    kind: event.kind,
    status: event.status,
    summary: clip(event.summary),
    command:
      event.kind === "command"
        ? clip(p.commandEvidence?.redactedCommand ?? p.command)
        : "",
    output: event.kind === "command" ? clip(p.aggregatedOutput) : "",
    message: event.kind === "message.agent" ? clip(p.text) : "",
    files:
      event.kind === "file.change" && Array.isArray(p.changes)
        ? p.changes.slice(0, 30).map((f) => clip(f.path))
        : [],
    truncated:
      !!p.truncated ||
      (Array.isArray(p.changes) &&
        (p.changes.length > 30 ||
          p.changes.some(
            (f) => typeof f.path === "string" && f.path.length > 8000,
          ))) ||
      [p.command, p.aggregatedOutput, p.text].some(
        (v) => typeof v === "string" && v.length > 8000,
      ),
  };
}

let recordingEntered = false,
  recordingFinalized = false;
try {
  const request = JSON.parse(await readFile(process.argv[2], "utf8"));
  const { recordRun } = await import(
    pathToFileURL(join(request.repository, "apps/cli/src/recordRun.ts")).href
  );
  const argv = [
    "codex",
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "-m",
    request.model,
    "-s",
    "workspace-write",
    "-c",
    `model_reasoning_effort="${request.effort}"`,
    "-c",
    'approval_policy="never"',
    "-c",
    "features.chronicle=false",
    "-c",
    "features.multi_agent=false",
    "-c",
    'web_search="disabled"',
    "-c",
    'shell_environment_policy.inherit="core"',
    "-C",
    request.workspace,
    "-",
  ];
  recordingEntered = true;
  const result = await recordRun(
    {
      name: "record",
      capture: "standard",
      dataRoot: join(request.root, "recording"),
      label: "Desktop comparison",
      childArgs: argv,
    },
    {
      cwd: request.workspace,
      env: process.env,
      signal: stop.signal,
      stdin: Object.assign(Readable.from([request.task]), { isTTY: false }),
      stdout: {
        write() {
          return true;
        },
      },
      onRunIdPrinted: (id) => send({ type: "run", id }),
      onObservedEventPersisted: ({ event }) =>
        send({ type: "event", event: activity(event) }),
    },
  );
  recordingFinalized = true;
  // Existing read-only reader hydrates validated artifacts after recorder finalization.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      "--conditions=development",
      join(request.repository, "apps/desktop/server/read-agentlens.mjs"),
      request.repository,
      join(request.root, "recording"),
      result.runId,
    ],
    { cwd: request.repository, timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
  );
  const raw = JSON.parse(stdout);
  const run = projectRecordedRun(raw.inspection, {
    title: request.task.slice(0, 160),
    fetchedAt: Date.now(),
    readerRevision: "desktop-live",
    gitDiff: raw.gitDiff,
  });
  await privateWrite(request.root, "run.json", run);
  await send({ type: "complete" });
} catch {
  await send({
    type: "failed",
    cleanupConfirmed: !recordingEntered || recordingFinalized,
  }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
