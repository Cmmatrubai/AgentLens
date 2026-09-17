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
  dependencies?: {
    status: "none" | "supported" | "unsupported";
    reason?: string;
    manager?: string;
    requestedVersion?: string | null;
    fingerprint?: string;
    inputCount?: number;
  };
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
  preparation?: {
    state: string;
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    output: string;
    outputTruncated?: boolean;
    outputSha256?: string;
    exitCode?: number | null;
    command?: string;
    nodeVersion?: string;
    pnpmVersion?: string;
    error?: string;
  };
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
  dependencyPlan?: LiveProject["dependencies"];
  dependencyTools?: { nodeVersion: string; pnpmVersion: string };
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
  prepareDependencies?: boolean;
};
export type LiveAPI = {
  readDesktopEnvironment?: () => Promise<
    LiveResult<{ environment: DesktopEnvironment }>
  >;
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
  prepareDependencies?: boolean;
  title: string;
  command: string;
  timeoutSeconds: number;
  acknowledged: boolean;
};
export type CheckEvaluation = {
  prepareDependencies?: boolean;
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
    preparation?: LiveAttempt["preparation"] & {
      reason?: string;
      fingerprint?: string;
    };
    commandStartedAt?: number;
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

export type DesktopEnvironment = {
  storage: { root: string; mode: string };
  packaged: boolean;
  platform: string;
  tools: {
    id: string;
    label: string;
    purpose: string;
    status: "detected" | "unsupported" | "unavailable";
    version: string | null;
    help: string;
  }[];
};
