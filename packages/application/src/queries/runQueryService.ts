import {
  browserAddressableEventIdV1Schema,
  eventDetailV1Schema,
  runDetailV1Schema,
  runPageV1Schema,
  type EventDetailV1,
  type RunDetailV1,
  type RunPageV1,
  type TrajectoryPageV1
} from "@agentlens/api-contract";
import type { RunStatus } from "@agentlens/core";
import { summarizeRun, type CurrentAssessmentProjection, type RunSummary } from "@agentlens/derivations";
import {
  RunRepository,
  ServerReadDatabaseError,
  openDatabaseForServerRead,
  withServerReadSnapshot,
  type CurrentAssessment,
  type EventWindowRecord,
  type ListRunPageInput,
  type RunListRecord,
  type RunSummaryBatchRecord
} from "@agentlens/storage";

import type { CursorCodec, RunCursorFilters } from "../api/cursors.js";
import {
  projectEventDetailV1,
  projectRunListItemV1,
  projectTrajectoryPageV1
} from "../api/projectors.js";
import type { SourceRefProjector } from "../api/sourceRefs.js";
import { diagnoseOwnership } from "../ownership.js";
import type { ProcessIdentityInspector } from "../processIdentity.js";
import {
  projectRunSummaryFromEvidence,
  type ProviderCapabilitiesLookup
} from "../runSummary.js";

export interface RunListQueryV1 {
  readonly limit: number;
  readonly cursor?: string;
  readonly status?: RunStatus;
  readonly repositoryFingerprint?: string;
  readonly assessment?: ListRunPageInput["assessment"];
}

export interface EventPageQueryV1 {
  readonly limit: number;
  readonly cursor?: string;
  readonly afterSequence?: number;
  readonly aroundSequence?: number;
}

export type RunQueryServiceErrorCode =
  | "invalid_request"
  | "invalid_cursor"
  | "run_not_found"
  | "active_snapshot_unavailable";

export class RunQueryServiceError extends Error {
  readonly code: RunQueryServiceErrorCode;

  constructor(code: RunQueryServiceErrorCode) {
    super(code);
    this.name = "RunQueryServiceError";
    this.code = code;
  }
}

export interface RunQueryService {
  listRuns(input: RunListQueryV1): Promise<RunPageV1>;
  getRun(runId: string): Promise<RunDetailV1 | null>;
  getEvents(runId: string, input: EventPageQueryV1): Promise<TrajectoryPageV1>;
  getEvent(runId: string, eventId: string): Promise<EventDetailV1 | null>;
}

export interface CreateRunQueryServiceInput {
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly cursorCodec: CursorCodec;
  readonly sourceRefProjector: SourceRefProjector;
  readonly processIdentityInspector: ProcessIdentityInspector;
  readonly providerCapabilities: ProviderCapabilitiesLookup;
}

function validLimit(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function validId(value: string): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

function validEventId(value: string): boolean {
  return browserAddressableEventIdV1Schema.safeParse(value).success;
}

function summaryAssessment(value: CurrentAssessment): CurrentAssessmentProjection | null {
  if (value.state === "projected") return null;
  return {
    currentEventId: value.currentEventId,
    verdict: value.verdict,
    taskCompleted: value.taskCompleted,
    note: { ...value.note },
    reviewedAt: value.reviewedAt,
    updatedAt: value.updatedAt
  };
}

function summaryFromBatch(
  run: RunListRecord,
  batch: RunSummaryBatchRecord,
  capabilities: ProviderCapabilitiesLookup
): RunSummary {
  return summarizeRun({
    run: {
      id: run.id,
      provider: run.provider,
      capturePolicy: run.capturePolicy,
      startedAt: run.startedAt,
      endedAt: run.endedAt
    },
    events: batch.summaryEvents,
    gitEvidence: batch.gitEvidence === null ? null : {
      trackedFinalDiff: { ...batch.gitEvidence.trackedFinalDiff },
      untrackedMetadata: { ...batch.gitEvidence.untrackedMetadata }
    },
    // The batch intentionally contains no artifact path or bytes. List summaries
    // stay conservative instead of hydrating artifacts per row.
    validatedUntrackedFileCount: null,
    currentAssessment: summaryAssessment(batch.currentAssessment),
    providerCapabilities: capabilities.forProvider(run.provider)
  });
}

function runFilters(input: RunListQueryV1): RunCursorFilters {
  return {
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.repositoryFingerprint === undefined
      ? {}
      : { repositoryFingerprint: input.repositoryFingerprint }),
    ...(input.assessment === undefined ? {} : { assessment: input.assessment })
  };
}

function boundedCursorWindow(
  repository: RunRepository,
  runId: string,
  direction: "earlier" | "later",
  boundarySequence: number,
  snapshot: number,
  limit: number
): EventWindowRecord {
  const raw = repository.getEventWindow(runId, {
    mode: direction === "earlier" ? "before" : "after",
    sequence: boundarySequence,
    limit
  });
  if (raw.latestCommittedSequence === null || raw.latestCommittedSequence < snapshot) {
    throw new RunQueryServiceError("invalid_cursor");
  }
  const events = raw.events.filter(({ sequence }) => sequence <= snapshot);
  const first = events[0];
  const last = events.at(-1);
  const hasEarlier = first === undefined
    ? direction === "later" && boundarySequence > 0
    : direction === "later" || raw.hasEarlier;
  let hasLater = false;
  if (last !== undefined && last.sequence < snapshot) {
    const probe = repository.getEventWindow(runId, {
      mode: "after",
      sequence: last.sequence,
      limit: 1
    });
    hasLater = probe.events.some(({ sequence }) => sequence <= snapshot);
  }
  return Object.freeze({
    events,
    latestCommittedSequence: snapshot,
    hasEarlier,
    hasLater
  });
}

export function createRunQueryService(input: CreateRunQueryServiceInput): RunQueryService {
  async function read<T>(operation: (repository: RunRepository) => Promise<T> | T): Promise<T> {
    let opened: ReturnType<typeof openDatabaseForServerRead> | undefined;
    try {
      opened = openDatabaseForServerRead(input.databasePath);
      const repository = new RunRepository(opened.database, { artifactRoot: input.artifactRoot });
      return await withServerReadSnapshot(opened.database, () => operation(repository));
    } catch (error) {
      if (error instanceof ServerReadDatabaseError) {
        throw new RunQueryServiceError("active_snapshot_unavailable");
      }
      throw error;
    } finally {
      opened?.database.close();
    }
  }

  return Object.freeze({
    async listRuns(query: RunListQueryV1): Promise<RunPageV1> {
      return read(async (repository) => {
        if (!validLimit(query.limit, 100)) throw new RunQueryServiceError("invalid_request");
        const filters = runFilters(query);
        let before: ListRunPageInput["before"];
        if (query.cursor !== undefined) {
          const decoded = input.cursorCodec.decodeRun(query.cursor, filters);
          if (!decoded.ok) throw new RunQueryServiceError("invalid_cursor");
          before = decoded.value;
        }
        const page = repository.listRunPage({
          limit: query.limit,
          ...(before === undefined ? {} : { before }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.repositoryFingerprint === undefined
            ? {}
            : { repositoryFingerprint: query.repositoryFingerprint }),
          ...(query.assessment === undefined ? {} : { assessment: query.assessment })
        });
        const batches = repository.getRunSummaryBatch(page.items.map(({ id }) => id));
        const byRun = new Map(batches.map((batch) => [batch.runId, batch]));
        const ownershipByRun = new Map(
          repository.getOwnershipBatch(page.items.map(({ id }) => id))
            .map((ownership) => [ownership.runId, ownership])
        );
        const items = await Promise.all(page.items.map(async (run) => {
          const batch = byRun.get(run.id);
          if (batch === undefined) throw new Error("Run summary batch omitted a listed run.");
          const ownership = await diagnoseOwnership(
            run,
            ownershipByRun.get(run.id) ?? null,
            input.processIdentityInspector
          );
          return projectRunListItemV1({
            run,
            summary: summaryFromBatch(run, batch, input.providerCapabilities),
            ownership
          });
        }));
        const boundary = page.hasMore ? page.items.at(-1) : undefined;
        return runPageV1Schema.parse({
          schemaVersion: 1,
          items,
          nextCursor: boundary === undefined ? null : input.cursorCodec.encodeRun({
            filters,
            boundary: { startedAt: boundary.startedAt, runId: boundary.id }
          })
        });
      });
    },

    async getRun(runId: string): Promise<RunDetailV1 | null> {
      return read(async (repository) => {
        if (!validId(runId)) throw new RunQueryServiceError("invalid_request");
        const model = repository.getRunReadModel(runId);
        if (model === null) return null;
        const summary = await projectRunSummaryFromEvidence({
          run: model.run,
          events: model.summary.summaryEvents,
          gitEvidence: model.summary.gitEvidence,
          currentAssessment: model.summary.currentAssessment,
          untrackedMetadataArtifact: model.untrackedMetadataArtifact,
          artifactRoot: input.artifactRoot,
          providerCapabilities: input.providerCapabilities
        });
        const ownership = await diagnoseOwnership(
          model.run,
          model.ownership,
          input.processIdentityInspector
        );
        const projected = projectRunListItemV1({ run: model.run, summary, ownership });
        return runDetailV1Schema.parse({
          ...projected,
          gitState: model.summary.gitEvidence === null
            ? {
                state: "unavailable",
                reason: model.run.status === "starting" || model.run.status === "running"
                  ? "not_yet_available"
                  : "not_captured"
              }
            : {
                state: "available",
                initialHead: model.summary.gitEvidence.initialHead,
                finalHead: model.summary.gitEvidence.finalHead,
                initialBranch: model.summary.gitEvidence.initialBranch === null
                  ? { state: "detached" }
                  : { state: "attached", value: model.summary.gitEvidence.initialBranch },
                finalBranch: model.summary.gitEvidence.finalBranch === null
                  ? { state: "detached" }
                  : { state: "attached", value: model.summary.gitEvidence.finalBranch }
              },
          eventCount: model.eventCount,
          anchors: model.anchors
        });
      });
    },

    async getEvents(runId: string, query: EventPageQueryV1): Promise<TrajectoryPageV1> {
      return read((repository) => {
        if (!validId(runId) || !validLimit(query.limit, 250)) {
          throw new RunQueryServiceError("invalid_request");
        }
        const selectorCount = [query.cursor, query.afterSequence, query.aroundSequence]
          .filter((value) => value !== undefined).length;
        if (selectorCount > 1) throw new RunQueryServiceError("invalid_request");
        const run = repository.getRun(runId);
        if (run === null) {
          throw new RunQueryServiceError("run_not_found");
        }
        let window: EventWindowRecord;
        let mode: "head" | "tail" | "after" | "around" | "cursor";
        if (query.cursor !== undefined) {
          const decoded = input.cursorCodec.decodeEvent(query.cursor, { runId });
          if (!decoded.ok) throw new RunQueryServiceError("invalid_cursor");
          window = boundedCursorWindow(
            repository,
            runId,
            decoded.value.direction,
            decoded.value.boundarySequence,
            decoded.value.latestCommittedSequence,
            query.limit
          );
          mode = "cursor";
        } else if (query.afterSequence !== undefined) {
          if (!Number.isSafeInteger(query.afterSequence) || query.afterSequence < 0) {
            throw new RunQueryServiceError("invalid_request");
          }
          window = repository.getEventWindow(runId, {
            mode: "after",
            sequence: query.afterSequence,
            limit: query.limit
          });
          mode = "after";
        } else if (query.aroundSequence !== undefined) {
          if (!Number.isSafeInteger(query.aroundSequence) || query.aroundSequence < 0) {
            throw new RunQueryServiceError("invalid_request");
          }
          window = repository.getEventWindow(runId, {
            mode: "around",
            sequence: query.aroundSequence,
            limit: query.limit
          });
          mode = "around";
        } else {
          const active = run.status === "starting" || run.status === "running";
          window = repository.getEventWindow(runId, {
            mode: active ? "tail" : "head",
            limit: query.limit
          });
          mode = active ? "tail" : "head";
        }
        return projectTrajectoryPageV1(window, {
          runId,
          mode,
          sourceRefs: input.sourceRefProjector,
          cursors: input.cursorCodec,
          capturePolicy: run.capturePolicy
        });
      });
    },

    async getEvent(runId: string, eventId: string): Promise<EventDetailV1 | null> {
      return read((repository) => {
        if (!validId(runId) || !validEventId(eventId)) {
          throw new RunQueryServiceError("invalid_request");
        }
        const run = repository.getRun(runId);
        if (run === null) return null;
        const event = repository.getEvent(runId, eventId);
        return event === null
          ? null
          : eventDetailV1Schema.parse(projectEventDetailV1(event, run.capturePolicy));
      });
    }
  });
}
