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
) => ({ family, confidence, derivationVersion: "test-command/1" as const });

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
