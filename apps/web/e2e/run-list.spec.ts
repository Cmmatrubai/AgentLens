import { expect, expectNoHorizontalOverflow, openBootstrapped, test } from "./fixtures.js";

test("one-use bootstrap opens the evidence ledger, filters it, and expires on reload", async ({ page, productionUi }) => {
  await openBootstrapped(page, productionUi);
  await page.getByLabel("Run status").selectOption("completed");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=completed/);
  await expect(page.getByText("Latest likely test: passed · 1 previous failure")).toBeVisible();
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
