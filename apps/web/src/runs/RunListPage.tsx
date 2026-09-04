import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  AgentLensClientError,
  type AssessmentQueryV1,
  type RunListQueryV1,
  type RunStatusQueryV1
} from "../api/client.js";
import { useRunList } from "../api/queries.js";
import { ErrorState } from "../app/ErrorState.js";
import { RunFilters } from "./RunFilters.js";
import { RunRow } from "./RunRow.js";

const statuses = new Set<RunStatusQueryV1>([
  "starting", "running", "completed", "failed", "interrupted", "recorder_error"
]);
const assessments = new Set<AssessmentQueryV1>([
  "projected", "explicit", "unreviewed", "success", "partial", "failure"
]);

function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function parseQuery(params: URLSearchParams): RunListQueryV1 {
  const limitText = single(params, "limit");
  const parsedLimit = limitText === undefined ? 50 : Number(limitText);
  const limit = Number.isSafeInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100
    ? parsedLimit
    : 50;
  const cursorText = single(params, "cursor");
  const cursor = cursorText !== undefined && cursorText.length >= 1 && cursorText.length <= 4_096
    ? cursorText
    : undefined;
  const statusText = single(params, "status");
  const status = statusText !== undefined && statuses.has(statusText as RunStatusQueryV1)
    ? statusText as RunStatusQueryV1
    : undefined;
  const repositoryText = single(params, "repository");
  const repository = repositoryText !== undefined && repositoryText.length >= 1 && repositoryText.length <= 256
    ? repositoryText
    : undefined;
  const assessmentText = single(params, "assessment");
  const assessment = assessmentText !== undefined && assessments.has(assessmentText as AssessmentQueryV1)
    ? assessmentText as AssessmentQueryV1
    : undefined;
  return {
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(status === undefined ? {} : { status }),
    ...(repository === undefined ? {} : { repository }),
    ...(assessment === undefined ? {} : { assessment })
  };
}

function queryParams(query: RunListQueryV1): URLSearchParams {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.repository !== undefined) params.set("repository", query.repository);
  if (query.assessment !== undefined) params.set("assessment", query.assessment);
  return params;
}

function errorCopy(error: unknown): Readonly<{ title: string; message: string }> {
  if (error instanceof AgentLensClientError && error.code === "authentication_required") {
    return { title: "Authentication expired", message: "Restart AgentLens UI to reconnect." };
  }
  if (error instanceof AgentLensClientError && error.code === "active_snapshot_unavailable") {
    return { title: "Active evidence temporarily unavailable", message: error.message };
  }
  return {
    title: "Run evidence unavailable",
    message: error instanceof AgentLensClientError
      ? error.message
      : "AgentLens could not load run evidence."
  };
}

export function RunListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const serializedSearch = searchParams.toString();
  const query = useMemo(() => parseQuery(searchParams), [serializedSearch]);
  const canonical = queryParams(query);
  const result = useRunList(query);
  const isConstrainedPage = query.cursor !== undefined ||
    query.status !== undefined ||
    query.repository !== undefined ||
    query.assessment !== undefined;

  useEffect(() => {
    if (canonical.toString() !== serializedSearch) setSearchParams(canonical, { replace: true });
  }, [canonical.toString(), serializedSearch, setSearchParams]);

  const apply = (next: RunListQueryV1): void => setSearchParams(queryParams(next));

  return (
    <section className="run-list-page" aria-labelledby="run-ledger-title">
      <header className="page-heading">
        <div>
          <p className="page-eyebrow">Recent local execution evidence</p>
          <h1 id="run-ledger-title">Run ledger</h1>
          <p>Provider facts, AgentLens derivations, final Git evidence, and human review stay separate.</p>
        </div>
        <span className="page-heading__privacy">Redacted local evidence</span>
      </header>

      <RunFilters query={query} onApply={apply} />

      {result.isPending && <div className="loading-state" role="status">Loading run evidence…</div>}
      {result.isError && (() => {
        const copy = errorCopy(result.error);
        return <ErrorState title={copy.title} message={copy.message} />;
      })()}
      {result.data?.items.length === 0 && (
        <section className="empty-state" aria-labelledby="empty-runs-title">
          {isConstrainedPage ? (
            <>
              <h2 id="empty-runs-title">No runs match these filters</h2>
              <p>Change the filters or return to a newer run-ledger page.</p>
            </>
          ) : (
            <>
              <h2 id="empty-runs-title">No runs recorded</h2>
              <p>Record a Codex execution to create the first durable trace.</p>
              <code>agentlens record -- codex exec --json ...</code>
            </>
          )}
        </section>
      )}
      {result.data !== undefined && result.data.items.length > 0 && (
        <ol className="run-ledger" aria-label="Recorded runs">
          {result.data.items.map((run) => <RunRow key={run.runId} run={run} />)}
        </ol>
      )}
      {result.data?.nextCursor !== null && result.data?.nextCursor !== undefined && (
        <nav className="pagination" aria-label="Run ledger pages">
          <Link to={{ pathname: "/runs", search: queryParams({ ...query, cursor: result.data.nextCursor }).toString() }}>
            Older runs
          </Link>
        </nav>
      )}
    </section>
  );
}
