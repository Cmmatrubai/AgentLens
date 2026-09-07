import { expect, expectNoHorizontalOverflow, openBootstrapped, test } from "./fixtures.js";

test("one-use bootstrap opens the evidence ledger, filters it, and expires on reload", async ({
  page,
  productionUi,
  requestLifecycle
}) => {
  const initialCheckpoint = requestLifecycle.checkpoint();
  await openBootstrapped(page, productionUi);
  // Let the initial ledger load before this journey replaces its query.
  const initialRequest = await requestLifecycle.waitForTerminal(initialCheckpoint, {
    method: "GET",
    origin: productionUi.origin,
    pathname: "/api/v1/runs",
    search: "?limit=50"
  });
  expect(initialRequest.terminal.state).toBe("finished");
  await page.getByLabel("Run status").selectOption("completed");
  const checkpoint = requestLifecycle.checkpoint();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=completed/);
  await expect(page.getByText("Test-bearing commands: latest passed, previous failures 1")).toBeVisible();
  await requestLifecycle.waitForTerminal(checkpoint, {
    method: "GET",
    origin: productionUi.origin,
    pathname: "/api/v1/runs",
    search: "?limit=50&status=completed"
  });
  await expectNoHorizontalOverflow(page);
  await page.reload({ waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Authentication expired" })).toBeVisible();
});

test("the frozen layouts retain evidence without page overflow", async ({ page, productionUi }) => {
  await openBootstrapped(page, productionUi);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1100, height: 900 },
    { width: 800, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByText(/Final Git evidence:/).first()).toBeVisible();
    await expect(page.getByText(/Reviewer:/).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});
