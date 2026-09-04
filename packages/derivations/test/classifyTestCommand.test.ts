import { describe, expect, it } from "vitest";

import { classifyTestCommand } from "../src/classifyTestCommand.js";

const classify = (command: string) =>
  classifyTestCommand({ command, exitCode: 0, eventStatus: "completed" });

const expected = (
  family:
    | "pytest"
    | "jest"
    | "vitest"
    | "npm"
    | "pnpm"
    | "yarn"
    | "cargo"
    | "go"
    | "maven"
    | "gradle",
  confidence: "high" | "medium"
) => ({
  family,
  confidence,
  commandShape: "direct" as const,
  outcomeAttribution: "source_exit" as const,
  derivationVersion: "test-command/2" as const
});

describe("classifyTestCommand", () => {
  it.each([
    ["pytest", "pytest"],
    ["python -m pytest", "pytest"],
    ["python3 -m pytest", "pytest"],
    ["jest", "jest"],
    ["npx jest", "jest"],
    ["vitest", "vitest"],
    ["npx vitest", "vitest"],
    ["cargo test", "cargo"],
    ["go test", "go"],
    ["mvn test", "maven"],
    ["mvn -q -DskipTests=false test module", "maven"],
    ["env FOO=bar -- pytest -q", "pytest"],
    ["gradle test", "gradle"],
    ["./gradlew test", "gradle"]
  ] as const)("classifies direct %s commands", (command, family) => {
    expect(classify(command)).toEqual(expected(family, "high"));
  });

  it.each([
    ["npm test", "npm"],
    ["npm run test", "npm"],
    ["pnpm test", "pnpm"],
    ["pnpm run test", "pnpm"],
    ["yarn test", "yarn"],
    ["yarn run test", "yarn"]
  ] as const)("classifies exact package-manager test commands: %s", (command, family) => {
    expect(classify(command)).toEqual(expected(family, "high"));
  });

  it.each([
    ["npm run test:unit", "npm"],
    ["pnpm run test:unit", "pnpm"]
  ] as const)("classifies package-manager test scripts: %s", (command, family) => {
    expect(classify(command)).toEqual(expected(family, "medium"));
  });

  it.each([
    ["pnpm vitest --run packages/a.test.ts", "vitest"],
    ["pnpm exec vitest --run packages/a.test.ts", "vitest"],
    ["npm exec vitest --run packages/a.test.ts", "vitest"],
    ["pnpm jest --runInBand", "jest"],
    ["pnpm exec jest --runInBand", "jest"],
    ["npm exec jest --runInBand", "jest"]
  ] as const)("classifies direct test-runner entry points: %s", (command, family) => {
    expect(classify(command)).toEqual(expected(family, "high"));
  });

  it.each([
    [
      "/bin/zsh -lc \"rg pattern && pnpm vitest --run packages/a.test.ts\"",
      "vitest",
      "compound",
      "unavailable"
    ],
    [
      "/bin/zsh -lc \"pnpm vitest --run packages/a.test.ts && pnpm vitest -t 'content-free diagnostic'\"",
      "vitest",
      "compound",
      "unavailable"
    ],
    [
      "/bin/zsh -lc \"pnpm vitest -t 'content-free diagnostic' && pnpm typecheck\"",
      "vitest",
      "compound",
      "unavailable"
    ],
    [
      "/bin/zsh -lc \"pnpm vitest --run a.test.ts && pnpm vitest --run b.test.ts && pnpm typecheck && git diff --check && git status --short\"",
      "vitest",
      "compound",
      "unavailable"
    ],
    ["/bin/zsh -lc 'pnpm test'", "pnpm", "shell_wrapped", "source_exit"],
    [
      "/bin/zsh -lc \"pnpm vitest --run a.test.ts && pnpm vitest --run b.test.ts && pnpm typecheck && git diff --check\"",
      "vitest",
      "compound",
      "unavailable"
    ]
  ] as const)("classifies the sanitized T01-A1 shell envelope: %s", (command, family, commandShape, outcomeAttribution) => {
    expect(classify(command)).toEqual({
      family,
      confidence: "high",
      commandShape,
      outcomeAttribution,
      derivationVersion: "test-command/2"
    });
  });

  it("classifies the historical T01-A1 quoted-regex test command", () => {
    expect(classify("/bin/zsh -lc \"rg -n --glob '!sources/**' 'runChildProcess\\\\(|onLineTooLarge' apps/cli && pnpm vitest apps/cli/test/processRunner.test.ts packages/codex/test/lineDecoder.test.ts apps/cli/test/recordRun.integration.test.ts --run\"")).toEqual({
      family: "vitest",
      confidence: "high",
      commandShape: "compound",
      outcomeAttribution: "unavailable",
      derivationVersion: "test-command/2"
    });
  });

  it("treats single-quoted shell metacharacters as literal text", () => {
    expect(classify("sh -c \"rg 'needle;|<>()&' apps/cli && pnpm vitest --run packages/a.test.ts\"")).toEqual({
      family: "vitest",
      confidence: "high",
      commandShape: "compound",
      outcomeAttribution: "unavailable",
      derivationVersion: "test-command/2"
    });
  });

  it.each([
    "sh -c 'printf \"$HOME\" && pnpm vitest --run packages/a.test.ts'",
    "sh -c 'printf \"`pwd`\" && pnpm vitest --run packages/a.test.ts'"
  ])("rejects double-quoted shell expansion syntax: %s", (command) => {
    expect(classify(command)).toBeNull();
  });

  it.each([
    "sh -c 'pnpm vitest --run packages/a.test.ts; true'",
    "sh -c 'pnpm vitest --run packages/a.test.ts | cat'",
    "sh -c 'pnpm vitest --run packages/a.test.ts $(true)'",
    "sh -c 'pnpm vitest --run packages/a.test.ts `true`'"
  ])("rejects unquoted shell control syntax: %s", (command) => {
    expect(classify(command)).toBeNull();
  });

  it.each([
    "sh -c \"pnpm test && /usr/bin/zsh -c 'pnpm test'\"",
    "sh -c \"pnpm test && command /usr/bin/zsh -c 'pnpm test'\"",
    "sh -c \"pnpm test && env /usr/bin/zsh -c 'pnpm test'\"",
    "sh -c \"pnpm test && command /opt/homebrew/bin/bash -c 'pnpm test'\"",
    "sh -c \"pnpm test && /bin/dash -c 'pnpm test'\"",
    "sh -c \"pnpm test && command /bin/dash -c 'pnpm test'\"",
    "sh -c \"pnpm test && env /bin/fish -c 'pnpm test'\"",
    "sh -c \"pnpm test && busybox sh -c 'pnpm test'\"",
    "sh -c \"pnpm test && /bin/bash -c 'pnpm test'\"",
    "sh -c \"pnpm test && env /bin/bash -c 'pnpm test'\"",
    "sh -c \"pnpm test && /bin/fish -c 'pnpm test'\"",
    "sh -c \"pnpm test && command /bin/fish -c 'pnpm test'\"",
    "sh -c \"pnpm test && env /bin/dash -c 'pnpm test'\"",
    "sh -c \"pnpm test && busybox env sh -c 'pnpm test'\"",
    "sh -c \"pnpm test && busybox -- sh -c 'pnpm test'\"",
    "sh -c \"pnpm test && toybox sh -c 'pnpm test'\"",
    "sh -c \"pnpm test && exec /bin/dash -c 'pnpm test'\"",
    "sh -c \"pnpm test && dispatcher /usr/bin/zsh -c 'pnpm test'\"",
    "sh -c \"pnpm test && sudo -n /opt/homebrew/bin/bash -c 'pnpm test'\"",
    "sh -c \"pnpm test && wrapper --shell=/bin/fish -c 'pnpm test'\""
  ])("rejects shell-launch tokens in unrecognized compound segments: %s", (command) => {
    expect(classify(command)).toBeNull();
  });

  it.each([
    "sh -c \"pnpm test && busybox hush -c 'pnpm test'\"",
    "sh -c \"pnpm test && /usr/bin/rbash -c 'pnpm test'\"",
    "sh -c \"pnpm test && /bin/posh -c 'pnpm test'\"",
    "sh -c \"pnpm test && /bin/oksh -c 'pnpm test'\"",
    "sh -c \"pnpm test && /bin/loksh -c 'pnpm test'\"",
    "sh -c \"pnpm test && customsh -c 'pnpm test'\"",
    "sh -c \"pnpm test && /opt/tools/customshell.exe -c 'pnpm test'\"",
    "sh -c \"pnpm test && nu -c 'pnpm test'\"",
    "sh -c \"pnpm test && cmd.exe /c 'pnpm test'\""
  ])("rejects shell-like executable basenames in unrecognized compound segments: %s", (command) => {
    expect(classify(command)).toBeNull();
  });

  it("does not mistake harmless shell names in direct command arguments for a nested shell", () => {
    expect(classify("sh -c \"pnpm vitest -t zsh && pnpm test\"")).toEqual({
      family: "vitest",
      confidence: "high",
      commandShape: "compound",
      outcomeAttribution: "unavailable",
      derivationVersion: "test-command/2"
    });
  });

  it.each([
    "echo pytest",
    "cat jest-output.txt",
    "pytest-results.txt",
    "npm run contest",
    "pnpm run latest",
    "mvn --unknown test",
    "mvn --file test verify",
    "mvn -f test verify",
    "mvn --settings test verify",
    "pytest -q && echo done"
  ])("leaves non-exact or unsupported commands unclassified: %s", (command) => {
    expect(classify(command)).toBeNull();
  });

  it.each([
    "mvn -B -o -U -N -e -X -V -ntp -nsu -fae -ff -fn test",
    "mvn -f pom.xml -s settings.xml -gs global.xml -t toolchains.xml -T 2 -pl module -rf module -P ci -D skip=false -l build.log -b builder test",
    "mvn -DskipTests=false -Pci -T2 --file=pom.xml --settings=settings.xml --global-settings=global.xml --toolchains=toolchains.xml --threads=2 --projects=module --resume-from=module --activate-profiles=ci --define=skip=false --log-file=build.log --builder=builder test"
  ])("allows only frozen Maven options before its exact goal: %s", (command) => {
    expect(classify(command)).toEqual(expected("maven", "high"));
  });
});
