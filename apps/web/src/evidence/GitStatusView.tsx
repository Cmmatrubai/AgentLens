import type { GitStatusContentV1 } from "@agentlens/api-contract";

export function GitStatusView(props: Readonly<{ title: string; value: GitStatusContentV1 }>) {
  return (
    <section className="git-status-view">
      <h4>{props.title}</h4>
      {props.value.entries.length === 0 ? <p>Recorded status is clean.</p> : (
        <ul>
          {props.value.entries.map((entry, index) => (
            <li key={`${entry.code}:${entry.path}:${index}`}>
              <code>{entry.code}</code> <span>{entry.path}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
