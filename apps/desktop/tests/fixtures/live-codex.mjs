#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex fixture");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(
    process.env.AGENTLENS_FIXTURE_OLD_CLI
      ? "--json"
      : "--json --ignore-user-config --ignore-rules --ephemeral --sandbox",
  );
  process.exit(0);
}
if (args[0] === "login")
  process.exit(process.env.AGENTLENS_FIXTURE_SIGNED_OUT ? 1 : 0);
const model = args[args.indexOf("-m") + 1];
if (process.env.AGENTLENS_FIXTURE_REQUIRE_DEP === "1") {
  const require = createRequire(join(process.cwd(), "package.json"));
  if (require("setup-helper") !== 42)
    throw Error("fixture_dependency_unavailable");
}
if (process.env.AGENTLENS_FIXTURE_PID)
  writeFileSync(process.env.AGENTLENS_FIXTURE_PID, String(process.pid));
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let prompt = "";
for await (const part of process.stdin) prompt += part;
if (
  !args.includes("--json") ||
  !args.includes("workspace-write") ||
  !args.includes("--ignore-user-config") ||
  !prompt
)
  process.exit(3);
emit({ type: "thread.started", thread_id: "fixture-thread" });
if (model === "fixture-descendant" || model === "fixture-inherited-pipes") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio:
      model === "fixture-inherited-pipes"
        ? ["ignore", "inherit", "inherit"]
        : "ignore",
  });
  child.unref();
  writeFileSync(process.env.AGENTLENS_FIXTURE_DESCENDANT, String(child.pid));
  emit({
    type: "turn.completed",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  process.exit(0);
}
if (model === "fixture-worker-crash") {
  process.on("SIGTERM", () => {});
  setTimeout(() => process.kill(process.ppid, "SIGKILL"), 600);
  await new Promise(() => setInterval(() => {}, 1000));
}
if (model === "fixture-storage" || model === "fixture-large") {
  if (model === "fixture-storage") process.on("SIGTERM", () => {});
  await pause(500);
  emit({
    type: "item.completed",
    item: {
      id: "large-command",
      type: "command_execution",
      command: "echo fixture-output",
      aggregated_output: "sample output text ".repeat(10000),
      exit_code: 0,
      status: "completed",
    },
  });
  if (model === "fixture-storage")
    await new Promise(() => setInterval(() => {}, 1000));
}
emit({
  type: "turn.started",
  thread_id: "fixture-thread",
  turn_id: "fixture-turn",
});
emit({
  type: "item.started",
  item: {
    id: "command-1",
    type: "command_execution",
    command: "node --test",
    status: "in_progress",
  },
});
await pause(Number(process.env.AGENTLENS_FIXTURE_DELAY_MS ?? 100));
if (model === "fixture-hang")
  await new Promise(() => setInterval(() => {}, 1000));
if (model === "fixture-fail") {
  emit({
    type: "turn.failed",
    error: { message: "Fixture model unavailable" },
  });
  process.exit(1);
}
writeFileSync("task.txt", "updated by " + model + "\n");
for (let i = 0; i < Number(process.env.AGENTLENS_FIXTURE_STEPS ?? 0); i++) {
  emit({
    type: "item.completed",
    item: {
      id: "progress-" + i,
      type: "command_execution",
      command: `Inspect fixture file ${i + 1}`,
      aggregated_output: `Fixture inspection ${i + 1}\nVerified local sample content.\nNo network or provider request was made.`,
      exit_code: 0,
      status: "completed",
    },
  });
  await pause(700);
}
emit({
  type: "item.completed",
  item: {
    id: "command-1",
    type: "command_execution",
    command: "node --test",
    aggregated_output:
      "1 test passed\nOPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDE",
    exit_code: 0,
    status: "completed",
  },
});
emit({
  type: "item.completed",
  item: {
    id: "file-1",
    type: "file_change",
    changes: [{ path: "task.txt", kind: "update" }],
    status: "completed",
  },
});
emit({
  type: "item.completed",
  item: {
    id: "message-1",
    type: "agent_message",
    text: "Updated task.txt and ran the check.",
    status: "completed",
  },
});
emit({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 8 } });
