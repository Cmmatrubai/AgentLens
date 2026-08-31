import { TextDecoder } from "node:util";

import { gitDiffContentV1Schema, type GitDiffContentV1 } from "@agentlens/api-contract";

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/;
const EXCLUSION = /^\[\[EXCLUDED:[a-z0-9._-]{1,128}\]\]$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const MAX_FILE_HEADERS = 64;
const MAX_FILE_METADATA = 1_000;

function decodeGitQuoted(value: string): string {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"')) throw new Error("Malformed quoted Git path.");
  const output: Buffer[] = [];
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]!;
    if (character !== "\\") {
      const codePoint = value.codePointAt(index)!;
      output.push(Buffer.from(String.fromCodePoint(codePoint), "utf8"));
      if (codePoint > 0xffff) index += 1;
      continue;
    }
    const escaped = value[++index];
    if (escaped === undefined || index >= value.length - 1) throw new Error("Malformed quoted Git path.");
    const simple: Readonly<Record<string, string>> = {
      a: "\u0007", b: "\b", t: "\t", n: "\n", v: "\u000b", f: "\f", r: "\r",
      '"': '"', "\\": "\\"
    };
    if (simple[escaped] !== undefined) {
      output.push(Buffer.from(simple[escaped], "utf8"));
      continue;
    }
    if (/^[0-7]$/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /^[0-7]$/.test(value[index + 1] ?? "")) octal += value[++index]!;
      output.push(Buffer.from([Number.parseInt(octal, 8)]));
      continue;
    }
    throw new Error("Malformed quoted Git path.");
  }
  try {
    return UTF8.decode(Buffer.concat(output));
  } catch {
    throw new Error("Malformed quoted Git path.");
  }
}

function tokens(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (!quoted && character === " ") {
      if (current.length > 0) result.push(current);
      current = "";
      continue;
    }
    current += character;
    if (quoted && escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
  }
  if (quoted) throw new Error("Malformed quoted Git path.");
  if (current.length > 0) result.push(current);
  return result;
}

function pathToken(value: string): string {
  const decoded = decodeGitQuoted(value);
  return decoded.startsWith("a/") || decoded.startsWith("b/") ? decoded.slice(2) : decoded;
}

type MetadataType = GitDiffContentV1["files"][number]["metadata"][number]["type"];

function metadataType(line: string): MetadataType | null {
  if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) return "binary";
  if (line.startsWith("rename from ")) return "rename_from";
  if (line.startsWith("rename to ")) return "rename_to";
  if (line.startsWith("copy from ")) return "copy_from";
  if (line.startsWith("copy to ")) return "copy_to";
  if (line.startsWith("similarity index ")) return "similarity";
  if (line.startsWith("dissimilarity index ")) return "dissimilarity";
  if (/^(?:old|new|deleted file|new file) mode /.test(line)) return "mode";
  if (line.startsWith("index ")) return "index";
  if (EXCLUSION.test(line)) return "excluded";
  return null;
}

export function parseGitDiff(text: string, truncated: boolean): GitDiffContentV1 {
  if (text.length === 0) return gitDiffContentV1Schema.parse({
    schemaVersion: 1, kind: "diff", files: [], preamble: [], truncated, malformed: false
  });
  const files: Array<{
    oldPath: string;
    newPath: string;
    headers: string[];
    metadata: Array<{ type: MetadataType; text: string }>;
    hunks: Array<{
      header: string;
      oldStart: number;
      oldCount: number;
      newStart: number;
      newCount: number;
      lines: Array<{
        type: "context" | "add" | "delete" | "excluded" | "no_newline";
        oldLineNumber: number | null;
        newLineNumber: number | null;
        text: string;
      }>;
    }>;
  }> = [];
  const preamble: string[] = [];
  let current: typeof files[number] | undefined;
  let hunk: typeof files[number]["hunks"][number] | undefined;
  let oldLine = 0;
  let newLine = 0;
  let consumedOld = 0;
  let consumedNew = 0;
  let hasOldHeader = false;
  let hasNewHeader = false;
  let inBinaryPatch = false;
  let malformed = false;

  const closeHunk = (allowTruncatedIncomplete: boolean): void => {
    if (hunk === undefined) return;
    const exact = consumedOld === hunk.oldCount && consumedNew === hunk.newCount;
    const incomplete = consumedOld <= hunk.oldCount && consumedNew <= hunk.newCount;
    if (!exact && !(allowTruncatedIncomplete && incomplete)) malformed = true;
    hunk = undefined;
    consumedOld = 0;
    consumedNew = 0;
  };

  const closeFile = (allowTruncatedFinalHunk: boolean): void => {
    closeHunk(allowTruncatedFinalHunk);
    if (current !== undefined && hasOldHeader !== hasNewHeader) malformed = true;
    inBinaryPatch = false;
  };

  const pushMetadata = (type: MetadataType, line: string): void => {
    if (current === undefined) return;
    if (current.metadata.length >= MAX_FILE_METADATA) {
      malformed = true;
      return;
    }
    current.metadata.push({ type, text: line });
  };

  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith("diff --git ")) {
      closeFile(false);
      try {
        const pair = tokens(line.slice("diff --git ".length));
        if (pair.length !== 2) throw new Error("Malformed diff header.");
        const oldPath = pathToken(pair[0]!);
        const newPath = pathToken(pair[1]!);
        if (line.length > 8_192 || oldPath.length === 0 || oldPath.length > 4_096 ||
            newPath.length === 0 || newPath.length > 4_096) {
          throw new Error("Diff header exceeds response bounds.");
        }
        current = {
          oldPath,
          newPath,
          headers: [line],
          metadata: [],
          hunks: []
        };
        files.push(current);
        hasOldHeader = false;
        hasNewHeader = false;
        inBinaryPatch = false;
      } catch {
        malformed = true;
        preamble.push(line);
        current = undefined;
        hasOldHeader = false;
        hasNewHeader = false;
        inBinaryPatch = false;
      }
      continue;
    }
    if (current === undefined) {
      preamble.push(line);
      if (!EXCLUSION.test(line)) malformed = true;
      continue;
    }
    if (inBinaryPatch) {
      pushMetadata("binary", line);
      continue;
    }
    if (hunk !== undefined && line.startsWith("\\ No newline")) {
      hunk.lines.push({
        type: "no_newline", oldLineNumber: null, newLineNumber: null,
        text: line.replace(/^\\\s*/, "")
      });
      continue;
    }
    if (hunk !== undefined && [" ", "+", "-"].includes(line[0] ?? "")) {
      const prefix = line[0]!;
      const content = line.slice(1);
      const consumesOld = prefix === " " || prefix === "-";
      const consumesNew = prefix === " " || prefix === "+";
      if (
        (consumesOld && consumedOld >= hunk.oldCount) ||
        (consumesNew && consumedNew >= hunk.newCount)
      ) {
        malformed = true;
        continue;
      }
      if (prefix === " ") {
        hunk.lines.push({ type: "context", oldLineNumber: oldLine++, newLineNumber: newLine++, text: content });
      } else if (prefix === "+") {
        hunk.lines.push({
          type: EXCLUSION.test(content) ? "excluded" : "add",
          oldLineNumber: null,
          newLineNumber: newLine++,
          text: content
        });
      } else {
        hunk.lines.push({ type: "delete", oldLineNumber: oldLine++, newLineNumber: null, text: content });
      }
      if (consumesOld) consumedOld += 1;
      if (consumesNew) consumedNew += 1;
      continue;
    }

    const header = HUNK.exec(line);
    if (header !== null) {
      closeHunk(false);
      if (!hasOldHeader || !hasNewHeader) malformed = true;
      hunk = {
        header: line,
        oldStart: Number(header[1]),
        oldCount: Number(header[2] ?? "1"),
        newStart: Number(header[3]),
        newCount: Number(header[4] ?? "1"),
        lines: []
      };
      current.hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      consumedOld = 0;
      consumedNew = 0;
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      closeHunk(false);
      if (current.headers.length >= MAX_FILE_HEADERS) malformed = true;
      else current.headers.push(line);
      try {
        const parsed = pathToken(line.slice(4));
        if (line.startsWith("--- ")) {
          if (hasOldHeader || hasNewHeader) malformed = true;
          current.oldPath = parsed;
          hasOldHeader = true;
        } else {
          if (!hasOldHeader || hasNewHeader) malformed = true;
          current.newPath = parsed;
          hasNewHeader = true;
        }
      } catch {
        malformed = true;
      }
      continue;
    }

    closeHunk(false);
    const fallback = metadataType(line);
    if (fallback !== null) {
      pushMetadata(fallback, line);
      if (line.startsWith("GIT binary patch")) inBinaryPatch = true;
    }
    else {
      pushMetadata("other", line);
      malformed = true;
    }
  }

  closeFile(truncated);

  return gitDiffContentV1Schema.parse({
    schemaVersion: 1,
    kind: "diff",
    files,
    preamble,
    truncated,
    malformed
  });
}
