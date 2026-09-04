import { tokenizeShellEnvelope, tokenizeSimpleCommand } from "./shellTokenizer.js";
import type { ObservedCommand, TestCommandClassification } from "./types.js";

type Family = TestCommandClassification["family"];
type RecognizedTestCommand = Readonly<{
  family: Family;
  confidence: TestCommandClassification["confidence"];
}>;

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

const recognizers: readonly ((argv: readonly string[]) => RecognizedTestCommand | null)[] = [
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
  if (parsed !== null) {
    const recognized = recognize(parsed.argv);
    if (recognized !== null) return completeClassification(recognized, "direct");
  }

  const envelope = tokenizeShellEnvelope(input.command);
  if (envelope === null) return null;
  let firstRecognized: RecognizedTestCommand | null = null;
  for (const segment of envelope.segments) {
    const segmentCommand = tokenizeSimpleCommand(segment);
    if (segmentCommand === null || isShellCommand(segmentCommand.executable)) return null;
    const recognized = recognize(segmentCommand.argv);
    if (firstRecognized === null && recognized !== null) firstRecognized = recognized;
  }
  if (firstRecognized === null) return null;
  return completeClassification(
    firstRecognized,
    envelope.compound ? "compound" : "shell_wrapped"
  );
}

function recognize(
  argv: readonly string[]
): RecognizedTestCommand | null {
  for (const recognizer of recognizers) {
    const recognized = recognizer(argv);
    if (recognized !== null) return recognized;
  }
  return null;
}

function completeClassification(
  recognized: RecognizedTestCommand,
  commandShape: TestCommandClassification["commandShape"]
): TestCommandClassification {
  return {
    ...recognized,
    commandShape,
    outcomeAttribution: commandShape === "compound" ? "unavailable" : "source_exit",
    derivationVersion: "test-command/2"
  };
}

function classification(
  family: Family,
  confidence: TestCommandClassification["confidence"]
): RecognizedTestCommand {
  return { family, confidence };
}

function recognizePytest(argv: readonly string[]): RecognizedTestCommand | null {
  if (argv[0] === "pytest" || ((argv[0] === "python" || argv[0] === "python3") && argv[1] === "-m" && argv[2] === "pytest")) {
    return classification("pytest", "high");
  }
  return null;
}

function recognizeJest(argv: readonly string[]): RecognizedTestCommand | null {
  return argv[0] === "jest" || (argv[0] === "npx" && argv[1] === "jest") ||
    packageManagerRuns(argv, "jest")
    ? classification("jest", "high")
    : null;
}

function recognizeVitest(argv: readonly string[]): RecognizedTestCommand | null {
  return argv[0] === "vitest" || (argv[0] === "npx" && argv[1] === "vitest") ||
    packageManagerRuns(argv, "vitest")
    ? classification("vitest", "high")
    : null;
}

function packageManagerRuns(argv: readonly string[], runner: "jest" | "vitest"): boolean {
  return (argv[0] === "pnpm" && (argv[1] === runner || (argv[1] === "exec" && argv[2] === runner))) ||
    (argv[0] === "npm" && argv[1] === "exec" && argv[2] === runner);
}

function isShellCommand(executable: string): boolean {
  return executable === "sh" || executable === "bash" || executable === "zsh" ||
    executable === "/bin/sh" || executable === "/bin/bash" || executable === "/bin/zsh";
}

function recognizeNpm(argv: readonly string[]): RecognizedTestCommand | null {
  return recognizePackageManager(argv, "npm");
}

function recognizePnpm(argv: readonly string[]): RecognizedTestCommand | null {
  return recognizePackageManager(argv, "pnpm");
}

function recognizePackageManager(
  argv: readonly string[],
  family: "npm" | "pnpm"
): RecognizedTestCommand | null {
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

function recognizeYarn(argv: readonly string[]): RecognizedTestCommand | null {
  return argv[0] === "yarn" && (argv[1] === "test" || (argv[1] === "run" && argv[2] === "test"))
    ? classification("yarn", "high")
    : null;
}

function recognizeCargo(argv: readonly string[]): RecognizedTestCommand | null {
  return argv[0] === "cargo" && argv[1] === "test" ? classification("cargo", "high") : null;
}

function recognizeGo(argv: readonly string[]): RecognizedTestCommand | null {
  return argv[0] === "go" && argv[1] === "test" ? classification("go", "high") : null;
}

function recognizeMaven(argv: readonly string[]): RecognizedTestCommand | null {
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

function recognizeGradle(argv: readonly string[]): RecognizedTestCommand | null {
  return (argv[0] === "gradle" || argv[0] === "./gradlew") && argv[1] === "test"
    ? classification("gradle", "high")
    : null;
}
