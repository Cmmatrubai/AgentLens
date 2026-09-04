import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test as base, type Page, type Request } from "@playwright/test";
import type { TraceEventV1 } from "../../../packages/core/src/index.js";
import {
  openDatabase,
  openDatabaseForServerRead,
  RunRepository,
  withServerReadSnapshot
} from "../../../packages/storage/src/index.js";

import { createFixtureDataRoot } from "../test-support/fixtureDataRoot.js";
import {
  classifyFailedRequests,
  type FailedRequestObservation,
  type SuccessfulRequestObservation
} from "./browserGuard.js";
import {
  installE2ERequestCorrelation,
  RequestLifecycleLedger
} from "./requestLifecycle.js";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const baseTime = Date.UTC(2026, 7, 31, 17, 0, 0);

function event(runId: string, sequence: number, input: Readonly<{
  kind?: string;
  status?: TraceEventV1["status"];
  summary?: string;
}> = {}): TraceEventV1 {
  const kind = input.kind ?? "message.agent";
  return {
    id: `${runId}-event-${sequence}`,
    runId,
    sequence,
    receivedAt: new Date(baseTime + sequence * 1_000).toISOString(),
    kind,
    status: input.status ?? "completed",
    provenance: "observed",
    source: { provider: "codex-exec", itemId: `${runId}-item-${sequence}`, eventType: kind },
    relationships: [],
    summary: input.summary ?? `Synthetic event ${sequence}`,
    normalizedPayload: { role: "agent", text: `Synthetic bounded event ${sequence}` }
  };
}

function createRun(repository: RunRepository, id: string, startedAt: number): void {
  repository.createRun({
    id,
    schemaVersion: 1,
    provider: "codex-exec",
    integrationVersion: "0.1.0",
    agentVersion: "release-fixture",
    capturePolicy: "standard",
    capturePolicyVersion: "1",
    redactionVersion: "1",
    label: `${id.replaceAll("-", " ")} evidence`,
    repositoryFingerprint: "repo-release-fixture",
    repositoryDisplay: "Release fixture",
    startedAt
  }, {
    recorderInstanceId: `recorder-${id}`,
    recorderPid: process.pid,
    recorderStartToken: `recorder-start-${id}`,
    heartbeatAt: startedAt
  });
}

function finishRun(repository: RunRepository, runId: string, sequence: number, exitCode = 0): void {
  const recorderInstanceId = `recorder-${runId}`;
  if (repository.getRun(runId).status === "starting") {
    repository.markRunning(runId, {
      recorderInstanceId,
      childPid: 80_000 + sequence,
      childStartToken: `child-${runId}`,
      childProcessGroupId: 80_000 + sequence,
      updatedAt: baseTime + sequence * 1_000
    });
  }
  const processEventId = `${runId}-process-exit`;
  repository.appendEvent({
    ...event(runId, sequence, {
      kind: "recorder.process_exit",
      status: exitCode === 0 ? "completed" : "failed",
      summary: `Child process exited ${exitCode}`
    }),
    id: processEventId,
    provenance: "recorder",
    source: { provider: "codex-exec", correlationId: runId },
    normalizedPayload: { exitCode, terminatingSignal: null }
  });
  repository.recordProcessFact(runId, { eventId: processEventId });
  const providerEventId = `${runId}-provider-terminal`;
  repository.appendEvent({
    ...event(runId, sequence + 1, {
      kind: exitCode === 0 ? "turn.completed" : "turn.failed",
      status: exitCode === 0 ? "completed" : "failed",
      summary: exitCode === 0 ? "Provider reported completion" : "Provider reported failure"
    }),
    id: providerEventId
  });
  repository.reconcileRun(runId, {
    eventId: `${runId}-reconciled`,
    receivedAt: new Date(baseTime + (sequence + 2) * 1_000).toISOString(),
    endedAt: baseTime + (sequence + 2) * 1_000,
    providerTerminalEventId: providerEventId
  });
}

export interface ReleaseFixture {
  readonly root: string;
  readonly dataRoot: string;
  appendActive(count?: number): void;
  finishActive(): void;
  activeWalModes(): readonly number[];
  humanAssessmentEventCount(runId: string): Promise<number>;
  close(): Promise<void>;
}

export async function createReleaseFixture(): Promise<ReleaseFixture> {
  const fixture = await createFixtureDataRoot();
  const setupDatabase = openDatabase(join(fixture.dataRoot, "agentlens.sqlite"));
  const setupRepository = new RunRepository(setupDatabase, {
    artifactRoot: join(fixture.dataRoot, "artifacts", "sha256")
  });
  for (const count of [10, 50, 250, 1_000]) {
    const runId = `fixture-trajectory-${count}`;
    createRun(setupRepository, runId, baseTime - count * 10_000);
    const syntheticEventCount = count - 3;
    for (let sequence = 0; sequence < syntheticEventCount; sequence += 1) {
      setupRepository.appendEvent(event(runId, sequence));
    }
    finishRun(setupRepository, runId, syntheticEventCount);
  }

  const activeRunId = "fixture-running";
  let activeSequence = setupRepository.getRunDetail(activeRunId).events.length;
  setupDatabase.close();
  let activeDatabase: ReturnType<typeof openDatabase> | undefined;
  let activeRepository: RunRepository | undefined;
  const writer = (): RunRepository => {
    activeDatabase ??= openDatabase(join(fixture.dataRoot, "agentlens.sqlite"));
    activeRepository ??= new RunRepository(activeDatabase, {
      artifactRoot: join(fixture.dataRoot, "artifacts", "sha256")
    });
    return activeRepository;
  };
  const secureActiveFiles = (): void => {
    for (const path of [
      join(fixture.dataRoot, "agentlens.sqlite"),
      join(fixture.dataRoot, "agentlens.sqlite-wal"),
      join(fixture.dataRoot, "agentlens.sqlite-shm")
    ]) chmodSync(path, 0o600);
  };
  return {
    root: fixture.root,
    dataRoot: fixture.dataRoot,
    appendActive(count = 1) {
      for (let offset = 0; offset < count; offset += 1) {
        writer().appendEvent(event(activeRunId, activeSequence++, {
          summary: `Committed active event ${activeSequence}`
        }));
      }
      secureActiveFiles();
    },
    finishActive() {
      finishRun(writer(), activeRunId, activeSequence);
      secureActiveFiles();
      activeSequence += 3;
    },
    activeWalModes() {
      return ["agentlens.sqlite", "agentlens.sqlite-wal", "agentlens.sqlite-shm"]
        .map((name) => statSync(join(fixture.dataRoot, name)).mode & 0o777);
    },
    async humanAssessmentEventCount(runId: string) {
      const opened = openDatabaseForServerRead(join(fixture.dataRoot, "agentlens.sqlite"));
      try {
        const reader = new RunRepository(opened.database, {
          artifactRoot: join(fixture.dataRoot, "artifacts", "sha256")
        });
        return await withServerReadSnapshot(opened.database, () =>
          reader.getRunDetail(runId).events.filter(({ provenance }) => provenance === "human").length
        );
      } finally {
        opened.database.close();
      }
    },
    async close() {
      activeDatabase?.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  };
}

export interface ProductionUi {
  readonly bootstrapUrl: string;
  readonly origin: string;
  stderrLog(): string;
  close(): Promise<number | null>;
}

function waitForBootstrap(child: ChildProcess, stderrLog: () => string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for the UI bootstrap URL.")), 15_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/, 1)[0];
      if (!line || !line.endsWith("/bootstrap/" + line.split("/bootstrap/")[1])) return;
      let parsed: URL;
      try { parsed = new URL(line); } catch { return; }
      if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.startsWith("/bootstrap/")) return;
      clearTimeout(timeout);
      resolve(parsed.href);
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`UI process exited before bootstrap (${code}): ${stderrLog().slice(0, 200)}`));
    });
  });
}

export async function startProductionUi(dataRoot: string): Promise<ProductionUi> {
  const child = spawn(process.execPath, [
    join(workspaceRoot, "apps", "cli", "dist", "main.js"),
    "ui", "--data-root", dataRoot, "--no-open"
  ], {
    cwd: workspaceRoot,
    env: { ...process.env, NODE_OPTIONS: "" },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  const bootstrapUrl = await waitForBootstrap(child, () => stderr);
  const origin = new URL(bootstrapUrl).origin;
  let closed: Promise<number | null> | undefined;
  return {
    bootstrapUrl,
    origin,
    stderrLog: () => stderr,
    close() {
      closed ??= new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
        child.kill("SIGTERM");
      });
      return closed;
    }
  };
}

export async function openBootstrapped(page: Page, ui: ProductionUi): Promise<void> {
  await page.goto(ui.bootstrapUrl, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`^${ui.origin.replaceAll(".", "\\.")}/runs(?:\\?limit=50)?$`));
  await expect(page.getByRole("heading", { name: "Run ledger" })).toBeVisible();
}

export async function navigateToRun(page: Page, runId: string): Promise<void> {
  await page.locator(`a[href="/runs/${runId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}(?:\\?|$)`));
  await expect(page.getByText(runId, { exact: true })).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}

export interface AllowedSameOriginFailure {
  readonly method: string;
  readonly pathname: string;
  readonly status: number;
}

export interface AllowedSameOriginFailures {
  readonly responses: readonly AllowedSameOriginFailure[];
}

export const test = base.extend<{
  allowedSameOriginFailures: AllowedSameOriginFailures;
  browserGuard: void;
  releaseFixture: ReleaseFixture;
  productionUi: ProductionUi;
  requestLifecycle: RequestLifecycleLedger<Request>;
}>({
  allowedSameOriginFailures: [{ responses: [] }, { option: true }],
  releaseFixture: async ({}, use) => {
    const fixture = await createReleaseFixture();
    try { await use(fixture); } finally { await fixture.close(); }
  },
  productionUi: async ({ releaseFixture }, use) => {
    const ui = await startProductionUi(releaseFixture.dataRoot);
    try { await use(ui); } finally { expect(await ui.close()).toBe(143); }
  },
  requestLifecycle: async ({ page, productionUi }, use) => {
    const ledger = new RequestLifecycleLedger<Request>(productionUi.origin);
    await page.exposeBinding(
      "__agentLensE2EReportRequestLifecycle",
      (_source, observation: unknown) => { ledger.pageSettled(observation); }
    );
    await page.addInitScript(installE2ERequestCorrelation);
    const started = (request: Request): void => { ledger.started(request); };
    const finished = (request: Request): void => { ledger.finished(request); };
    const failed = (request: Request): void => { ledger.failed(request); };
    page.on("request", started);
    page.on("requestfinished", finished);
    page.on("requestfailed", failed);
    try {
      await use(ledger);
    } finally {
      page.off("request", started);
      page.off("requestfinished", finished);
      page.off("requestfailed", failed);
    }
  },
  browserGuard: [async ({ page, productionUi, allowedSameOriginFailures, requestLifecycle }, use) => {
    const failures: string[] = [];
    const consoleFailures: string[] = [];
    const remainingAllowed = [...allowedSameOriginFailures.responses];
    const observedAllowedStatuses = new Map<number, number>();
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleFailures.push(`console ${message.type()}: ${message.text()}`);
      }
    });
    page.on("response", (response) => {
      const requested = new URL(response.url());
      if (requested.origin !== productionUi.origin) return;
      if (response.status() < 400) return;
      const candidate = {
        method: response.request().method(),
        pathname: requested.pathname,
        status: response.status()
      };
      const allowedIndex = remainingAllowed.findIndex((allowed) =>
        allowed.method === candidate.method &&
        allowed.pathname === candidate.pathname &&
        allowed.status === candidate.status
      );
      if (allowedIndex === -1) {
        failures.push(`failed response: ${candidate.status} ${candidate.method} ${candidate.pathname}`);
      } else {
        remainingAllowed.splice(allowedIndex, 1);
        observedAllowedStatuses.set(candidate.status, (observedAllowedStatuses.get(candidate.status) ?? 0) + 1);
      }
    });
    try {
      await use();
    } finally {
      try {
        await expect.poll(() => requestLifecycle.describeActive(productionUi.origin).slice().sort(),
          "All same-origin requests must settle before browser teardown.").toEqual([]);
      } catch {
        failures.push(`unsettled same-origin requests: ${requestLifecycle.describeActive(productionUi.origin).slice().sort().join(", ")}`);
      }
      const records = requestLifecycle.snapshot();
      failures.push(...requestLifecycle.violations());
      for (const record of records) {
        const requested = new URL(record.url);
        if ((requested.protocol === "http:" || requested.protocol === "https:") &&
            requested.origin !== productionUi.origin) {
          failures.push(`external request: ${record.method} ${requested.origin}${requested.pathname}`);
        }
      }
      const successfulRequests = records.flatMap((record): SuccessfulRequestObservation[] =>
        record.terminal.state === "finished" && new URL(record.url).origin === productionUi.origin
          ? [{
              method: record.method,
              pollGeneration: record.pollGeneration,
              requestId: record.id,
              resourceType: record.resourceType,
              sequence: record.terminalSequence!,
              url: record.url
            }]
          : []
      );
      const failedRequests = records.flatMap((record): FailedRequestObservation[] =>
        record.terminal.state === "failed"
          ? [{
              errorText: record.terminal.errorText,
              method: record.method,
              pollGeneration: record.pollGeneration,
              requestId: record.id,
              resourceType: record.resourceType,
              sequence: record.terminalSequence!,
              url: record.url
            }]
          : []
      );
      failures.push(...classifyFailedRequests(successfulRequests, failedRequests));
      let automatic404s = observedAllowedStatuses.get(404) ?? 0;
      let automatic503s = observedAllowedStatuses.get(503) ?? 0;
      for (const failure of consoleFailures) {
        if (failure === "console error: Failed to load resource: the server responded with a status of 404 (Not Found)" &&
            automatic404s > 0) {
          automatic404s -= 1;
        } else if (failure === "console error: Failed to load resource: the server responded with a status of 503 (Service Unavailable)" &&
            automatic503s > 0) {
          automatic503s -= 1;
        } else {
          failures.push(failure);
        }
      }
      if (automatic404s !== 0) failures.push("An allowed 404 did not emit the expected Chromium console diagnostic.");
      if (automatic503s !== 0) failures.push("The allowed 503 did not emit the expected Chromium console diagnostic.");
      if (remainingAllowed.length > 0) {
        failures.push(`missing allowed responses: ${remainingAllowed.map((allowed) =>
          `${allowed.status} ${allowed.method} ${allowed.pathname}`).join(", ")}`);
      }
      if (failures.length > 0) {
        failures.push(`request ledger: ${requestLifecycle.describe(productionUi.origin).join(" | ")}`);
      }
      expect(failures, "Browser journeys must not emit warnings, external traffic, or failed requests.").toEqual([]);
    }
  }, { auto: true }]
});

export { expect } from "@playwright/test";
