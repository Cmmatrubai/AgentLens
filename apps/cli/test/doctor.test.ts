import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  diagnoseDoctor,
  type DoctorCheck,
  type DoctorDependencies
} from "../src/doctor.js";
import { runDoctorCommand } from "../src/commands/doctor.js";

const summaries = {
  data_root: "Data root is present and protected.",
  sensitive_paths: "Sensitive storage paths are protected.",
  redaction_key: "Redaction key metadata is protected.",
  sqlite: "SQLite storage is current and healthy.",
  codex: "Codex is available.",
  process_groups: "POSIX process-group support is available.",
  loopback: "Loopback binding is available."
} as const;

function check(
  id: keyof typeof summaries,
  status: DoctorCheck["status"] = "pass",
  code = "ok"
): DoctorCheck {
  return {
    id,
    status,
    summary: summaries[id],
    metadata: { code }
  };
}

function writer() {
  let text = "";
  return {
    output: { write: (chunk: string | Uint8Array) => { text += String(chunk); return true; } },
    text: () => text
  };
}

function healthyDependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    storageChecks: async () => [
      check("sqlite"),
      check("data_root"),
      check("redaction_key"),
      check("sensitive_paths")
    ],
    codexVersion: async () => ({ state: "available", version: "1.2.3" }),
    processGroups: async () => ({ state: "posix" }),
    loopbackBind: async () => ({ close: async () => {} }),
    ...overrides
  };
}

describe("doctor diagnostics", () => {
  it("returns every check exactly once in the stable order", async () => {
    const result = await diagnoseDoctor("./fixture-doctor-root", healthyDependencies());

    expect(result).toEqual({
      schemaVersion: 1,
      overall: "pass",
      dataRoot: resolve("./fixture-doctor-root"),
      checks: [
        check("data_root"),
        check("sensitive_paths"),
        check("redaction_key"),
        check("sqlite"),
        { ...check("codex"), metadata: { code: "ok", version: "1.2.3" } },
        check("process_groups"),
        { ...check("loopback"), metadata: { code: "ok", host: "127.0.0.1" } }
      ]
    });
    expect(new Set(result.checks.map(({ id }) => id)).size).toBe(7);
  });

  it("applies fail-over-warn-over-pass precedence", async () => {
    const warned = await diagnoseDoctor("/tmp/doctor-warn", healthyDependencies({
      processGroups: async () => ({ state: "known_limitation" })
    }));
    expect(warned.overall).toBe("warn");

    const failed = await diagnoseDoctor("/tmp/doctor-fail", healthyDependencies({
      storageChecks: async () => [
        check("data_root"),
        check("sensitive_paths", "warn", "platform_unsupported"),
        check("redaction_key"),
        check("sqlite", "fail", "schema_older")
      ],
      processGroups: async () => ({ state: "known_limitation" })
    }));
    expect(failed.overall).toBe("fail");
  });

  it.each([
    ["available", { state: "available", version: "9.8.7-beta.1" }, "pass", "ok", 0],
    ["missing", { state: "missing" }, "fail", "executable_missing", 0],
    ["nonzero", { state: "nonzero", exitCode: 17, signal: null }, "fail", "nonzero_exit", 17],
    ["timeout", { state: "timeout", signal: 9 }, "fail", "timeout", 9],
    ["overflow", { state: "overflow", signal: 15 }, "fail", "output_overflow", 15],
    ["spawn failure", { state: "spawn_failed" }, "fail", "spawn_failed", 0],
    ["parse failure", { state: "invalid" }, "fail", "version_invalid", 0]
  ] as const)("maps bounded Codex %s outcomes without raw child output", async (
    _name,
    outcome,
    status,
    code,
    numericFact
  ) => {
    const result = await diagnoseDoctor("/tmp/doctor-codex", healthyDependencies({
      codexVersion: async () => outcome
    }));
    const codex = result.checks.find(({ id }) => id === "codex");

    expect(codex).toMatchObject({ status, metadata: { code } });
    if (outcome.state === "available") {
      expect(codex?.metadata).toEqual({ code, version: "9.8.7-beta.1" });
    } else if (numericFact !== 0) {
      expect(Object.values(codex?.metadata ?? {})).toContain(numericFact);
    }
    expect(JSON.stringify(result)).not.toContain("stdout");
    expect(JSON.stringify(result)).not.toContain("stderr");
  });

  it("converts Codex probe exceptions to a stable failure without exposing the exception", async () => {
    const result = await diagnoseDoctor("/tmp/doctor-codex-error", healthyDependencies({
      codexVersion: async () => {
        throw new Error("RAW_CODEX_EXCEPTION_SENTINEL /sensitive/path");
      }
    }));

    expect(result.checks.find(({ id }) => id === "codex")).toMatchObject({
      status: "fail",
      metadata: { code: "spawn_failed" }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_CODEX_EXCEPTION_SENTINEL");
    expect(JSON.stringify(result)).not.toContain("/sensitive/path");
  });

  it.each([
    [{ state: "posix" }, "pass", "ok"],
    [{ state: "fallback" }, "warn", "fallback"],
    [{ state: "known_limitation" }, "warn", "platform_unsupported"]
  ] as const)("maps the process-group probe %# without fabricating support", async (
    outcome,
    status,
    code
  ) => {
    const result = await diagnoseDoctor("/tmp/doctor-groups", healthyDependencies({
      processGroups: async () => outcome
    }));
    expect(result.checks.find(({ id }) => id === "process_groups")).toMatchObject({
      status,
      metadata: { code }
    });
  });

  it("turns process-group probe exceptions into a bounded warning", async () => {
    const result = await diagnoseDoctor("/tmp/doctor-groups-error", healthyDependencies({
      processGroups: async () => { throw new Error("GROUP_PROBE_RAW_SENTINEL"); }
    }));
    expect(result.checks.find(({ id }) => id === "process_groups")).toMatchObject({
      status: "warn",
      metadata: { code: "probe_failed" }
    });
    expect(JSON.stringify(result)).not.toContain("GROUP_PROBE_RAW_SENTINEL");
  });

  it("binds only 127.0.0.1 port zero and closes the listener on success", async () => {
    const close = vi.fn(async () => {});
    const bind = vi.fn(async () => ({ close }));

    const result = await diagnoseDoctor("/tmp/doctor-loopback", healthyDependencies({
      loopbackBind: bind
    }));

    expect(bind).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenCalledWith("127.0.0.1", 0);
    expect(close).toHaveBeenCalledOnce();
    expect(result.checks.find(({ id }) => id === "loopback")).toMatchObject({
      status: "pass",
      metadata: { code: "ok", host: "127.0.0.1" }
    });
  });

  it.each([
    ["bind", async () => { throw new Error("LOOPBACK_BIND_RAW_SENTINEL"); }, "bind_failed"],
    ["close", async () => ({
      close: async () => { throw new Error("LOOPBACK_CLOSE_RAW_SENTINEL"); }
    }), "close_failed"]
  ] as const)("maps loopback %s failure to a bounded warning", async (_name, bind, code) => {
    const result = await diagnoseDoctor("/tmp/doctor-loopback-error", healthyDependencies({
      loopbackBind: bind
    }));
    const serialized = JSON.stringify(result);
    expect(result.checks.find(({ id }) => id === "loopback")).toMatchObject({
      status: "warn",
      metadata: { code, host: "127.0.0.1" }
    });
    expect(serialized).not.toContain("LOOPBACK_BIND_RAW_SENTINEL");
    expect(serialized).not.toContain("LOOPBACK_CLOSE_RAW_SENTINEL");
  });

  it.each([
    ["pass", healthyDependencies(), 0],
    ["warn", healthyDependencies({
      processGroups: async () => ({ state: "known_limitation" })
    }), 0],
    ["fail", healthyDependencies({ codexVersion: async () => ({ state: "missing" }) }), 1]
  ] as const)("returns exit %i-compatible status for an overall %s result", async (
    _overall,
    dependencies,
    expectedExit
  ) => {
    const output = writer();
    const commandResult = await runDoctorCommand({
      name: "doctor",
      dataRoot: "/tmp/doctor-command",
      json: true
    }, { ...dependencies, stdout: output.output });

    expect(commandResult.exitCode).toBe(expectedExit);
    expect(JSON.parse(output.text())).toEqual(commandResult.result);
  });

  it("owns stable text formatting without exposing metadata diagnostics", async () => {
    const output = writer();
    const commandResult = await runDoctorCommand({
      name: "doctor",
      dataRoot: "/tmp/doctor-text",
      json: false
    }, { ...healthyDependencies({
      processGroups: async () => ({ state: "known_limitation" })
    }), stdout: output.output });

    expect(commandResult.exitCode).toBe(0);
    expect(output.text()).toBe([
      "AgentLens doctor: warn",
      "data_root: pass - Data root is present and protected.",
      "sensitive_paths: pass - Sensitive storage paths are protected.",
      "redaction_key: pass - Redaction key metadata is protected.",
      "sqlite: pass - SQLite storage is current and healthy.",
      "codex: pass - Codex is available.",
      "process_groups: warn - POSIX process-group support is limited.",
      "loopback: pass - Loopback binding is available.",
      ""
    ].join("\n"));
    expect(output.text()).not.toContain("9.8.7");
    expect(output.text()).not.toContain("/tmp/doctor-text");
  });
});
