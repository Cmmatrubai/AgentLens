import { createServer, type RequestListener } from "node:http";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCursorCodec,
  createAssessmentService,
  createEvidenceService,
  createRunQueryService,
  createSourceRefProjector,
  systemProcessIdentityInspector
} from "@agentlens/application";
import { codexExecCapabilities, type AdapterCapabilities } from "@agentlens/core";
import { createAgentLensRouter } from "./router.js";
import { loadStaticAssets, type StaticAssets } from "./staticAssets.js";
import {
  createTokenBytes,
  encodeToken,
  type TokenBytesFactory
} from "./security/tokens.js";

export interface StartAgentLensServerOptions {
  readonly dataRoot: string;
  readonly webRoot?: string;
  readonly host?: "127.0.0.1";
  readonly port?: number;
  readonly tokenBytes?: TokenBytesFactory;
}

export interface AgentLensServerHandle {
  readonly origin: string;
  readonly bootstrapUrl: string;
  close(): Promise<void>;
}

export function resolveDefaultWebRoot(moduleUrl: string): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  return basename(moduleDirectory) === "src"
    ? join(moduleDirectory, "..", "dist", "web")
    : join(moduleDirectory, "web");
}

function defaultWebRoot(): string {
  return resolveDefaultWebRoot(import.meta.url);
}

const unavailableProviderCapabilities: AdapterCapabilities = Object.freeze({
  sourceTimestamps: false,
  fileReads: "unavailable",
  toolOutput: "unavailable",
  toolDurations: "unavailable",
  interruptionSignal: "recorder_only"
});

export async function startAgentLensServer(
  options: StartAgentLensServerOptions
): Promise<AgentLensServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (host !== "127.0.0.1") throw new Error("AgentLens UI requires the loopback host.");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("AgentLens UI port is invalid.");
  }

  let staticAssets: StaticAssets;
  try {
    staticAssets = await loadStaticAssets(options.webRoot ?? defaultWebRoot());
  } catch {
    throw new Error("AgentLens web assets are unavailable.");
  }
  const bearer = createTokenBytes(options.tokenBytes);
  const bootstrapCode = encodeToken(createTokenBytes(options.tokenBytes));
  let listener: RequestListener = (_request, response) => {
    response.writeHead(503, { "Cache-Control": "no-store" });
    response.end();
  };
  const server = createServer((request, response) => {
    void Promise.resolve(listener(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" });
      response.end();
    });
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  if (address === null || typeof address === "string" || address.address !== "127.0.0.1") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("AgentLens UI did not bind to the required loopback address.");
  }
  const expectedHost = `127.0.0.1:${address.port}`;
  const origin = `http://${expectedHost}`;
  const runQueries = createRunQueryService({
    databasePath: join(options.dataRoot, "agentlens.sqlite"),
    artifactRoot: join(options.dataRoot, "artifacts", "sha256"),
    cursorCodec: createCursorCodec(),
    sourceRefProjector: createSourceRefProjector(),
    processIdentityInspector: systemProcessIdentityInspector,
    providerCapabilities: {
      forProvider: (provider) => provider === "codex-exec"
        ? codexExecCapabilities
        : unavailableProviderCapabilities
    }
  });
  const evidence = createEvidenceService({
    databasePath: join(options.dataRoot, "agentlens.sqlite"),
    artifactRoot: join(options.dataRoot, "artifacts", "sha256")
  });
  const assessment = createAssessmentService({ dataRoot: options.dataRoot });
  listener = createAgentLensRouter({
    origin,
    expectedHost,
    bearer,
    bootstrapCode,
    staticAssets,
    health: () => ({ schemaVersion: 1, ready: true, readModel: "ready" }),
    runQueries,
    evidence,
    assessment
  });

  let closePromise: Promise<void> | undefined;
  return {
    origin,
    bootstrapUrl: `${origin}/bootstrap/${bootstrapCode}`,
    close() {
      closePromise ??= new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closePromise;
    }
  };
}
