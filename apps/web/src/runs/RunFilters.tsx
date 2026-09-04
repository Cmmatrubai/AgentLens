import { useEffect, useState, type FormEvent } from "react";

import type { AssessmentQueryV1, RunListQueryV1, RunStatusQueryV1 } from "../api/client.js";

const statusOptions: readonly RunStatusQueryV1[] = [
  "starting", "running", "completed", "failed", "interrupted", "recorder_error"
];
const assessmentOptions: readonly AssessmentQueryV1[] = [
  "projected", "explicit", "unreviewed", "success", "partial", "failure"
];

function displayOption(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function RunFilters(props: Readonly<{
  query: RunListQueryV1;
  onApply(query: RunListQueryV1): void;
}>) {
  const [status, setStatus] = useState(props.query.status ?? "");
  const [repository, setRepository] = useState(props.query.repository ?? "");
  const [assessment, setAssessment] = useState(props.query.assessment ?? "");

  useEffect(() => {
    setStatus(props.query.status ?? "");
    setRepository(props.query.repository ?? "");
    setAssessment(props.query.assessment ?? "");
  }, [props.query.status, props.query.repository, props.query.assessment]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onApply({
      limit: props.query.limit,
      ...(status === "" ? {} : { status: status as RunStatusQueryV1 }),
      ...(repository.trim() === "" ? {} : { repository: repository.trim().slice(0, 256) }),
      ...(assessment === "" ? {} : { assessment: assessment as AssessmentQueryV1 })
    });
  };

  return (
    <form className="run-filters" aria-label="Run ledger filters" onSubmit={submit}>
      <label>
        <span>Run status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {statusOptions.map((option) => (
            <option key={option} value={option}>{displayOption(option)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Repository fingerprint</span>
        <input
          maxLength={256}
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          placeholder="All repositories"
        />
      </label>
      <label>
        <span>Assessment</span>
        <select value={assessment} onChange={(event) => setAssessment(event.target.value)}>
          <option value="">All assessment states</option>
          {assessmentOptions.map((option) => (
            <option key={option} value={option}>{displayOption(option)}</option>
          ))}
        </select>
      </label>
      <button className="run-filters__submit" type="submit">Apply filters</button>
    </form>
  );
}
