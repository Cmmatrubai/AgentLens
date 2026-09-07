export type Outcome = "pass" | "fail" | "unknown";
export type TaskStatus = "difference" | "incomplete" | "same";
export type Check = {
  id: string;
  name: string;
  expectation: string;
  a: Outcome;
  b: Outcome;
  outputA: string;
  outputB: string;
};
export type Task = {
  attemptTimeoutMinutes?: number;
  models?: { a: string; b: string };
  id: string;
  code: string;
  title: string;
  repository: string;
  category: string;
  description: string;
  status: TaskStatus;
  headline: string;
  takeaway: string;
  difference: string;
  timeA: string;
  timeB: string;
  secondsA: number;
  secondsB: number;
  file: string;
  change: string;
  checks: Check[];
  patch: string[];
};
export const tasks: Task[] = [
  {
    id: "session",
    code: "AL-001",
    title: "Handle expired sessions",
    repository: "web-platform",
    category: "Authentication",
    description: "Reject expired sessions without interrupting valid ones.",
    status: "difference",
    headline: "The faster attempt missed an edge case.",
    takeaway:
      "Model A passed all 3 acceptance checks. Model B was quicker, but left expired sessions authenticated.",
    difference: "Expired sessions still looked valid",
    timeA: "6m 12s",
    timeB: "4m 48s",
    secondsA: 372,
    secondsB: 288,
    file: "src/auth/session.ts",
    change: "Updated the session guard",
    checks: [
      {
        id: "valid",
        name: "Keep valid sessions signed in",
        expectation: "A valid, unexpired session remains authenticated.",
        a: "pass",
        b: "pass",
        outputA:
          "PASS  valid session remains authenticated\nExpected: authenticated\nReceived: authenticated",
        outputB:
          "PASS  valid session remains authenticated\nExpected: authenticated\nReceived: authenticated",
      },
      {
        id: "missing",
        name: "Reject missing session tokens",
        expectation: "A request without a token is unauthenticated.",
        a: "pass",
        b: "pass",
        outputA:
          "PASS  missing token is rejected\nExpected: unauthenticated\nReceived: unauthenticated",
        outputB:
          "PASS  missing token is rejected\nExpected: unauthenticated\nReceived: unauthenticated",
      },
      {
        id: "expired",
        name: "Reject expired sessions",
        expectation: "An expired token must return an unauthenticated result.",
        a: "pass",
        b: "fail",
        outputA:
          "PASS  expired session is rejected\nExpected: unauthenticated\nReceived: unauthenticated",
        outputB:
          "FAIL  expired session is rejected\nExpected: unauthenticated\nReceived: authenticated\n\nat tests/session.acceptance.test.ts:42",
      },
    ],
    patch: [
      " export function validateSession(session) {",
      "-  return Boolean(session.token);",
      "+  if (!session.token) return false;",
      "+  return session.expiresAt > Date.now();",
      " }",
    ],
  },
  {
    id: "cleanup",
    code: "AL-002",
    title: "Clean up resistant child processes",
    repository: "checkout-api",
    category: "Reliability",
    description:
      "Stop a process and its descendants, even when graceful shutdown fails.",
    status: "difference",
    headline: "The candidate handled the recovery case.",
    takeaway:
      "Model B passed all 3 checks. Model A stopped the parent process but left a resistant descendant alive.",
    difference: "A descendant outlived the parent process",
    timeA: "8m 02s",
    timeB: "5m 17s",
    secondsA: 482,
    secondsB: 317,
    file: "src/process/supervisor.ts",
    change: "Updated process-group cleanup",
    checks: [
      {
        id: "graceful",
        name: "Allow graceful shutdown",
        expectation:
          "A cooperative process exits after the first termination signal.",
        a: "pass",
        b: "pass",
        outputA:
          "PASS  cooperative process exits\nExpected: stopped\nReceived: stopped",
        outputB:
          "PASS  cooperative process exits\nExpected: stopped\nReceived: stopped",
      },
      {
        id: "descendant",
        name: "Stop resistant descendants",
        expectation:
          "No descendant process remains alive after the shutdown deadline.",
        a: "fail",
        b: "pass",
        outputA:
          "FAIL  resistant descendant remains alive\nExpected: 0 surviving descendants\nReceived: 1 surviving descendant",
        outputB:
          "PASS  all descendants stopped\nExpected: 0 surviving descendants\nReceived: 0 surviving descendants",
      },
      {
        id: "unrelated",
        name: "Preserve unrelated processes",
        expectation: "Processes outside the recorded group are left running.",
        a: "pass",
        b: "pass",
        outputA: "PASS  unrelated process preserved",
        outputB: "PASS  unrelated process preserved",
      },
    ],
    patch: [
      " async function stopGroup(groupId) {",
      '   signalGroup(groupId, "SIGTERM");',
      "+  await waitForExitOrDeadline(groupId);",
      "+  if (isGroupAlive(groupId)) {",
      '+    signalGroup(groupId, "SIGKILL");',
      "+  }",
      " }",
    ],
  },
  {
    id: "stream",
    code: "AL-003",
    title: "Bound oversized event records",
    repository: "data-pipeline",
    category: "Ingestion",
    description:
      "Keep reading a stream after an oversized record without retaining the whole line.",
    status: "incomplete",
    headline: "One missing check keeps the result open.",
    takeaway:
      "Model A passed all 3 checks. Model B passed 2, but its oversized-record output was not captured.",
    difference: "The oversized-record check has no captured result",
    timeA: "7m 08s",
    timeB: "—",
    secondsA: 428,
    secondsB: 0,
    file: "src/ingestion/decoder.ts",
    change: "Added a bounded line buffer",
    checks: [
      {
        id: "order",
        name: "Preserve record order",
        expectation: "Records are delivered in their original order.",
        a: "pass",
        b: "pass",
        outputA: "PASS  sequential delivery retained",
        outputB: "PASS  sequential delivery retained",
      },
      {
        id: "oversized",
        name: "Bound an oversized record",
        expectation: "Retained line data stays within the configured limit.",
        a: "pass",
        b: "unknown",
        outputA:
          "PASS  oversized record bounded\nRetained bytes: within configured limit",
        outputB:
          "No captured result for this check.\n\nThe absence of output does not mean the check passed or failed.",
      },
      {
        id: "continue",
        name: "Continue after a rejected line",
        expectation:
          "A valid record following an oversized line is still processed.",
        a: "pass",
        b: "pass",
        outputA: "PASS  following record processed",
        outputB: "PASS  following record processed",
      },
    ],
    patch: [
      " for await (const chunk of source) {",
      "-  line += chunk;",
      "+  retainWithinLimit(chunk);",
      "+  countObservedBytes(chunk);",
      "   if (hasNewline(chunk)) emitRecord();",
      " }",
    ],
  },
];
export type SavedCase = {
  id: string;
  sourceTaskId: string;
  name: string;
  objective: string;
  checkIds: string[];
  savedAt: string;
};
export const initialCases: SavedCase[] = [
  {
    id: "seed-cleanup",
    sourceTaskId: "cleanup",
    name: "Resistant process cleanup",
    objective: tasks[1].description,
    checkIds: tasks[1].checks.map((c) => c.id),
    savedAt: "Example case",
  },
];
export const passCount = (task: Task, side: "a" | "b") =>
  task.checks.filter((c) => c[side] === "pass").length;
export const importantCheck = (task: Task) =>
  task.checks.find((c) => c.a !== c.b) ?? task.checks[0];
export const outcomeText = (o: Outcome) =>
  o === "pass" ? "Passed" : o === "fail" ? "Failed" : "Not captured";

export const modelLabel = (task: Task, side: "a" | "b") =>
  task.models?.[side] ?? "Model " + side.toUpperCase();
export const modelSide = (task: Task, side: "a" | "b"): "a" | "b" =>
  modelLabel(task, side) === "Model B" ? "b" : "a";
