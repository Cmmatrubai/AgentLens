#!/usr/bin/env node

import { appendFileSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const modeArg = args.find((argument) => argument.startsWith("--fake-mode="));
const mode = modeArg?.slice("--fake-mode=".length) ?? "success";

if (process.env.AGENTLENS_FAKE_STARTED_FILE && mode !== "hang") {
  appendFileSync(process.env.AGENTLENS_FAKE_STARTED_FILE, "child-started\n");
}
if (process.env.AGENTLENS_ARGV_CAPTURE) {
  writeFileSync(process.env.AGENTLENS_ARGV_CAPTURE, JSON.stringify(args));
}

const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const started = (id, type = "command_execution") => emit({
  type: "item.started",
  thread_id: "fixture-thread",
  turn_id: "fixture-turn",
  item: { id, type, command: "fixture command", status: "in_progress" }
});
const completed = (id, status = "completed", exitCode = 0) => emit({
  type: "item.completed",
  thread_id: "fixture-thread",
  turn_id: "fixture-turn",
  item: {
    id,
    type: "command_execution",
    command: "fixture command",
    aggregated_output: "fixture output",
    exit_code: exitCode,
    status
  }
});
const terminal = () => emit({
  type: "turn.completed",
  thread_id: "fixture-thread",
  turn_id: "fixture-turn",
  usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 }
});

if (mode !== "hang") {
  emit({ type: "thread.started", thread_id: "fixture-thread" });
  emit({ type: "turn.started", thread_id: "fixture-thread", turn_id: "fixture-turn" });
}

switch (mode) {
  case "success":
    emit({
      type: "item.completed",
      item: { id: "message-1", type: "agent_message", text: "fixture success", status: "completed" }
    });
    terminal();
    break;
  case "failed-then-recovery":
    started("command-failed");
    completed("command-failed", "failed", 1);
    started("command-recovery");
    completed("command-recovery", "completed", 0);
    terminal();
    break;
  case "open-item":
    started("command-open");
    terminal();
    break;
  case "nonzero":
    terminal();
    process.exitCode = 7;
    break;
  case "malformed-unknown-stderr":
    process.stdout.write("not-json\n");
    emit({ type: "future.event", future: { nested: 7 } });
    process.stderr.write("fixture stderr diagnostic\n");
    terminal();
    break;
  case "unknown-small":
    emit({ type: "future.event", future: { nested: 7 }, authorization: "Bearer SMALL_NATIVE_TOKEN" });
    terminal();
    break;
  case "unknown-large":
    emit({ type: "future.event", future: { large: "x".repeat(40 * 1024) } });
    terminal();
    break;
  case "unknown-truncated":
    emit({ type: "future.event", future: { large: "x".repeat(10 * 1024 * 1024 + 1024) } });
    terminal();
    break;
  case "unknown-large-repeated": {
    const record = { type: "future.event", future: { large: "x".repeat(40 * 1024) } };
    emit(record);
    emit(record);
    terminal();
    break;
  }
  case "stdin-echo": {
    const bytes = readFileSync(0);
    if (process.env.AGENTLENS_STDIN_CAPTURE) writeFileSync(process.env.AGENTLENS_STDIN_CAPTURE, bytes);
    emit({
      type: "item.completed",
      item: { id: "stdin-message", type: "agent_message", text: bytes.toString("base64"), status: "completed" }
    });
    terminal();
    break;
  }
  case "stdin-reject":
    closeSync(0);
    setTimeout(terminal, 100);
    break;
  case "commit":
    writeFileSync("tracked.txt", "child committed change\n");
    execFileSync("git", ["add", "tracked.txt"]);
    execFileSync("git", ["commit", "-qm", "fake child commit"]);
    terminal();
    break;
  case "branch-change":
    execFileSync("git", ["checkout", "-qb", "fake-child-branch"]);
    terminal();
    break;
  case "git-change":
    writeFileSync("tracked.txt", "child committed change\n");
    execFileSync("git", ["add", "tracked.txt"]);
    execFileSync("git", ["commit", "-qm", "fake child commit"]);
    execFileSync("git", ["checkout", "-qb", "fake-child-branch"]);
    emit({
      type: "item.completed",
      thread_id: "fixture-thread",
      turn_id: "fixture-turn",
      item: { id: "message-git-change", type: "agent_message", text: "git changed", status: "completed" }
    });
    terminal();
    break;
  case "source-identifiers":
    emit({
      type: "item.completed",
      session_id: "fixture-session",
      thread_id: "fixture-thread",
      turn_id: "fixture-turn",
      call_id: "fixture-correlation",
      item: {
        id: "fixture-item",
        tool_id: "fixture-tool",
        type: "mcp_tool_call",
        server: "fixture-server",
        tool: "fixture-tool-name",
        status: "completed"
      }
    });
    terminal();
    break;
  case "remove-git":
    terminal();
    rmSync(".git", { recursive: true, force: true });
    break;
  case "untracked":
    writeFileSync("fake-untracked.txt", "UNTRACKED_FAKE_CONTENT");
    terminal();
    break;
  case "invalid-utf8-index": {
    const invalidRawName = Buffer.concat([
      Buffer.from("NONUTF8_PATH_SENTINEL_"),
      Buffer.from([0xff]),
      Buffer.from("/.env")
    ]);
    const controlRawName = Buffer.from(".env/\nfile");
    const lineSeparatorRawName = Buffer.from(".env/\u2028file");
    const paragraphSeparatorRawName = Buffer.from(".env/\u2029file");
    const initialBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      input: Buffer.from("before\n"),
      encoding: "utf8"
    }).trim();
    execFileSync("git", ["update-index", "-z", "--index-info"], {
      input: Buffer.concat([
        Buffer.from(`100644 ${initialBlob}\t`), invalidRawName, Buffer.from([0]),
        Buffer.from(`100644 ${initialBlob}\t`), controlRawName, Buffer.from([0]),
        Buffer.from(`100644 ${initialBlob}\t`), lineSeparatorRawName, Buffer.from([0]),
        Buffer.from(`100644 ${initialBlob}\t`), paragraphSeparatorRawName, Buffer.from([0])
      ])
    });
    execFileSync("git", ["commit", "-qm", "raw path fixture"]);
    const invalidFinalBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      input: Buffer.from("INVALID_DETAIL_SECRET   \n"),
      encoding: "utf8"
    }).trim();
    const controlFinalBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      input: Buffer.from("CONTROL_DETAIL_SECRET   \n"),
      encoding: "utf8"
    }).trim();
    const lineSeparatorFinalBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      input: Buffer.from("LINE_SEPARATOR_DETAIL_SECRET   \n"),
      encoding: "utf8"
    }).trim();
    const paragraphSeparatorFinalBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      input: Buffer.from("PARAGRAPH_SEPARATOR_DETAIL_SECRET   \n"),
      encoding: "utf8"
    }).trim();
    execFileSync("git", ["update-index", "-z", "--index-info"], {
      input: Buffer.concat([
        Buffer.from(`100644 ${invalidFinalBlob}\t`), invalidRawName, Buffer.from([0]),
        Buffer.from(`100644 ${controlFinalBlob}\t`), controlRawName, Buffer.from([0]),
        Buffer.from(`100644 ${lineSeparatorFinalBlob}\t`), lineSeparatorRawName, Buffer.from([0]),
        Buffer.from(`100644 ${paragraphSeparatorFinalBlob}\t`), paragraphSeparatorRawName, Buffer.from([0])
      ])
    });
    execFileSync("git", ["update-index", "--skip-worktree", "-z", "--stdin"], {
      input: Buffer.concat([
        invalidRawName, Buffer.from([0]),
        controlRawName, Buffer.from([0]),
        lineSeparatorRawName, Buffer.from([0]),
        paragraphSeparatorRawName, Buffer.from([0])
      ])
    });
    terminal();
    break;
  }
  case "privacy":
    writeFileSync("tracked.txt", "Bearer STANDARD_TOKEN_SENTINEL\nMETADATA_DIFF_SENTINEL\n");
    writeFileSync(
      ".env.production",
      "ENV_DIFF_ARBITRARY_SENTINEL   \nTOKEN:123: ARBITRARY_DETAIL_SECRET   \n"
    );
    writeFileSync("+/.env", "PLUS_ENV_HEADER_SECRET   \n");
    writeFileSync(".env.SENSITIVE_PATH_SENTINEL with space", "UNTRACKED_CONTENT_SENTINEL\n");
    emit({
      type: "item.completed",
      item: {
        id: "privacy-message",
        type: "agent_message",
        text: "METADATA_MESSAGE_SENTINEL Bearer STANDARD_TOKEN_SENTINEL",
        status: "completed"
      },
      future: { native: "METADATA_NATIVE_SENTINEL" }
    });
    emit({
      type: "item.completed",
      item: {
        id: "privacy-command",
        type: "command_execution",
        command: "printf METADATA_COMMAND_SENTINEL",
        aggregated_output: "METADATA_OUTPUT_SENTINEL",
        exit_code: 0,
        status: "completed"
      }
    });
    process.stderr.write("METADATA_STDERR_SENTINEL\n");
    terminal();
    break;
  case "hang":
    started("hanging-command");
    if (process.env.AGENTLENS_FAKE_STARTED_FILE) {
      appendFileSync(process.env.AGENTLENS_FAKE_STARTED_FILE, "child-started\n");
    }
    setInterval(() => {}, 1_000);
    break;
  default:
    throw new Error(`Unknown fake mode ${mode}`);
}
