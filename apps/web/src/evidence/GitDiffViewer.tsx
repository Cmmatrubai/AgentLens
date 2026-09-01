import type { GitDiffContentV1 } from "@agentlens/api-contract";
import { useState } from "react";

import { AvailabilityNotice, type AvailabilityState } from "./AvailabilityNotice.js";

export type GitDiffEvidence =
  | Readonly<{ state: "available"; value: GitDiffContentV1 }>
  | Readonly<{ state: "unavailable"; reason: AvailabilityState }>;

const linePageSize = 400;

function lineLabel(line: GitDiffContentV1["files"][number]["hunks"][number]["lines"][number]): string {
  switch (line.type) {
    case "context": return `Context line ${line.oldLineNumber} → ${line.newLineNumber}`;
    case "add": return `Added line ${line.newLineNumber}`;
    case "delete": return `Deleted line ${line.oldLineNumber}`;
    case "excluded": return `Excluded sensitive evidence at new line ${line.newLineNumber}`;
    case "no_newline": return "No-newline marker";
  }
}

function prefix(type: GitDiffContentV1["files"][number]["hunks"][number]["lines"][number]["type"]): string {
  if (type === "add" || type === "excluded") return "+";
  if (type === "delete") return "-";
  if (type === "no_newline") return "\\";
  return " ";
}

export function GitDiffViewer(props: Readonly<{ evidence: GitDiffEvidence }>) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [visibleLines, setVisibleLines] = useState<Readonly<Record<number, number>>>({});
  if (props.evidence.state === "unavailable") {
    return <AvailabilityNotice state={props.evidence.reason} />;
  }
  const value = props.evidence.value;
  if (value.malformed) {
    return <p className="availability-notice availability-notice--corrupt" role="status">Structured diff is malformed or corrupt.</p>;
  }
  if (value.files.length === 0 && value.preamble.length === 0) {
    return <p className="git-diff__empty">Tracked final diff is empty.</p>;
  }
  return (
    <section className="git-diff" aria-label="Structured tracked final diff">
      {value.truncated && <AvailabilityNotice state="truncated" />}
      {value.preamble.length > 0 && (
        <TextPreamble lines={value.preamble} />
      )}
      {value.files.map((file, fileIndex) => {
        const isExpanded = expanded.has(fileIndex);
        const totalLines = file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
        const limit = visibleLines[fileIndex] ?? linePageSize;
        let consumed = 0;
        return (
          <section
            className="git-diff__file"
            role="group"
            aria-label={`Diff file ${file.newPath}`}
            key={`${file.oldPath}:${file.newPath}:${fileIndex}`}
          >
            <button
              type="button"
              className="git-diff__file-toggle"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${file.newPath}`}
              onClick={() => setExpanded((current) => {
                const next = new Set(current);
                next.has(fileIndex) ? next.delete(fileIndex) : next.add(fileIndex);
                return next;
              })}
            >
              <span>{file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`}</span>
              <span>{file.hunks.length} hunks · {totalLines} lines</span>
            </button>
            {isExpanded && (
              <div className="git-diff__file-body">
                {file.headers.map((header, index) => <code key={`${header}:${index}`}>{header}</code>)}
                {file.metadata.map((metadata, index) => (
                  <p className={`git-diff__metadata git-diff__metadata--${metadata.type}`} key={`${metadata.type}:${index}`}>
                    <span className="sr-only">{metadata.type.replaceAll("_", " ")} metadata: </span>{metadata.text}
                  </p>
                ))}
                <div className="git-diff__code-scroll" tabIndex={0}>
                  {file.hunks.map((hunk, hunkIndex) => {
                    const remaining = Math.max(0, limit - consumed);
                    const lines = hunk.lines.slice(0, remaining);
                    consumed += hunk.lines.length;
                    return (
                      <section className="git-diff__hunk" key={`${hunk.header}:${hunkIndex}`}>
                        <h5>{hunk.header}</h5>
                        <ol>
                          {lines.map((line, lineIndex) => (
                            <li
                              className={`git-diff__line git-diff__line--${line.type}`}
                              data-diff-line
                              key={`${line.type}:${line.oldLineNumber}:${line.newLineNumber}:${lineIndex}`}
                            >
                              <span className="sr-only">{lineLabel(line)}</span>
                              <span aria-hidden="true" className="git-diff__number">{line.oldLineNumber ?? ""}</span>
                              <span aria-hidden="true" className="git-diff__number">{line.newLineNumber ?? ""}</span>
                              <code><span aria-hidden="true">{prefix(line.type)}</span>{line.text}</code>
                            </li>
                          ))}
                        </ol>
                      </section>
                    );
                  })}
                </div>
                {totalLines > limit && (
                  <button
                    type="button"
                    onClick={() => setVisibleLines((current) => ({
                      ...current,
                      [fileIndex]: Math.min(totalLines, limit + linePageSize)
                    }))}
                  >Show next {Math.min(linePageSize, totalLines - limit)} diff lines</button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}

function TextPreamble(props: Readonly<{ lines: readonly string[] }>) {
  return (
    <pre className="git-diff__preamble" tabIndex={0}>
      <code>{props.lines.join("\n")}</code>
    </pre>
  );
}
