import type { GitDiffContentV1 } from "@agentlens/api-contract";
import { useState } from "react";

import { AvailabilityNotice, type AvailabilityState } from "./AvailabilityNotice.js";

export type GitDiffEvidence =
  | Readonly<{ state: "available"; value: GitDiffContentV1 }>
  | Readonly<{ state: "unavailable"; reason: AvailabilityState }>;

export interface GitDiffViewState {
  readonly expanded: readonly number[];
  readonly visibleLines: Readonly<Record<number, number>>;
  readonly filePage: number;
}

export const initialGitDiffViewState: GitDiffViewState = Object.freeze({
  expanded: Object.freeze([]), visibleLines: Object.freeze({}), filePage: 0
});

const linePageSize = 400;
const filePageSize = 50;
const globalHunkBudget = 100;
const globalStructureBudget = 200;

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

export function GitDiffViewer(props: Readonly<{
  evidence: GitDiffEvidence;
  viewState?: GitDiffViewState;
  onViewStateChange?: (state: GitDiffViewState) => void;
}>) {
  const [internalViewState, setInternalViewState] = useState<GitDiffViewState>(initialGitDiffViewState);
  const viewState = props.viewState ?? internalViewState;
  const expanded = new Set(viewState.expanded);
  const visibleLines = viewState.visibleLines;
  const filePage = viewState.filePage;
  const updateViewState = (next: GitDiffViewState): void => {
    setInternalViewState(next);
    props.onViewStateChange?.(next);
  };
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
  const firstFile = filePage * filePageSize;
  const visibleFiles = value.files.slice(firstFile, firstFile + filePageSize);
  let remainingLines = linePageSize;
  let remainingHunks = globalHunkBudget;
  let remainingStructure = globalStructureBudget;
  return (
    <section className="git-diff" aria-label="Structured tracked final diff">
      {value.truncated && <AvailabilityNotice state="truncated" />}
      {value.preamble.length > 0 && (
        <TextPreamble lines={value.preamble} />
      )}
      {visibleFiles.map((file, visibleIndex) => {
        const fileIndex = firstFile + visibleIndex;
        const isExpanded = expanded.has(fileIndex);
        const totalLines = file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
        const offset = visibleLines[fileIndex] ?? 0;
        const headers = isExpanded ? file.headers.slice(0, remainingStructure) : [];
        remainingStructure -= headers.length;
        const metadata = isExpanded ? file.metadata.slice(0, remainingStructure) : [];
        remainingStructure -= metadata.length;
        let position = 0;
        let renderedLineCount = 0;
        const hunks: Array<{
          hunk: (typeof file.hunks)[number];
          hunkIndex: number;
          lines: (typeof file.hunks)[number]["lines"];
        }> = [];
        if (isExpanded) {
          for (const [hunkIndex, hunk] of file.hunks.entries()) {
            const nextPosition = position + hunk.lines.length;
            if (nextPosition <= offset) {
              position = nextPosition;
              continue;
            }
            if (remainingHunks <= 0 || remainingStructure <= 0 || remainingLines <= 0) break;
            const start = Math.max(0, offset - position);
            const lines = hunk.lines.slice(start, start + remainingLines);
            if (hunk.lines.length > 0 && lines.length === 0) break;
            hunks.push({ hunk, hunkIndex, lines });
            remainingHunks -= 1;
            remainingStructure -= 1;
            remainingLines -= lines.length;
            renderedLineCount += lines.length;
            position = nextPosition;
          }
        }
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
              onClick={() => {
                const next = new Set(expanded);
                next.has(fileIndex) ? next.delete(fileIndex) : next.add(fileIndex);
                updateViewState({ ...viewState, expanded: [...next] });
              }}
            >
              <span>{file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`}</span>
              <span>{file.hunks.length} hunks · {totalLines} lines</span>
            </button>
            {isExpanded && (
              <div className="git-diff__file-body">
                {headers.map((header, index) => <code key={`${header}:${index}`}>{header}</code>)}
                {metadata.map((item, index) => (
                  <p className={`git-diff__metadata git-diff__metadata--${item.type}`} key={`${item.type}:${index}`}>
                    <span className="sr-only">{item.type.replaceAll("_", " ")} metadata: </span>{item.text}
                  </p>
                ))}
                <div className="git-diff__code-scroll" tabIndex={0}>
                  {hunks.map(({ hunk, hunkIndex, lines }) => (
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
                  ))}
                </div>
                {offset > 0 && (
                  <button
                    type="button"
                    onClick={() => updateViewState({
                      ...viewState,
                      visibleLines: { ...visibleLines, [fileIndex]: Math.max(0, offset - linePageSize) }
                    })}
                  >Show previous diff lines</button>
                )}
                {renderedLineCount > 0 && offset + renderedLineCount < totalLines && (
                  <button
                    type="button"
                    onClick={() => updateViewState({
                      ...viewState,
                      visibleLines: {
                        ...visibleLines,
                        [fileIndex]: offset + renderedLineCount
                      }
                    })}
                  >Show next {Math.min(linePageSize, totalLines - offset - renderedLineCount)} diff lines</button>
                )}
              </div>
            )}
          </section>
        );
      })}
      {value.files.length > filePageSize && (
        <nav aria-label="Diff file pages">
          <button type="button" disabled={filePage === 0} onClick={() => updateViewState({ ...viewState, filePage: Math.max(0, filePage - 1) })}>
            Previous diff files
          </button>
          <span>Files {firstFile + 1}–{Math.min(value.files.length, firstFile + filePageSize)} of {value.files.length}</span>
          <button
            type="button"
            disabled={firstFile + filePageSize >= value.files.length}
            onClick={() => updateViewState({ ...viewState, filePage: filePage + 1 })}
          >Next diff files</button>
        </nav>
      )}
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
