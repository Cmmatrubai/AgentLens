export type PromptInput =
  | Readonly<{ mode: "buffered"; source: "stdin"; bytes: Buffer }>
  | Readonly<{ mode: "inherit"; source: "tty" }>;

function usesExplicitStdinPrompt(childArgs: readonly string[]): boolean {
  return childArgs.slice(2).includes("-");
}

export async function resolvePromptInput(
  childArgs: readonly string[],
  stdin: NodeJS.ReadStream
): Promise<PromptInput> {
  if (stdin.isTTY) {
    if (usesExplicitStdinPrompt(childArgs)) {
      throw new Error("codex exec - requires non-TTY stdin; pipe input instead of using a TTY.");
    }
    return Object.freeze({ mode: "inherit" as const, source: "tty" as const });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk)));
  }
  return Object.freeze({
    mode: "buffered" as const,
    source: "stdin" as const,
    bytes: Buffer.concat(chunks)
  });
}
