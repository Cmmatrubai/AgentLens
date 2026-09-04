export interface BrowserRequestLike {
  failure(): Readonly<{ errorText: string }> | null;
  headers(): Readonly<Record<string, string>>;
  method(): string;
  resourceType(): string;
  url(): string;
}

export const requestCorrelationHeader = "x-agentlens-e2e-request-correlation";
export const requestInstanceHeader = "x-agentlens-e2e-request-instance";

export type PageRequestTerminalObservation = Readonly<{
  requestInstance: string;
  method: string;
  url: string;
}> & (
  | Readonly<{ state: "finished" }>
  | Readonly<{ state: "failed"; errorText: string }>
);

type CorrelationTarget = Readonly<{
  Headers: typeof Headers;
  Request: typeof Request;
  ReadableStream: typeof ReadableStream;
  ReadableStreamDefaultReader: typeof ReadableStreamDefaultReader;
  Response: typeof Response;
  crypto: Pick<Crypto, "randomUUID">;
}> & {
  fetch: typeof fetch;
  __agentLensE2ECorrelationInstalled?: boolean;
  __agentLensE2EReportRequestLifecycle?: (observation: PageRequestTerminalObservation) => Promise<void>;
};

export function installE2ERequestCorrelation(
  target: CorrelationTarget = globalThis as unknown as CorrelationTarget
): void {
  if (target.__agentLensE2ECorrelationInstalled === true) return;
  const originalFetch = target.fetch.bind(target);
  const correlations = new WeakMap<AbortSignal, string>();
  const documentIdentity = target.crypto.randomUUID();
  let nextCorrelation = 1;
  let nextRequestInstance = 1;
  type MutablePageRequest = {
    errorText?: string;
    method: string;
    requestInstance: string;
    settled: boolean;
    signal: AbortSignal | null;
    url: string;
  };
  const streams = new WeakMap<ReadableStream, MutablePageRequest>();
  const readers = new WeakMap<ReadableStreamDefaultReader, MutablePageRequest>();
  const responses = new WeakMap<Response, MutablePageRequest>();
  const report = async (
    request: MutablePageRequest,
    state: "failed" | "finished",
    errorText?: string
  ): Promise<void> => {
    if (request.settled) return;
    request.settled = true;
    await target.__agentLensE2EReportRequestLifecycle?.({
      requestInstance: request.requestInstance,
      method: request.method,
      url: request.url,
      ...(state === "finished"
        ? { state }
        : { state, errorText: errorText ?? "browser_fetch_failed" })
    });
  };
  const originalGetReader = target.ReadableStream.prototype.getReader;
  target.ReadableStream.prototype.getReader = function getReader(...args: unknown[]) {
    const reader = Reflect.apply(originalGetReader, this, args) as ReadableStreamDefaultReader;
    const request = streams.get(this);
    if (request !== undefined) readers.set(reader, request);
    return reader;
  } as typeof originalGetReader;
  const originalRead = target.ReadableStreamDefaultReader.prototype.read;
  target.ReadableStreamDefaultReader.prototype.read = async function read() {
    const request = readers.get(this);
    try {
      const result = await originalRead.call(this);
      if (request !== undefined && result.done) await report(request, "finished");
      return result;
    } catch (error) {
      if (request !== undefined) {
        await report(
          request,
          "failed",
          request.signal?.aborted === true ? "signal_aborted" : "body_read_failed"
        );
      }
      throw error;
    }
  } as typeof originalRead;
  const originalReaderCancel = target.ReadableStreamDefaultReader.prototype.cancel;
  target.ReadableStreamDefaultReader.prototype.cancel = async function cancel(reason?: unknown) {
    const request = readers.get(this);
    try {
      return await originalReaderCancel.call(this, reason);
    } finally {
      if (request !== undefined) await report(request, "failed", "body_cancelled");
    }
  } as typeof originalReaderCancel;
  const originalStreamCancel = target.ReadableStream.prototype.cancel;
  target.ReadableStream.prototype.cancel = async function cancel(reason?: unknown) {
    const request = streams.get(this);
    try {
      return await originalStreamCancel.call(this, reason);
    } finally {
      if (request !== undefined) await report(request, "failed", "body_cancelled");
    }
  } as typeof originalStreamCancel;
  const responseBodyMethods = ["arrayBuffer", "blob", "formData", "json", "text"] as const;
  for (const method of responseBodyMethods) {
    const descriptor = Object.getOwnPropertyDescriptor(target.Response.prototype, method);
    const originalMethod = descriptor?.value;
    if (typeof originalMethod !== "function") continue;
    Object.defineProperty(target.Response.prototype, method, {
      ...descriptor,
      value: async function consumeResponseBody(this: Response, ...args: unknown[]): Promise<unknown> {
        const request = responses.get(this);
        try {
          const result = await Reflect.apply(originalMethod, this, args);
          if (request !== undefined) await report(request, "finished");
          return result;
        } catch (error) {
          if (request !== undefined) {
            await report(
              request,
              "failed",
              request.signal?.aborted === true ? "signal_aborted" : "body_read_failed"
            );
          }
          throw error;
        }
      }
    });
  }
  target.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestInput = input instanceof target.Request ? input : null;
    const signal = init?.signal ?? requestInput?.signal;
    let correlation: string | undefined;
    if (signal !== undefined && signal !== null) {
      correlation = correlations.get(signal);
      if (correlation === undefined) {
        correlation = `${documentIdentity}:${nextCorrelation++}`;
        correlations.set(signal, correlation);
      }
    }
    const requestInstance = `${documentIdentity}:request:${nextRequestInstance++}`;
    const headers = new target.Headers(init?.headers ?? requestInput?.headers);
    if (correlation !== undefined) headers.set("x-agentlens-e2e-request-correlation", correlation);
    headers.set("x-agentlens-e2e-request-instance", requestInstance);
    const request: MutablePageRequest = {
      method: (init?.method ?? requestInput?.method ?? "GET").toUpperCase(),
      requestInstance,
      settled: false,
      signal: signal ?? null,
      url: requestInput?.url ?? input.toString()
    };
    try {
      const response = await originalFetch(input, { ...init, headers });
      responses.set(response, request);
      if (response.body === null) await report(request, "finished");
      else streams.set(response.body, request);
      return response;
    } catch (error) {
      await report(
        request,
        "failed",
        request.signal?.aborted === true ? "signal_aborted" : "fetch_rejected"
      );
      throw error;
    }
  }) as typeof fetch;
  target.__agentLensE2ECorrelationInstalled = true;
}

export type RequestTerminalState =
  | Readonly<{ state: "active" }>
  | Readonly<{ state: "finished" }>
  | Readonly<{ state: "failed"; errorText: string }>;

export interface RequestLifecycleRecord<TRequest extends BrowserRequestLike = BrowserRequestLike> {
  readonly id: number;
  readonly method: string;
  readonly pollCorrelation: string | null;
  readonly pollGeneration: number | null;
  readonly request: TRequest;
  readonly requestCorrelation: string | null;
  readonly requestInstance: string | null;
  readonly resourceType: string;
  readonly terminal: RequestTerminalState;
  readonly terminalSequence: number | null;
  readonly transportTerminal: RequestTerminalState;
  readonly transportTerminalSequence: number | null;
  readonly url: string;
}

export interface RequestMatch<TRequest extends BrowserRequestLike = BrowserRequestLike> {
  readonly method?: string;
  readonly origin?: string;
  readonly pathname?: string;
  readonly search?: string;
  readonly predicate?: (record: RequestLifecycleRecord<TRequest>) => boolean;
}

export interface PollGenerationRecord<TRequest extends BrowserRequestLike = BrowserRequestLike> {
  readonly correlation: string;
  readonly events: RequestLifecycleRecord<TRequest>;
  readonly generation: number;
  readonly run: RequestLifecycleRecord<TRequest>;
}

interface MutableRequestRecord<TRequest extends BrowserRequestLike> {
  id: number;
  method: string;
  pollCorrelation: string | null;
  pollGeneration: number | null;
  pageTerminal: RequestTerminalState | null;
  request: TRequest;
  requestCorrelation: string | null;
  requestInstance: string | null;
  resourceType: string;
  terminalSequence: number | null;
  transportTerminal: RequestTerminalState;
  transportTerminalSequence: number | null;
  url: string;
}

type ChangeListener = () => void;

interface MutablePollGroup<TRequest extends BrowserRequestLike> {
  correlation: string;
  events?: MutableRequestRecord<TRequest>;
  generation: number | null;
  run?: MutableRequestRecord<TRequest>;
  runId: string;
}

function snapshot<TRequest extends BrowserRequestLike>(
  record: MutableRequestRecord<TRequest>
): RequestLifecycleRecord<TRequest> {
  const terminal = record.pageTerminal ?? record.transportTerminal;
  return {
    id: record.id,
    method: record.method,
    pollCorrelation: record.pollCorrelation,
    pollGeneration: record.pollGeneration,
    request: record.request,
    requestCorrelation: record.requestCorrelation,
    requestInstance: record.requestInstance,
    resourceType: record.resourceType,
    terminal,
    terminalSequence: record.terminalSequence,
    transportTerminal: record.transportTerminal,
    transportTerminalSequence: record.transportTerminalSequence,
    url: record.url
  };
}

function requestRunId(url: URL, origin: string): Readonly<{
  kind: "events" | "run";
  runId: string;
}> | null {
  if (url.origin !== origin) return null;
  const matched = /^\/api\/v1\/runs\/([^/]+)(\/events)?$/u.exec(url.pathname);
  if (matched === null) return null;
  if (matched[2] === undefined && url.search !== "") return null;
  if (matched[2] !== undefined &&
      (!url.searchParams.has("limit") || url.searchParams.has("cursor") || url.searchParams.has("aroundSequence"))) {
    return null;
  }
  return {
    kind: matched[2] === undefined ? "run" : "events",
    runId: decodeURIComponent(matched[1]!)
  };
}

export class RequestLifecycleLedger<TRequest extends BrowserRequestLike = BrowserRequestLike> {
  readonly #origin: string;
  readonly #records: MutableRequestRecord<TRequest>[] = [];
  readonly #recordsByRequest = new Map<TRequest, MutableRequestRecord<TRequest>>();
  readonly #recordsByRequestInstance = new Map<string, MutableRequestRecord<TRequest>>();
  readonly #listeners = new Set<ChangeListener>();
  readonly #pendingPageTerminals = new Map<string, PageRequestTerminalObservation>();
  readonly #pollGroups = new Map<string, MutablePollGroup<TRequest>>();
  readonly #pollGenerations = new Map<string, number>();
  readonly #violations: string[] = [];
  #nextId = 1;
  #nextTerminalSequence = 0;
  #nextTransportTerminalSequence = 0;

  constructor(origin: string) {
    this.#origin = new URL(origin).origin;
  }

  started(request: TRequest): RequestLifecycleRecord<TRequest> {
    if (this.#recordsByRequest.has(request)) {
      throw new Error("Browser request was registered more than once.");
    }
    const headers = request.headers();
    const requestCorrelation = this.#header(headers, requestCorrelationHeader);
    const requestInstance = this.#header(headers, requestInstanceHeader);
    const validCorrelation = this.#validToken(requestCorrelation, "correlation", this.#nextId);
    const validRequestInstance = this.#validToken(requestInstance, "request instance", this.#nextId);
    const record: MutableRequestRecord<TRequest> = {
      id: this.#nextId++,
      method: request.method(),
      pageTerminal: validRequestInstance === null ? null : { state: "active" },
      pollCorrelation: null,
      pollGeneration: null,
      request,
      requestCorrelation: validCorrelation,
      requestInstance: validRequestInstance,
      resourceType: request.resourceType(),
      terminalSequence: null,
      transportTerminal: { state: "active" },
      transportTerminalSequence: null,
      url: request.url()
    };
    this.#records.push(record);
    this.#recordsByRequest.set(request, record);
    if (validRequestInstance !== null) {
      const duplicate = this.#recordsByRequestInstance.get(validRequestInstance);
      if (duplicate !== undefined) {
        this.#violations.push(
          `request instance ${validRequestInstance} was assigned to requests #${duplicate.id} and #${record.id}`
        );
      } else {
        this.#recordsByRequestInstance.set(validRequestInstance, record);
        const pending = this.#pendingPageTerminals.get(validRequestInstance);
        if (pending !== undefined) {
          this.#pendingPageTerminals.delete(validRequestInstance);
          this.#applyPageTerminal(record, pending);
        }
      }
    }
    this.#correlatePoll(record);
    this.#publish();
    return snapshot(record);
  }

  finished(request: TRequest): RequestLifecycleRecord<TRequest> {
    return this.#settle(request, { state: "finished" });
  }

  failed(request: TRequest): RequestLifecycleRecord<TRequest> {
    return this.#settle(request, {
      state: "failed",
      errorText: request.failure()?.errorText ?? "unknown"
    });
  }

  checkpoint(): number {
    return this.#nextId - 1;
  }

  pageSettled(observation: unknown): void {
    if (!this.#validObservation(observation)) {
      this.#violations.push("page request lifecycle reported an invalid observation");
      this.#publish();
      return;
    }
    const record = this.#recordsByRequestInstance.get(observation.requestInstance);
    if (record === undefined) {
      if (this.#pendingPageTerminals.has(observation.requestInstance)) {
        this.#violations.push(
          `page request lifecycle reported request instance ${observation.requestInstance} more than once`
        );
      } else {
        this.#pendingPageTerminals.set(observation.requestInstance, observation);
      }
      this.#publish();
      return;
    }
    this.#applyPageTerminal(record, observation);
    this.#publish();
  }

  waitForTerminal(
    checkpoint: number,
    match: RequestMatch<TRequest>
  ): Promise<RequestLifecycleRecord<TRequest>> {
    return this.#waitFor(() => {
      const record = this.#records.find((candidate) =>
        candidate.id > checkpoint &&
        snapshot(candidate).terminal.state !== "active" &&
        this.#matches(candidate, match)
      );
      return record === undefined ? null : snapshot(record);
    });
  }

  waitForPollGeneration(
    checkpoint: number,
    input: Readonly<{ runId: string; eventSearch: string }>
  ): Promise<PollGenerationRecord<TRequest>> {
    return this.#waitFor(() => {
      const events = this.#records.find((candidate) => {
        if (candidate.id <= checkpoint || candidate.pollGeneration === null ||
            snapshot(candidate).terminal.state === "active") {
          return false;
        }
        const requested = new URL(candidate.url);
        return candidate.method === "GET" &&
          requested.origin === this.#origin &&
          requested.pathname === `/api/v1/runs/${encodeURIComponent(input.runId)}/events` &&
          requested.search === input.eventSearch;
      });
      if (events?.pollGeneration === null || events?.pollGeneration === undefined) return null;
      const run = this.#records.find((candidate) =>
        candidate.id > checkpoint &&
        candidate.pollGeneration === events.pollGeneration &&
        snapshot(candidate).terminal.state !== "active" &&
        new URL(candidate.url).pathname === `/api/v1/runs/${encodeURIComponent(input.runId)}`
      );
      if (run === undefined) return null;
      return {
        correlation: events.pollCorrelation!,
        events: snapshot(events),
        generation: events.pollGeneration,
        run: snapshot(run)
      };
    });
  }

  snapshot(): readonly RequestLifecycleRecord<TRequest>[] {
    return this.#records.map(snapshot);
  }

  active(): readonly RequestLifecycleRecord<TRequest>[] {
    return this.#records
      .filter((record) => snapshot(record).terminal.state === "active")
      .map(snapshot);
  }

  violations(): readonly string[] {
    return [
      ...this.#violations,
      ...[...this.#pendingPageTerminals.keys()].map((requestInstance) =>
        `page request lifecycle reported unknown request instance ${requestInstance}`)
    ];
  }

  describe(origin?: string): readonly string[] {
    const expectedOrigin = origin === undefined ? null : new URL(origin).origin;
    return this.#records.filter((record) =>
      expectedOrigin === null || new URL(record.url).origin === expectedOrigin
    ).map((record) => this.#describe(record, true));
  }

  describeActive(origin?: string): readonly string[] {
    const expectedOrigin = origin === undefined ? null : new URL(origin).origin;
    return this.active().filter((record) =>
      expectedOrigin === null || new URL(record.url).origin === expectedOrigin
    ).map((record) => this.#describe(record, false));
  }

  #describe(record: MutableRequestRecord<TRequest>, includeTerminal: boolean): string {
    const requested = new URL(record.url);
    const pathname = requested.pathname.startsWith("/bootstrap/")
      ? "/bootstrap/[consumed]"
      : requested.pathname;
    const effectiveTerminal = snapshot(record).terminal;
    const terminal = includeTerminal
      ? ` terminal=${effectiveTerminal.state}` +
        (record.terminalSequence === null ? "" : `@${record.terminalSequence}`) +
        (effectiveTerminal.state === "failed" ? `(${effectiveTerminal.errorText})` : "") +
        ` transport=${record.transportTerminal.state}` +
        (record.transportTerminalSequence === null ? "" : `@${record.transportTerminalSequence}`) +
        (record.transportTerminal.state === "failed" ? `(${record.transportTerminal.errorText})` : "")
      : "";
    return `#${record.id} poll=${record.pollGeneration ?? "none"} ` +
      `correlation=${record.pollCorrelation ?? "none"}${terminal} ${record.resourceType} ` +
      `${record.method} ${requested.origin}${pathname}${requested.search}`;
  }

  #correlatePoll(record: MutableRequestRecord<TRequest>): void {
    if (record.method !== "GET") return;
    const classified = requestRunId(new URL(record.url), this.#origin);
    if (classified === null) return;
    const correlation = record.requestCorrelation;
    if (correlation === null) return;
    record.pollCorrelation = correlation;
    const groupKey = JSON.stringify([classified.runId, correlation]);
    const group = this.#pollGroups.get(groupKey) ?? {
      correlation,
      generation: null,
      runId: classified.runId
    };
    const previous = group[classified.kind];
    if (previous !== undefined && snapshot(previous).terminal.state === "active") {
      this.#violations.push(
        `correlation ${correlation} assigned more than one ${classified.kind} request for run ${classified.runId}`
      );
      return;
    }
    group[classified.kind] = record;
    this.#pollGroups.set(groupKey, group);
    if (group.generation !== null) {
      record.pollGeneration = group.generation;
      return;
    }
    if (group.run === undefined || group.events === undefined) return;
    const generation = (this.#pollGenerations.get(classified.runId) ?? 0) + 1;
    this.#pollGenerations.set(classified.runId, generation);
    group.generation = generation;
    group.run.pollGeneration = generation;
    group.events.pollGeneration = generation;
  }

  #matches(record: MutableRequestRecord<TRequest>, match: RequestMatch<TRequest>): boolean {
    const requested = new URL(record.url);
    if (match.method !== undefined && record.method !== match.method) return false;
    if (match.origin !== undefined && requested.origin !== match.origin) return false;
    if (match.pathname !== undefined && requested.pathname !== match.pathname) return false;
    if (match.search !== undefined && requested.search !== match.search) return false;
    return match.predicate?.(snapshot(record)) ?? true;
  }

  #applyPageTerminal(
    record: MutableRequestRecord<TRequest>,
    observation: PageRequestTerminalObservation
  ): void {
    if (record.pageTerminal === null) {
      this.#violations.push(
        `page request lifecycle reported uninstrumented request #${record.id}`
      );
      return;
    }
    if (record.pageTerminal.state !== "active") {
      this.#violations.push(
        `page request lifecycle reported request instance ${observation.requestInstance} more than once`
      );
      return;
    }
    let observedUrl: string;
    try {
      observedUrl = new URL(observation.url, this.#origin).href;
    } catch {
      this.#violations.push(`page request lifecycle reported an invalid URL for request #${record.id}`);
      return;
    }
    if (observation.method.toUpperCase() !== record.method.toUpperCase() || observedUrl !== record.url) {
      this.#violations.push(`page request lifecycle identity did not match request #${record.id}`);
      return;
    }
    record.pageTerminal = observation.state === "finished"
      ? { state: "finished" }
      : { state: "failed", errorText: observation.errorText };
    record.terminalSequence = this.#nextTerminalSequence++;
  }

  #header(headers: Readonly<Record<string, string>>, name: string): string | null {
    return Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === name)?.[1] ?? null;
  }

  #validObservation(observation: unknown): observation is PageRequestTerminalObservation {
    if (typeof observation !== "object" || observation === null) return false;
    const candidate = observation as Partial<PageRequestTerminalObservation>;
    return typeof candidate.requestInstance === "string" &&
      this.#validTokenValue(candidate.requestInstance) &&
      typeof candidate.method === "string" && candidate.method.length >= 1 && candidate.method.length <= 16 &&
      typeof candidate.url === "string" && candidate.url.length >= 1 && candidate.url.length <= 8_192 &&
      (candidate.state === "finished" ||
        (candidate.state === "failed" && "errorText" in candidate && typeof candidate.errorText === "string" &&
          candidate.errorText.length >= 1 && candidate.errorText.length <= 128));
  }

  #validToken(value: string | null, label: string, requestId: number): string | null {
    if (value === null) return null;
    if (this.#validTokenValue(value)) return value;
    this.#violations.push(`request #${requestId} supplied an invalid E2E ${label} token`);
    return null;
  }

  #validTokenValue(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
  }

  #publish(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #settle(
    request: TRequest,
    terminal: Exclude<RequestTerminalState, Readonly<{ state: "active" }>>
  ): RequestLifecycleRecord<TRequest> {
    const record = this.#recordsByRequest.get(request);
    if (record === undefined) throw new Error("Browser request settled before it was registered.");
    if (record.transportTerminal.state !== "active") throw new Error("Browser request settled more than once.");
    record.transportTerminal = terminal;
    record.transportTerminalSequence = this.#nextTransportTerminalSequence++;
    if (record.pageTerminal === null) record.terminalSequence = this.#nextTerminalSequence++;
    this.#publish();
    return snapshot(record);
  }

  #waitFor<T>(read: () => T | null): Promise<T> {
    const current = read();
    if (current !== null) return Promise.resolve(current);
    return new Promise<T>((resolve) => {
      const listener = (): void => {
        const next = read();
        if (next === null) return;
        this.#listeners.delete(listener);
        resolve(next);
      };
      this.#listeners.add(listener);
    });
  }
}
