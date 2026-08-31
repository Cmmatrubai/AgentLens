#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { main } from "./main.js";

const execFile = promisify(execFileCallback);
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const argv = process.argv.slice(2);
const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;

if (normalizedArgv[0] === "ui") {
  await execFile("pnpm", ["--filter", "@agentlens/web", "build"], {
    cwd: workspaceRoot,
    shell: false
  });
}
process.exitCode = await main(argv);
