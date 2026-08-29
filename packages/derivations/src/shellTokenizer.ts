export interface SimpleCommand {
  readonly executable: string;
  readonly argv: readonly string[];
}

const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function tokenizeSimpleCommand(input: string): SimpleCommand | null {
  const words = tokenizeWords(input);
  if (words === null) return null;

  let index = 0;
  while (index < words.length && assignment.test(words[index]!)) index += 1;

  while (true) {
    if (words[index] === "env") {
      index += 1;
      if (words[index] === "--") {
        index += 1;
      } else if (words[index]?.startsWith("-")) {
        return null;
      }
      while (index < words.length && assignment.test(words[index]!)) index += 1;
      continue;
    }
    if (words[index] === "command") {
      index += 1;
      if (words[index]?.startsWith("-")) return null;
      continue;
    }
    break;
  }

  const executable = words[index];
  if (executable === undefined) return null;
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
