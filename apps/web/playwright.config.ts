import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  outputDir: join(tmpdir(), `agentlens-playwright-${process.pid}`),
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    screenshot: "off",
    trace: "off",
    video: "off",
    reducedMotion: "no-preference"
  },
  projects: [{ name: "chromium-production", use: { browserName: "chromium" } }]
});
