import { expect, expectNoHorizontalOverflow, openBootstrapped, test } from "./fixtures.js";

test("the desktop ledger is flat, dense, and evidence-complete", async ({ page, productionUi }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBootstrapped(page, productionUi);
  await expect(page.locator(".run-ledger__item").first()).toBeVisible();
  const visibleRows = await page.locator(".run-ledger__item").evaluateAll((rows) =>
    rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    }).length
  );
  expect(visibleRows).toBeGreaterThanOrEqual(6);
  await expect(page.getByText("Likely tests").first()).toBeVisible();
  await expect(page.getByText("Human review").first()).toBeVisible();
  await expect(page.getByText("Git").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
