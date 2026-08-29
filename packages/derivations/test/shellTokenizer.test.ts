import { describe, expect, it } from "vitest";

import { tokenizeSimpleCommand } from "../src/shellTokenizer.js";

describe("tokenizeSimpleCommand", () => {
  it.each([
    ["pytest -q", { executable: "pytest", argv: ["pytest", "-q"] }],
    ["pytest\t-q", { executable: "pytest", argv: ["pytest", "-q"] }],
    ["pytest 'test unit.py'", { executable: "pytest", argv: ["pytest", "test unit.py"] }],
    ["pytest \"test unit.py\"", { executable: "pytest", argv: ["pytest", "test unit.py"] }],
    ["pytest test\\ file.py", { executable: "pytest", argv: ["pytest", "test file.py"] }],
    ["pytest -q # focused run", { executable: "pytest", argv: ["pytest", "-q"] }],
    ["A=1 B_two=value pytest -q", { executable: "pytest", argv: ["pytest", "-q"] }],
    ["A=1 env -- pytest -q", { executable: "pytest", argv: ["pytest", "-q"] }],
    ["env FOO=bar pytest -q", { executable: "pytest", argv: ["pytest", "-q"] }],
    ["command pytest -q", { executable: "pytest", argv: ["pytest", "-q"] }]
  ])("parses supported simple syntax: %s", (command, expected) => {
    expect(tokenizeSimpleCommand(command)).toEqual(expected);
  });

  it.each([
    "pytest -q; echo done",
    "pytest -q\necho done",
    "pytest -q && echo done",
    "pytest -q || echo done",
    "pytest -q | tee output",
    "pytest -q &",
    "pytest 'unterminated",
    "pytest \"unterminated",
    "echo `pytest`",
    "$(tool) pytest",
    "${TEST_RUNNER} -q",
    "pytest <(echo test)",
    "bash -lc 'pytest -q'",
    "sh -c 'pytest -q'",
    "env -S 'pytest -q'",
    "env -i pytest -q",
    "env -u HOME pytest -q",
    "env --unset=HOME pytest -q",
    "env --chdir /tmp pytest -q",
    "command -v pytest",
    "command -V pytest",
    "command -p pytest"
  ])("returns null for unsupported or evaluating syntax: %s", (command) => {
    expect(tokenizeSimpleCommand(command)).toBeNull();
  });
});
