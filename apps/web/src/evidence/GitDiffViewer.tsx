import type { GitDiffContentV1 } from "@agentlens/api-contract";
import { useState } from "react";

import { AvailabilityNotice, type AvailabilityState } from "./AvailabilityNotice.js";

export type GitDiffEvidence =
  | Readonly<{ state: "available"; value: GitDiffContentV1 }>
  | Readonly<{ state: "unavailable"; reason: AvailabilityState }>;

interface GitDiffCursor {
  readonly headerIndex: number;
  readonly metadataIndex: number;
  readonly hunkIndex: number;
  readonly lineIndex: number;
}

export interface GitDiffViewState {
  readonly expanded: readonly number[];
  readonly cursors: Readonly<Record<number, GitDiffCursor>>;
  readonly cursorHistory: Readonly<Record<number, readonly GitDiffCursor[]>>;
  readonly filePage: number;
}

const firstCursor: GitDiffCursor = Object.freeze({
  headerIndex: 0, metadataIndex: 0, hunkIndex: 0, lineIndex: 0
});

export const initialGitDiffViewState: GitDiffViewState = Object.freeze({
  expanded: Object.freeze([]), cursors: Object.freeze({}),
  cursorHistory: Object.freeze({}), filePage: 0
});

const globalLineBudget = 400;
const filePageSize = 50;
const globalHunkBudget = 100;
const globalStructureBudget = 200;

type DiffFile = GitDiffContentV1["files"][number];

interface DiffPage {
  readonly headers: readonly string[];
  readonly metadata: DiffFile["metadata"];
  readonly hunks: readonly {
    hunk: DiffFile["hunks"][number];
    hunkIndex: number;
    lines: DiffFile["hunks"][number]["lines"];
  }[];
  readonly nextCursor: GitDiffCursor | null;
}

function buildDiffPage(file: DiffFile, start: GitDiffCursor): DiffPage {
  let headerIndex = Math.min(start.headerIndex, file.headers.length);
  let metadataIndex = Math.min(start.metadataIndex, file.metadata.length);
  let hunkIndex = Math.min(start.hunkIndex, file.hunks.length);
  let lineIndex = Math.max(0, start.lineIndex);
  let structures = 0;
  let hunkCount = 0;
  let lineCount = 0;
  const headers: string[] = [];
  const metadata: DiffFile["metadata"][number][] = [];
  const hunks: DiffPage["hunks"][number][] = [];

  while (headerIndex < file.headers.length && structures < globalStructureBudget) {
    headers.push(file.headers[headerIndex]!);
    headerIndex += 1;
    structures += 1;
  }
  while (headerIndex === file.headers.length && metadataIndex < file.metadata.length &&
      structures < globalStructureBudget) {
    metadata.push(file.metadata[metadataIndex]!);
    metadataIndex += 1;
    structures += 1;
  }
  while (headerIndex === file.headers.length && metadataIndex === file.metadata.length &&
      hunkIndex < file.hunks.length && hunkCount < globalHunkBudget &&
      structures < globalStructureBudget && lineCount < globalLineBudget) {
    const hunk = file.hunks[hunkIndex]!;
    const boundedLineIndex = Math.min(lineIndex, hunk.lines.length);
    const lines = hunk.lines.slice(boundedLineIndex, boundedLineIndex + globalLineBudget - lineCount);
    hunks.push({ hunk, hunkIndex, lines });
    hunkCount += 1;
    structures += 1;
    lineCount += lines.length;
    if (boundedLineIndex + lines.length < hunk.lines.length) {
      lineIndex = boundedLineIndex + lines.length;
      break;
    }
    hunkIndex += 1;
    lineIndex = 0;
  }

  const complete = headerIndex === file.headers.length && metadataIndex === file.metadata.length &&
    hunkIndex === file.hunks.length;
  return { headers, metadata, hunks,
    nextCursor: complete ? null : { headerIndex, metadataIndex, hunkIndex, lineIndex } };
}

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
  const expandedFile = viewState.expanded[0];
  const filePage = viewState.filePage;
  const updateViewState = (next: GitDiffViewState): void => {
    setInternalViewState(next);
    props.onViewStateChange?.(next);
  };
  if (props.evidence.state === "unavailable") return <AvailabilityNotice state={props.evidence.reason} />;
  const value = props.evidence.value;
  if (value.malformed) {
    return <p className="availability-notice availability-notice--corrupt" role="status">Structured diff is malformed or corrupt.</p>;
  }
  if (value.files.length === 0 && value.preamble.length === 0) {
    return <p className="git-diff__empty">Tracked final diff is empty.</p>;
  }
  const firstFile = filePage * filePageSize;
  const visibleFiles = value.files.slice(firstFile, firstFile + filePageSize);
  return (
    <section className="git-diff" aria-label="Structured tracked final diff">
      {value.truncated && <AvailabilityNotice state="truncated" />}
      {value.preamble.length > 0 && <TextPreamble lines={value.preamble} />}
      {visibleFiles.map((file, visibleIndex) => {
        const fileIndex = firstFile + visibleIndex;
        const isExpanded = expandedFile === fileIndex;
        const totalLines = file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
        const cursor = viewState.cursors[fileIndex] ?? firstCursor;
        const history = viewState.cursorHistory[fileIndex] ?? [];
        const page = isExpanded ? buildDiffPage(file, cursor) : null;
        return (
          <section className="git-diff__file" role="group" aria-label={`Diff file ${file.newPath}`}
            key={`${file.oldPath}:${file.newPath}:${fileIndex}`}>
            <button type="button" className="git-diff__file-toggle" aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${file.newPath}`}
              onClick={() => updateViewState({ ...viewState, expanded: isExpanded ? [] : [fileIndex] })}>
              <span>{file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`}</span>
              <span>{file.hunks.length} hunks · {totalLines} lines</span>
            </button>
            {page !== null && (
              <div className="git-diff__file-body">
                {page.headers.map((header, index) => <code key={`${header}:${cursor.headerIndex + index}`}>{header}</code>)}
                {page.metadata.map((item, index) => (
                  <p className={`git-diff__metadata git-diff__metadata--${item.type}`} key={`${item.type}:${cursor.metadataIndex + index}`}>
                    <span className="sr-only">{item.type.replaceAll("_", " ")} metadata: </span>{item.text}
                  </p>
                ))}
                {page.hunks.length > 0 && <div className="git-diff__code-scroll" tabIndex={0}>
                  {page.hunks.map(({ hunk, hunkIndex, lines }) => (
                    <section className="git-diff__hunk" key={`${hunk.header}:${hunkIndex}`}>
                      <h3>{hunk.header}</h3>
                      <ol>
                        {lines.map((line, lineOffset) => (
                          <li className={`git-diff__line git-diff__line--${line.type}`} data-diff-line
                            key={`${line.type}:${line.oldLineNumber}:${line.newLineNumber}:${lineOffset}`}>
                            <span className="sr-only">{lineLabel(line)}</span>
                            <span aria-hidden="true" className="git-diff__number">{line.oldLineNumber ?? ""}</span>
                            <span aria-hidden="true" className="git-diff__number">{line.newLineNumber ?? ""}</span>
                            <code><span aria-hidden="true">{prefix(line.type)}</span>{line.text}</code>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>}
                {history.length > 0 && (
                  <button type="button" onClick={() => {
                    const previous = history[history.length - 1]!;
                    updateViewState({ ...viewState,
                      cursors: { ...viewState.cursors, [fileIndex]: previous },
                      cursorHistory: { ...viewState.cursorHistory, [fileIndex]: history.slice(0, -1) } });
                  }}>Show previous diff evidence</button>
                )}
                {page.nextCursor !== null && (
                  <button type="button" onClick={() => updateViewState({ ...viewState,
                    cursors: { ...viewState.cursors, [fileIndex]: page.nextCursor! },
                    cursorHistory: { ...viewState.cursorHistory, [fileIndex]: [...history, cursor] }
                  })}>Show next diff evidence</button>
                )}
              </div>
            )}
          </section>
        );
      })}
      {value.files.length > filePageSize && (
        <nav aria-label="Diff file pages">
          <button type="button" disabled={filePage === 0}
            onClick={() => updateViewState({ ...viewState, filePage: Math.max(0, filePage - 1) })}>
            Previous diff files
          </button>
          <span>Files {firstFile + 1}–{Math.min(value.files.length, firstFile + filePageSize)} of {value.files.length}</span>
          <button type="button" disabled={firstFile + filePageSize >= value.files.length}
            onClick={() => updateViewState({ ...viewState, filePage: filePage + 1 })}>Next diff files</button>
        </nav>
      )}
    </section>
  );
}

function TextPreamble(props: Readonly<{ lines: readonly string[] }>) {
  return <pre className="git-diff__preamble" tabIndex={0}><code>{props.lines.join("\n")}</code></pre>;
}
