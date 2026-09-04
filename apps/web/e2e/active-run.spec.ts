import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";

test("active zero-event tail polling appends without forcing history and stops at terminal", async ({
  page,
  productionUi,
  releaseFixture,
  requestLifecycle
}) => {
  await openBootstrapped(page, productionUi);
  const initialCheckpoint = requestLifecycle.checkpoint();
  const initialPoll = requestLifecycle.waitForPollGeneration(initialCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100"
  });
  await navigateToRun(page, "fixture-running");
  await expect(page.getByText("No trajectory events are available for this run.")).toBeVisible();
  await initialPoll;
  const appendedCheckpoint = requestLifecycle.checkpoint();
  const appendedSnapshot = requestLifecycle.waitForPollGeneration(appendedCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100"
  });
  releaseFixture.appendActive(10);
  expect(releaseFixture.activeWalModes()).toEqual([0o600, 0o600, 0o600]);
  await expect(page.getByText("10 immutable events loaded")).toBeVisible({ timeout: 7_500 });
  await appendedSnapshot;
  const viewport = page.locator(".trajectory-viewport");
  await viewport.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  const idleHistoryCheckpoint = requestLifecycle.checkpoint();
  await requestLifecycle.waitForPollGeneration(idleHistoryCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=9"
  });
  const historyAppendCheckpoint = requestLifecycle.checkpoint();
  const historyAppendSnapshot = requestLifecycle.waitForPollGeneration(historyAppendCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=9"
  });
  releaseFixture.appendActive(2);
  await expect(page.getByRole("button", { name: "2 new events" })).toBeVisible({ timeout: 7_500 });
  await historyAppendSnapshot;
  await page.getByRole("button", { name: "2 new events" }).click();
  await expect(page.locator('[role="option"][tabindex="0"]')).toBeVisible();
  await expect(page.getByText("Committed active event 12").first()).toBeVisible();
  const idleTerminalCheckpoint = requestLifecycle.checkpoint();
  await requestLifecycle.waitForPollGeneration(idleTerminalCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=11"
  });
  const terminalCheckpoint = requestLifecycle.checkpoint();
  const terminalSnapshot = requestLifecycle.waitForPollGeneration(terminalCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=11"
  });
  releaseFixture.finishActive();
  await Promise.all([
    expect(page.getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 7_500 }),
    terminalSnapshot
  ]);
  expect(requestLifecycle.describeActive(productionUi.origin)).toEqual([]);
});

test.describe("retryable active snapshot failure", () => {
  test.use({
    allowedSameOriginFailures: {
      responses: [
        { method: "GET", pathname: "/api/v1/runs/fixture-running", status: 503 },
        { method: "GET", pathname: "/api/v1/runs/fixture-running/events", status: 503 },
        { method: "GET", pathname: "/api/v1/runs/fixture-running/events", status: 503 }
      ]
    }
  });

  test("recovers initial and later safe snapshots without reflecting sidecar detail", async ({
    page, productionUi, releaseFixture, requestLifecycle
  }) => {
    await openBootstrapped(page, productionUi);
    releaseFixture.appendActive();
    expect(releaseFixture.activeWalModes()).toEqual([0o600, 0o600, 0o600]);
    const retryResponseBody = JSON.stringify({
      schemaVersion: 1,
      error: { code: "active_snapshot_unavailable", message: "Active evidence is temporarily unavailable.", retryable: true }
    });
    const retryResponseBodies: string[] = [];
    page.on("response", (response) => {
      if (response.status() !== 503 ||
          new URL(response.url()).pathname.startsWith("/api/v1/runs/fixture-running") === false) return;
      void response.text().then((body) => { retryResponseBodies.push(body); });
    });
    let refuseRun = true;
    let refusedEvents = 0;
    let refuseLaterEvent = false;
    let delayLaterEventRecovery = false;
    await page.route("**/api/v1/runs/fixture-running**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const isRun = pathname === "/api/v1/runs/fixture-running";
      const isEvents = pathname === "/api/v1/runs/fixture-running/events";
      if ((isRun && refuseRun) || (isEvents && (refusedEvents === 0 || refuseLaterEvent))) {
        if (isRun) refuseRun = false;
        if (isEvents) {
          refusedEvents += 1;
          refuseLaterEvent = false;
          delayLaterEventRecovery = refusedEvents === 2;
        }
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: retryResponseBody
        });
        return;
      }
      if (isEvents && delayLaterEventRecovery) {
        delayLaterEventRecovery = false;
        await new Promise<void>((resolve) => { setTimeout(resolve, 750); });
      }
      await route.continue();
    });

    const waitingForSnapshot = expect(page.getByLabel("Live evidence status")).toHaveText(
      "Waiting for a safe active snapshot · retrying automatically"
    );
    await page.locator('a[href="/runs/fixture-running"]').click();
    await expect(page).toHaveURL(/\/runs\/fixture-running(?:\?|$)/);
    await waitingForSnapshot;
    await expect(page.getByText("1 immutable events loaded")).toBeVisible({ timeout: 7_500 });
    await expect(page.getByLabel("Live evidence status")).toHaveCount(0);

    refuseLaterEvent = true;
    releaseFixture.appendActive();
    await expect(page.getByLabel("Live evidence status")).toHaveText(
      "Last safe snapshot · retrying automatically",
      { timeout: 7_500 }
    );
    await expect(page.getByText("1 immutable events loaded")).toBeVisible();
    await expect(page.getByText("Committed active event 1")).toBeVisible();
    await expect(page.getByLabel("Live evidence status")).toHaveCount(0);
    const terminalCheckpoint = requestLifecycle.checkpoint();
    const terminalPoll = requestLifecycle.waitForPollGeneration(terminalCheckpoint, {
      runId: "fixture-running",
      eventSearch: "?limit=100&afterSequence=1"
    });
    releaseFixture.finishActive();
    await Promise.all([
      terminalPoll,
      expect(page.getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 7_500 })
    ]);
    await expect.poll(() => retryResponseBodies.length).toBe(3);
    for (const body of retryResponseBodies) {
      expect(body).not.toMatch(/\/(?:Users|private|tmp)\b|-(?:wal|shm)\b/i);
    }
    expect(requestLifecycle.describeActive(productionUi.origin)).toEqual([]);
  });
});
