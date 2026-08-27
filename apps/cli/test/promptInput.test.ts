import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { resolvePromptInput } from "../src/promptInput.js";

function stdinFrom(chunks: readonly Buffer[], isTTY: boolean): NodeJS.ReadStream {
  return Object.assign(Readable.from(chunks), { isTTY }) as unknown as NodeJS.ReadStream;
}

describe("Codex stdin handling", () => {
  it.each([
    ["explicit dash", ["codex", "exec", "--json", "-", "--fake-mode=stdin-echo"]],
    ["promptless piped prompt", ["codex", "exec", "--json", "--fake-mode=stdin-echo"]],
    [
      "argv prompt plus stdin context",
      ["codex", "exec", "--json", "argv prompt", "--fake-mode=stdin-echo"]
    ]
  ])("fully buffers and preserves non-TTY bytes for $name", async (_name, childArgs) => {
    const chunks = [
      Buffer.from([0x00, 0x66, 0x69, 0x78]),
      Buffer.from("ture\nsecond chunk\r\n", "utf8"),
      Buffer.from([0xff, 0x10])
    ];

    const result = await resolvePromptInput(childArgs, stdinFrom(chunks, false));

    expect(result).toEqual({
      mode: "buffered",
      source: "stdin",
      bytes: Buffer.concat(chunks)
    });
  });

  it("rejects explicit codex exec dash with TTY stdin", async () => {
    await expect(resolvePromptInput(
      ["codex", "exec", "--json", "-"],
      stdinFrom([], true)
    )).rejects.toThrow(/pipe input/i);
  });

  it("inherits other TTY stdin without reading it", async () => {
    const tty = stdinFrom([], true);
    await expect(resolvePromptInput(
      ["codex", "exec", "--json", "fixture prompt"],
      tty
    )).resolves.toEqual({ mode: "inherit", source: "tty" });
  });
});
