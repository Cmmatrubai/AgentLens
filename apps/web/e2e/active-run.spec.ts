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
  releaseFixture.appendActive(20);
  expect(releaseFixture.activeWalModes()).toEqual([0o600, 0o600, 0o600]);
  await expect(page.getByText("20 immutable events loaded")).toBeVisible({ timeout: 7_500 });
  await appendedSnapshot;
  const viewport = page.locator(".trajectory-viewport");
  await viewport.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  const idleHistoryCheckpoint = requestLifecycle.checkpoint();
  await requestLifecycle.waitForPollGeneration(idleHistoryCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=19"
  });
  const historyAppendCheckpoint = requestLifecycle.checkpoint();
  const historyAppendSnapshot = requestLifecycle.waitForPollGeneration(historyAppendCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=19"
  });
  releaseFixture.appendActive(2);
  await expect(page.getByRole("button", { name: "2 new events" })).toBeVisible({ timeout: 7_500 });
  await historyAppendSnapshot;
  await page.getByRole("button", { name: "2 new events" }).click();
  await expect(page.locator('[role="option"][tabindex="0"]')).toBeVisible();
  await expect(page.getByText("Committed active event 22").first()).toBeVisible();
  const idleTerminalCheckpoint = requestLifecycle.checkpoint();
  await requestLifecycle.waitForPollGeneration(idleTerminalCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=21"
  });
  const terminalCheckpoint = requestLifecycle.checkpoint();
  const terminalSnapshot = requestLifecycle.waitForPollGeneration(terminalCheckpoint, {
    runId: "fixture-running",
    eventSearch: "?limit=100&afterSequence=21"
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
      responses: [{
        method: "GET",
        pathname: "/api/v1/runs/fixture-running/events",
        status: 503
      }]
    }
  });

  test("retains the existing trajectory", async ({ page, productionUi, releaseFixture, requestLifecycle }) => {
    await openBootstrapped(page, productionUi);
    releaseFixture.appendActive();
    expect(releaseFixture.activeWalModes()).toEqual([0o600, 0o600, 0o600]);
    await navigateToRun(page, "fixture-running");
    await expect(page.getByText("1 immutable events loaded")).toBeVisible();
    let injected = false;
    await page.route("**/api/v1/runs/fixture-running/events**", async (route) => {
      if (!injected) {
        injected = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: 1,
            error: { code: "active_snapshot_unavailable", message: "Active evidence is temporarily unavailable.", retryable: true }
          })
        });
        return;
      }
      await route.continue();
    });
    const failedCheckpoint = requestLifecycle.checkpoint();
    const failedPoll = requestLifecycle.waitForPollGeneration(failedCheckpoint, {
      runId: "fixture-running",
      eventSearch: "?limit=100&afterSequence=0"
    });
    const degradedVisible = expect(page.getByText(/Live evidence temporarily unavailable/))
      .toBeVisible({ timeout: 7_500 });
    releaseFixture.appendActive();
    const [failedGeneration] = await Promise.all([failedPoll, degradedVisible]);
    expect((await failedGeneration.events.request.response())?.status()).toBe(503);
    const recoveredCheckpoint = requestLifecycle.checkpoint();
    const recoveredPoll = requestLifecycle.waitForPollGeneration(recoveredCheckpoint, {
      runId: "fixture-running",
      eventSearch: "?limit=100&afterSequence=0"
    });
    const recoveredGeneration = await recoveredPoll;
    expect((await recoveredGeneration.events.request.response())?.status()).toBe(200);
    await expect(page.getByText("Committed active event 1")).toBeVisible();
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
    expect(requestLifecycle.describeActive(productionUi.origin)).toEqual([]);
  });
});
