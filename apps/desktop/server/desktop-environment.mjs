import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
const execute = promisify(execFile);
export async function readDesktopEnvironment({
  storage,
  packaged = false,
  exec = execute,
}) {
  const definitions = [
    {
      id: "node",
      label: "Node.js",
      args: ["--version"],
      purpose: "Runs the recorder",
      accept: (v) => {
        const m = /^v(\d+)\.(\d+)\.\d+$/.exec(v);
        return !!m && (+m[1] > 22 || (+m[1] === 22 && +m[2] >= 12));
      },
      help: "Install Node.js 22.12 or newer, then reopen AgentLens.",
    },
    {
      id: "git",
      label: "Git",
      args: ["--version"],
      purpose: "Creates separate working copies",
      accept: (v) => /^git version \d+\./.test(v),
      help: "Install Git, then reopen AgentLens.",
    },
    {
      id: "codex",
      label: "Codex CLI",
      args: ["--version"],
      purpose: "Runs the coding agents",
      accept: (v) => /^codex(?:-cli)? \d+\./.test(v),
      help: "Install the Codex CLI, then use Check setup to verify compatibility and sign-in.",
    },
    {
      id: "pnpm",
      label: "pnpm",
      args: ["--config.manage-package-manager-versions=false", "--version"],
      purpose: "Optional dependency preparation",
      accept: (v) => /^11\.\d+\.\d+$/.test(v),
      help: "Dependency preparation currently needs pnpm 11. A project may require an exact version.",
    },
  ];
  const tools = await Promise.all(
    definitions.map(async (d) => {
      try {
        const r = await exec(d.id, d.args, {
          cwd: tmpdir(),
          timeout: 8000,
          maxBuffer: 4000,
          env: {
            PATH: process.env.PATH || "/usr/bin:/bin",
            HOME: process.env.HOME || tmpdir(),
            NPM_CONFIG_USERCONFIG: "/dev/null",
            NPM_CONFIG_GLOBALCONFIG: "/dev/null",
            COREPACK_ENABLE_NETWORK: "0",
            COREPACK_ENABLE_AUTO_PIN: "0",
          },
        });
        const v = r.stdout.trim();
        const version = /^[\w. ()+-]{1,100}$/.test(v) ? v : null;
        return {
          id: d.id,
          label: d.label,
          purpose: d.purpose,
          status: version && d.accept(version) ? "detected" : "unsupported",
          version,
          help: d.help,
        };
      } catch {
        return {
          id: d.id,
          label: d.label,
          purpose: d.purpose,
          status: "unavailable",
          version: null,
          help: d.help,
        };
      }
    }),
  );
  return { storage, packaged, platform: process.platform, tools };
}
