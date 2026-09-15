export type LiveState =
  | "preparing"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped"
  | "timed_out"
  | "interrupted";
export type LiveProject = {
  id: string;
  path: string;
  name: string;
  commit: string;
  dirty: boolean;
  submodules: boolean;
};
export type LiveEvent = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  command: string;
  output: string;
  message: string;
  files: string[];
  truncated: boolean;
  receivedAt: number;
};
export type LiveAttempt = {
  key: "a" | "b";
  model: string;
  effort: string;
  state: LiveState;
  workspace: string;
  recordingPath?: string;
  runId?: string;
  recordedStatus?: string;
  startedAt?: number;
  endedAt?: number;
  lastActivityAt?: number;
  error?: string;
  eventCount: number;
  omittedEvents: number;
  events: LiveEvent[];
};
export type LiveJob = {
  schemaVersion: 1;
  id: string;
  state: "preparing" | "running" | "finished" | "failed" | "interrupted";
  task: string;
  project: Omit<LiveProject, "id">;
  baseCommit: string;
  startedAt: number;
  endedAt?: number;
  timeoutMs: number;
  attempts: LiveAttempt[];
  error?: string;
  persistenceError?: boolean;
  cleanupUnconfirmed?: boolean;
  cleanupAcknowledgedAt?: number;
};
export type LiveSnapshot = {
  job: LiveJob | null;
  activeId: string | null;
  recoveryWarnings: string[];
  unresolvedCleanup?: { id: string; title: string }[];
  recent: { id: string; title: string; state: string; startedAt: number }[];
};
export type LiveResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };
export type LiveInput = {
  projectId: string;
  baseCommit: string;
  task: string;
  models: { model: string; effort: string }[];
  timeoutMinutes: number;
  acknowledged: boolean;
};
export type LiveAPI = {
  liveChecksRead: (
    id: string,
  ) => Promise<LiveResult<{ evaluation: CheckEvaluation | null }>>;
  liveChecksStart: (
    id: string,
    check: CheckInput,
  ) => Promise<LiveResult<{ evaluation: CheckEvaluation }>>;
  liveChecksStop: (
    id: string,
  ) => Promise<LiveResult<{ evaluation: CheckEvaluation }>>;
  liveChecksAcknowledge: (
    id: string,
    confirmed: boolean,
  ) => Promise<LiveResult<{ evaluation: CheckEvaluation }>>;
  liveModels: () => Promise<LiveResult<{ catalog: LiveModelCatalog }>>;
  liveAcknowledgeCleanup: (
    id: string,
    acknowledged: boolean,
  ) => Promise<LiveResult<LiveSnapshot>>;
  liveChooseProject: () => Promise<
    LiveResult<{ cancelled?: boolean; project?: LiveProject }>
  >;
  livePrerequisites: () => Promise<
    LiveResult<{ prerequisites: { version: string } }>
  >;
  liveStart: (input: LiveInput) => Promise<LiveResult<{ job: LiveJob }>>;
  liveRead: (id?: string) => Promise<LiveResult<LiveSnapshot>>;
  liveStop: (
    id: string,
    key: "a" | "b" | "all",
  ) => Promise<LiveResult<LiveSnapshot>>;
  liveOpenComparison: (id: string) => Promise<LiveResult>;
};

export type CheckInput = {
  title: string;
  command: string;
  timeoutSeconds: number;
  acknowledged: boolean;
};
export type CheckEvaluation = {
  id: string;
  jobId: string;
  title: string;
  command: string;
  timeoutSeconds: number;
  state: "running" | "finished" | "interrupted";
  startedAt: number;
  endedAt?: number;
  cleanupUnconfirmed?: boolean;
  cleanupAcknowledgedAt?: number;
  persistenceError?: boolean;
  attempts: {
    key: "a" | "b";
    runId: string;
    state:
      | "queued"
      | "preparing"
      | "running"
      | "completed"
      | "cancelled"
      | "timed_out"
      | "unavailable"
      | "interrupted";
    outcome: "pass" | "fail" | "unknown";
    output: string;
    outputTruncated: boolean;
    exitCode: number | null;
    durationMs: number | null;
    snapshotHash: string | null;
    artifactSha256: string | null;
    error?: string;
  }[];
};

export type LiveModelOption = {
  id: string;
  name: string;
  description: string;
  efforts: ("low" | "medium" | "high" | "xhigh")[];
};
export type LiveModelCatalog = {
  source: "codex-cache";
  fetchedAt: string | null;
  models: LiveModelOption[];
};
