import { tokenizeSimpleCommand } from "./shellTokenizer.js";
import type { ObservedCommand, TestCommandClassification } from "./types.js";

type Family = TestCommandClassification["family"];

const noOperandMavenOptions = new Set([
  "-q",
  "--quiet",
  "-B",
  "--batch-mode",
  "-o",
  "--offline",
  "-U",
  "--update-snapshots",
  "-N",
  "--non-recursive",
  "-e",
  "--errors",
  "-X",
  "--debug",
  "-V",
  "--show-version",
  "-ntp",
  "--no-transfer-progress",
  "-nsu",
  "--no-snapshot-updates",
  "-fae",
  "--fail-at-end",
  "-ff",
  "--fail-fast",
  "-fn",
  "--fail-never"
]);

const followingOperandMavenOptions = new Set([
  "-f",
  "--file",
  "-s",
  "--settings",
  "-gs",
  "--global-settings",
  "-t",
  "--toolchains",
  "-T",
  "--threads",
  "-pl",
  "--projects",
  "-rf",
  "--resume-from",
  "-P",
  "--activate-profiles",
  "-D",
  "--define",
  "-l",
  "--log-file",
  "-b",
  "--builder"
]);

const attachedLongMavenOptions = [
  "--file=",
  "--settings=",
  "--global-settings=",
  "--toolchains=",
  "--threads=",
  "--projects=",
  "--resume-from=",
  "--activate-profiles=",
  "--define=",
  "--log-file=",
  "--builder="
] as const;

const recognizers: readonly ((argv: readonly string[]) => TestCommandClassification | null)[] = [
  recognizePytest,
  recognizeJest,
  recognizeVitest,
  recognizeNpm,
  recognizePnpm,
  recognizeYarn,
  recognizeCargo,
  recognizeGo,
  recognizeMaven,
  recognizeGradle
];

export function classifyTestCommand(
  input: ObservedCommand
): TestCommandClassification | null {
  const parsed = tokenizeSimpleCommand(input.command);
  if (parsed === null) return null;
  for (const recognize of recognizers) {
    const classification = recognize(parsed.argv);
    if (classification !== null) return classification;
  }
  return null;
}

function classification(
  family: Family,
  confidence: TestCommandClassification["confidence"]
): TestCommandClassification {
  return { family, confidence, derivationVersion: "test-command/1" };
}

function recognizePytest(argv: readonly string[]): TestCommandClassification | null {
  if (argv[0] === "pytest" || ((argv[0] === "python" || argv[0] === "python3") && argv[1] === "-m" && argv[2] === "pytest")) {
    return classification("pytest", "high");
  }
  return null;
}

function recognizeJest(argv: readonly string[]): TestCommandClassification | null {
  return argv[0] === "jest" || (argv[0] === "npx" && argv[1] === "jest")
    ? classification("jest", "high")
    : null;
}

function recognizeVitest(argv: readonly string[]): TestCommandClassification | null {
  return argv[0] === "vitest" || (argv[0] === "npx" && argv[1] === "vitest")
    ? classification("vitest", "high")
    : null;
}

function recognizeNpm(argv: readonly string[]): TestCommandClassification | null {
  return recognizePackageManager(argv, "npm");
}

function recognizePnpm(argv: readonly string[]): TestCommandClassification | null {
  return recognizePackageManager(argv, "pnpm");
}

function recognizePackageManager(
  argv: readonly string[],
  family: "npm" | "pnpm"
): TestCommandClassification | null {
  if (argv[0] !== family) return null;
  if (argv[1] === "test" || (argv[1] === "run" && argv[2] === "test")) {
    return classification(family, "high");
  }
  if (argv[1] === "run" && isTestScript(argv[2])) {
    return classification(family, "medium");
  }
  return null;
}

function isTestScript(value: string | undefined): boolean {
  return value === "test" || (value?.startsWith("test:") ?? false);
}

function recognizeYarn(argv: readonly string[]): TestCommandClassification | null {
  return argv[0] === "yarn" && (argv[1] === "test" || (argv[1] === "run" && argv[2] === "test"))
    ? classification("yarn", "high")
    : null;
}

function recognizeCargo(argv: readonly string[]): TestCommandClassification | null {
  return argv[0] === "cargo" && argv[1] === "test" ? classification("cargo", "high") : null;
}

function recognizeGo(argv: readonly string[]): TestCommandClassification | null {
  return argv[0] === "go" && argv[1] === "test" ? classification("go", "high") : null;
}

function recognizeMaven(argv: readonly string[]): TestCommandClassification | null {
  if (argv[0] !== "mvn") return null;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "test") return classification("maven", "high");
    if (noOperandMavenOptions.has(token)) continue;
    if (followingOperandMavenOptions.has(token)) {
      if (argv[index + 1] === undefined) return null;
      index += 1;
      continue;
    }
    if (isAttachedMavenValue(token)) continue;
    return null;
  }
  return null;
}

function isAttachedMavenValue(token: string): boolean {
  if ((token.startsWith("-D") || token.startsWith("-P") || token.startsWith("-T")) && token.length > 2) {
    return true;
  }
  return attachedLongMavenOptions.some(
    (option) => token.startsWith(option) && token.length > option.length
  );
}

function recognizeGradle(argv: readonly string[]): TestCommandClassification | null {
  return (argv[0] === "gradle" || argv[0] === "./gradlew") && argv[1] === "test"
    ? classification("gradle", "high")
    : null;
}
