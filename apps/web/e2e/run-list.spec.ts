import { expect, expectNoHorizontalOverflow, openBootstrapped, test } from "./fixtures.js";

test("one-use bootstrap opens the evidence ledger, filters it, and expires on reload", async ({
  page,
  productionUi,
  requestLifecycle
}) => {
  await openBootstrapped(page, productionUi);
  await expect(page.locator(".run-ledger__item").first()).toBeVisible();
  await page.getByLabel("Run status").selectOption("completed");
  const checkpoint = requestLifecycle.checkpoint();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=completed/);
  await expect(page.getByText("Latest likely test: passed · 1 previous failure")).toBeVisible();
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
    { width: 800, height: 900 },
    { width: 520, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByText("Lifecycle", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Likely tests", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Human review", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Final Git evidence:/).first()).toBeVisible();
    await expect(page.getByText(/Reviewer:/).first()).toBeVisible();
    if (viewport.width === 520) {
      const criticalCellGeometry = await page.locator(".run-ledger__item").first().locator([
        ".run-row__identity",
        ".run-row__status",
        ".run-row__evidence div",
        ".run-row__timing"
      ].join(", ")).evaluateAll((cells) => cells.map((cell) => {
        const { x, width } = cell.getBoundingClientRect();
        return { width, x };
      }));
      for (const cell of criticalCellGeometry.slice(1)) {
        expect(cell.x).toBeCloseTo(criticalCellGeometry[0].x, 3);
        expect(cell.width).toBeCloseTo(criticalCellGeometry[0].width, 3);
      }
    }
    await expectNoHorizontalOverflow(page);
  }
});
