import { expect, expectNoHorizontalOverflow, navigateToRun, openBootstrapped, test } from "./fixtures.js";

test("a 1000-event run pages, virtualizes, selects, and supports keyboard navigation", async ({ page, productionUi }) => {
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-trajectory-1000");
  await expect(page.getByRole("heading", { name: "Execution trajectory" })).toBeVisible();
  const loadLater = page.getByRole("button", { name: "Load later" });
  await expect(page.getByText("100 immutable events loaded")).toBeVisible();
  for (let pageIndex = 0; pageIndex < 9; pageIndex += 1) {
    await loadLater.click();
    await expect(page.getByText(`${Math.min((pageIndex + 2) * 100, 1000).toLocaleString()} immutable events loaded`))
      .toBeVisible();
  }
  await expect(page.getByText("1,000 immutable events loaded")).toBeVisible();
  const rows = page.getByRole("option");
  expect(await rows.count()).toBeLessThan(30);
  const focused = rows.filter({ has: page.locator('[tabindex="0"]') });
  const first = rows.first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?event=/);
  await expectNoHorizontalOverflow(page);
});

test("selected evidence is inline at 800 pixels and reduced motion is honored", async ({ page, productionUi }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 800, height: 900 });
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-completed-recovery");
  await page.getByRole("button", { name: "Jump to first failure" }).click();
  await expect(page.getByTestId("inline-event-inspector")).toBeVisible();
  await expect(page.locator('[data-motion="reduced"]')).not.toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
