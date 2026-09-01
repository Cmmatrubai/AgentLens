import type { GitUntrackedContentV1 } from "@agentlens/api-contract";
import { useState } from "react";

const pageSize = 100;

export function UntrackedMetadataView(props: Readonly<{ value: GitUntrackedContentV1 }>) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(props.value.entries.length / pageSize) - 1);
  const boundedPage = Math.min(page, lastPage);
  const first = boundedPage * pageSize;
  const entries = props.value.entries.slice(first, first + pageSize);
  return (
    <section className="untracked-metadata">
      <h4>Untracked-file metadata</h4>
      <p>No untracked-file contents are captured by this view.</p>
      {props.value.entries.length === 0 ? <p>Recorded metadata contains no entries.</p> : (
        <ul>
          {entries.map((entry, index) => (
            <li key={`${entry.path}:${first + index}`}>
              <code>{entry.path}</code> · {entry.type} · {entry.size} bytes
            </li>
          ))}
        </ul>
      )}
      {props.value.entries.length > 0 && (
        <nav aria-label="Untracked-file metadata entry pages">
          <button type="button" disabled={boundedPage === 0}
            onClick={() => setPage(Math.max(0, boundedPage - 1))}>Previous untracked-file metadata entries</button>
          <span aria-label="Untracked-file metadata entry range">
            Entries {first + 1}–{Math.min(first + pageSize, props.value.entries.length)} of {props.value.entries.length}
          </span>
          <button type="button" disabled={boundedPage === lastPage}
            onClick={() => setPage(Math.min(lastPage, boundedPage + 1))}>Next untracked-file metadata entries</button>
        </nav>
      )}
    </section>
  );
}
