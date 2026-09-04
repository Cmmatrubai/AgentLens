import { expect, expectNoHorizontalOverflow, navigateToRun, openBootstrapped, test } from "./fixtures.js";

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
  const standardRowHeight = await page.getByRole("link", {
    name: "fixture trajectory 10 evidence — inspect run evidence"
  }).locator("xpath=ancestor::li").evaluate((row) => row.getBoundingClientRect().height);
  expect(standardRowHeight).toBeLessThanOrEqual(104);
  await expect(page.getByText("Likely tests").first()).toBeVisible();
  await expect(page.getByText("Human review").first()).toBeVisible();
  await expect(page.getByText("Git").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("about ten trajectory events remain visible and selection does not move adjacent rows", async ({ page, productionUi }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-trajectory-50");
  const viewport = page.locator(".trajectory-viewport");
  const visible = await viewport.evaluate((viewportElement) => {
    const viewportBox = viewportElement.getBoundingClientRect();
    const rows = [...viewportElement.querySelectorAll<HTMLElement>('[role="option"]')];
    return rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > viewportBox.top && box.top < viewportBox.bottom;
    }).length;
  });
  expect(visible).toBeGreaterThanOrEqual(9);
  expect(visible).toBeLessThanOrEqual(13);
  const second = page.getByRole("option").nth(1);
  const third = page.getByRole("option").nth(2);
  const before = await third.boundingBox();
  await second.click();
  const after = await third.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
});

test("the desktop inspector frame remains fixed across selections and tabs", async ({ page, productionUi }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-trajectory-50");

  const inspector = page.locator(".trajectory-inspector");
  const before = await inspector.boundingBox();
  if (before === null) throw new Error("desktop inspector bounds unavailable before selection");

  await page.getByRole("option").nth(1).click();
  await expect(inspector.locator("[data-inspector-event]"))
    .toHaveAttribute("data-inspector-event", /event-1$/);
  const afterSelection = await inspector.boundingBox();
  if (afterSelection === null) throw new Error("desktop inspector bounds unavailable after selection");

  await page.getByRole("tab", { name: "Relationships" }).click();
  const afterTab = await inspector.boundingBox();
  if (afterTab === null) throw new Error("desktop inspector bounds unavailable after tab change");

  for (const coordinate of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(afterSelection[coordinate] - before[coordinate])).toBeLessThanOrEqual(1);
    expect(Math.abs(afterTab[coordinate] - before[coordinate])).toBeLessThanOrEqual(1);
  }
});
