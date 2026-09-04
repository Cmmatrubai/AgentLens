import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startAgentLensServer } from "../../server/src/startServer.js";
import { createFixtureDataRoot } from "./fixtureDataRoot.js";

const fixture = await createFixtureDataRoot();
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "dist", "web");
const handle = await startAgentLensServer({ dataRoot: fixture.dataRoot, webRoot });

process.stdout.write(`${handle.bootstrapUrl}\n`);

let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await handle.close();
  await rm(fixture.root, { recursive: true, force: true });
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void close().finally(() => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    });
  });
}

await new Promise<void>((resolve) => {
  const timer = setInterval(() => undefined, 60_000);
  const finish = (): void => {
    clearInterval(timer);
    resolve();
  };
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
});

await close();
