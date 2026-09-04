export interface SimpleCommand {
  readonly executable: string;
  readonly argv: readonly string[];
}

export interface ShellEnvelope {
  readonly segments: readonly string[];
  readonly compound: boolean;
}

const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

const supportedShells = new Set([
  "sh",
  "bash",
  "zsh",
  "/bin/sh",
  "/bin/bash",
  "/bin/zsh"
]);

const supportedShellOptions = new Set(["-c", "-lc", "-cl"]);

export function tokenizeShellEnvelope(input: string): ShellEnvelope | null {
  const outer = tokenizeWords(input);
  if (
    outer === null ||
    outer.length !== 3 ||
    !supportedShells.has(outer[0]!) ||
    !supportedShellOptions.has(outer[1]!)
  ) return null;

  return splitShellBody(outer[2]!);
}

function splitShellBody(input: string): ShellEnvelope | null {
  const segments: string[] = [];
  let segment = "";
  let state: "unquoted" | "single" | "double" = "unquoted";

  const finishSegment = (): boolean => {
    const trimmed = segment.trim();
    if (trimmed.length === 0) return false;
    segments.push(trimmed);
    segment = "";
    return true;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (state === "single") {
      if (character === "'") state = "unquoted";
      segment += character;
      continue;
    }
    if (state === "double") {
      if (character === "\\") {
        const escaped = input[++index];
        if (escaped === undefined || escaped === "\n" || escaped === "\r") return null;
        segment += character + escaped;
        continue;
      }
      if (character === "\n" || character === "\r" || character === "$" || character === "`") {
        return null;
      }
      if (character === "\"") state = "unquoted";
      segment += character;
      continue;
    }
    if (character === "\\") {
      const escaped = input[++index];
      if (escaped === undefined || escaped === "\n" || escaped === "\r") return null;
      segment += character + escaped;
      continue;
    }
    if (character === "\n" || character === "\r" || character === "$" || character === "`") {
      return null;
    }
    if (character === "'") {
      state = "single";
      segment += character;
      continue;
    }
    if (character === "\"") {
      state = "double";
      segment += character;
      continue;
    }
    if (";|<>()".includes(character)) return null;
    if (character === "&") {
      if (input[index + 1] !== "&" || !finishSegment()) return null;
      index += 1;
      continue;
    }
    segment += character;
  }

  if (state !== "unquoted" || !finishSegment()) return null;
  return { segments, compound: segments.length > 1 };
}

export function tokenizeSimpleCommand(input: string): SimpleCommand | null {
  const words = tokenizeWords(input);
  if (words === null) return null;

  let index = 0;
  while (index < words.length && assignment.test(words[index]!)) index += 1;

  if (words[index] === "command") {
    index += 1;
    if (words[index] === "--") index += 1;
    else if (words[index]?.startsWith("-")) return null;
  }

  if (words[index] === "env") {
    index += 1;
    while (index < words.length && assignment.test(words[index]!)) index += 1;
    if (words[index] === "--") index += 1;
    else if (words[index]?.startsWith("-")) return null;
    if (words[index] === undefined || assignment.test(words[index]!) || words[index] === "command") {
      return null;
    }
  }

  const executable = words[index];
  if (executable === undefined || executable === "command") return null;
  const argv = words.slice(index);
  if (
    (executable === "bash" || executable === "sh") &&
    argv.slice(1).some((argument) => argument.startsWith("-") && argument.includes("c"))
  ) {
    return null;
  }
  return { executable, argv };
}

function tokenizeWords(input: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let state: "unquoted" | "single" | "double" = "unquoted";

  const finishWord = (): void => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (state === "single") {
      if (character === "'") state = "unquoted";
      else word += character;
      continue;
    }
    if (state === "double") {
      if (character === "\"") {
        state = "unquoted";
      } else if (character === "\\") {
        const escaped = input[++index];
        if (escaped === undefined || escaped === "\n" || !['\\', '\"', '$', '`'].includes(escaped)) return null;
        word += escaped;
      } else if (character === "$" || character === "`") {
        return null;
      } else {
        word += character;
      }
      continue;
    }

    if (character === "'" || character === "\"") {
      state = character === "'" ? "single" : "double";
      inWord = true;
    } else if (character === "\\") {
      const escaped = input[++index];
      if (escaped === undefined || escaped === "\n") return null;
      word += escaped;
      inWord = true;
    } else if (character === " " || character === "\t" || character === "\r") {
      finishWord();
    } else if (character === "#" && !inWord) {
      break;
    } else if (";\n&|`$<>()".includes(character)) {
      return null;
    } else {
      word += character;
      inWord = true;
    }
  }

  if (state !== "unquoted") return null;
  finishWord();
  return words.length === 0 ? null : words;
}
