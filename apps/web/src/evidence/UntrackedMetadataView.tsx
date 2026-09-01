import type { GitUntrackedContentV1 } from "@agentlens/api-contract";

export function UntrackedMetadataView(props: Readonly<{ value: GitUntrackedContentV1 }>) {
  return (
    <section className="untracked-metadata">
      <h4>Untracked-file metadata</h4>
      <p>No untracked-file contents are captured by this view.</p>
      {props.value.entries.length === 0 ? <p>Recorded metadata contains no entries.</p> : (
        <ul>
          {props.value.entries.map((entry, index) => (
            <li key={`${entry.path}:${index}`}>
              <code>{entry.path}</code> · {entry.type} · {entry.size} bytes
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
