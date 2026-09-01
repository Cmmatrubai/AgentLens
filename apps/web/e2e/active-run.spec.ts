import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";

test("active zero-event tail polling appends without forcing history and stops at terminal", async ({ page, productionUi, releaseFixture }) => {
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-running");
  await expect(page.getByText("No trajectory events are available for this run.")).toBeVisible();
  releaseFixture.appendActive(10);
  expect(releaseFixture.activeWalModes()).toEqual([0o600, 0o600, 0o600]);
  await expect(page.getByText("10 immutable events loaded")).toBeVisible({ timeout: 7_500 });
  const viewport = page.locator(".trajectory-viewport");
  await viewport.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  releaseFixture.appendActive(2);
  await expect(page.getByRole("button", { name: "2 new events" })).toBeVisible({ timeout: 7_500 });
  await page.getByRole("button", { name: "2 new events" }).click();
  await expect(page.locator('[role="option"][tabindex="0"]')).toBeVisible();
  await expect(page.getByText("Committed active event 12").first()).toBeVisible();
  releaseFixture.finishActive();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 7_500 });
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

  test("retains the existing trajectory", async ({ page, productionUi, releaseFixture }) => {
  await openBootstrapped(page, productionUi);
  releaseFixture.appendActive();
  expect(releaseFixture.activeWalModes()).toEqual([0o600, 0o600, 0o600]);
  await navigateToRun(page, "fixture-running");
  await expect(page.getByText("1 immutable events loaded")).toBeVisible();
  let intercepted = false;
  await page.route("**/api/v1/runs/fixture-running/events**", async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        error: { code: "active_snapshot_unavailable", message: "Active evidence is temporarily unavailable.", retryable: true }
      })
    });
  });
  releaseFixture.appendActive();
  await expect(page.getByText(/Live evidence temporarily unavailable/)).toBeVisible({ timeout: 7_500 });
  await expect(page.getByText("Committed active event 1")).toBeVisible();
  });
});
