import type {
  InsightPreviewSource,
  RecordedFact,
  RecordedFactLedger,
} from "./insight-types";

function FactRow({
  fact,
  sources,
}: {
  fact: RecordedFact;
  sources: InsightPreviewSource[];
}) {
  const selected = sources.filter(
    (source) =>
      fact.sourceIds.includes(source.id) &&
      source.attemptKey === fact.attemptKey,
  );
  const value =
    fact.kind === "independent_check"
      ? { pass: "Passed", fail: "Failed", unknown: "Unknown" }[fact.outcome]
      : fact.exitCode === null
        ? "Exit unavailable"
        : `Exit ${fact.exitCode}`;
  return (
    <details className="recorded-fact-row">
      <summary>
        <span>{fact.label}</span>
        <span
          className="recorded-fact-value"
          data-outcome={
            fact.kind === "independent_check" ? fact.outcome : "command"
          }
        >
          {value}
        </span>
      </summary>
      <div className="recorded-fact-detail">
        <p>{fact.reason}</p>
        {fact.truncated && (
          <p>The selected or captured output is incomplete.</p>
        )}
        {fact.command && fact.kind === "independent_check" && (
          <p className="recorded-fact-command">{fact.command}</p>
        )}
        {selected.length ? (
          selected.map((source) => (
            <details className="recorded-fact-source" key={source.id}>
              <summary>Selected evidence · {source.label}</summary>
              <pre>{source.excerpt}</pre>
            </details>
          ))
        ) : (
          <p>Selected evidence is unavailable for this fact.</p>
        )}
        <details className="recorded-fact-identity">
          <summary>Saved record identity</summary>
          <p>Fact: {fact.id}</p>
          <p>Attempt: {fact.attemptKey}</p>
          {fact.kind === "independent_check" && fact.artifactSha256 && (
            <p>Artifact: {fact.artifactSha256}</p>
          )}
          {fact.kind === "command_exit" && (
            <p>Source hash: {fact.sourceSha256}</p>
          )}
          <p>Comparison input: {fact.inputHash}</p>
        </details>
      </div>
    </details>
  );
}

export function RecordedFacts({
  ledger,
  inputHash,
  sources,
  attempts,
}: {
  ledger?: RecordedFactLedger;
  inputHash: string;
  sources: InsightPreviewSource[];
  attempts: { key: string; model: string }[];
}) {
  if (!ledger || ledger.inputHash !== inputHash) return null;
  return (
    <details className="recorded-facts">
      <summary>
        <span>Recorded facts</span>
        <span>Saved outcomes · No AI needed</span>
      </summary>
      <p>
        Independent check results and selected command exits, taken from the
        saved records. These facts do not rank models or establish overall task
        success.
      </p>
      <div className="recorded-facts-attempts">
        {attempts.map((attempt) => {
          const facts = ledger.facts.filter(
            (fact) =>
              fact.attemptKey === attempt.key && fact.inputHash === inputHash,
          );
          const checks = facts.filter(
            (fact) => fact.kind === "independent_check",
          );
          const commands = facts.filter((fact) => fact.kind === "command_exit");
          return (
            <section
              key={attempt.key}
              aria-label={`Recorded facts for ${attempt.model} (${attempt.key})`}
            >
              <h3>
                {attempt.model} <span>{attempt.key}</span>
              </h3>
              <h4>Independent checks</h4>
              {checks.length ? (
                checks.map((fact) => (
                  <FactRow key={fact.id} fact={fact} sources={sources} />
                ))
              ) : (
                <p>No independent check results or plan are available.</p>
              )}
              <details className="recorded-command-facts">
                <summary>
                  Command exits · {commands.length} selected records
                </summary>
                {commands.map((fact) => (
                  <FactRow key={fact.id} fact={fact} sources={sources} />
                ))}
                {!commands.length && (
                  <p>
                    No command exits are available in the selected evidence.
                  </p>
                )}
              </details>
            </section>
          );
        })}
      </div>
      <details className="recorded-facts-limits">
        <summary>What these facts cover</summary>
        {ledger.limits.map((limit) => (
          <p key={limit}>{limit}</p>
        ))}
      </details>
    </details>
  );
}
