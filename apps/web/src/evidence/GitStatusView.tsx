import type { GitStatusContentV1 } from "@agentlens/api-contract";
import { useState } from "react";

const pageSize = 100;

export function GitStatusView(props: Readonly<{ title: string; value: GitStatusContentV1 }>) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(props.value.entries.length / pageSize) - 1);
  const boundedPage = Math.min(page, lastPage);
  const first = boundedPage * pageSize;
  const entries = props.value.entries.slice(first, first + pageSize);
  return (
    <section className="git-status-view">
      <h4>{props.title}</h4>
      {props.value.entries.length === 0 ? <p>Recorded status is clean.</p> : (
        <ul>
          {entries.map((entry, index) => (
            <li key={`${entry.code}:${entry.path}:${first + index}`}>
              <code>{entry.code}</code> <span>{entry.path}</span>
            </li>
          ))}
        </ul>
      )}
      {props.value.entries.length > 0 && (
        <nav aria-label={`${props.title} entry pages`}>
          <button type="button" disabled={boundedPage === 0}
            onClick={() => setPage(Math.max(0, boundedPage - 1))}>Previous {props.title} entries</button>
          <span aria-label={`${props.title} entry range`}>
            Entries {first + 1}–{Math.min(first + pageSize, props.value.entries.length)} of {props.value.entries.length}
          </span>
          <button type="button" disabled={boundedPage === lastPage}
            onClick={() => setPage(Math.min(lastPage, boundedPage + 1))}>Next {props.title} entries</button>
        </nav>
      )}
    </section>
  );
}
