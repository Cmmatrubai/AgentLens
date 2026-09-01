import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";

test("one deliberate assessment update appends one human evidence event", async ({ page, productionUi, releaseFixture }) => {
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-completed-recovery");
  const before = await releaseFixture.humanAssessmentEventCount("fixture-completed-recovery");
  await page.getByRole("button", { name: "Edit human assessment" }).click();
  await page.getByLabel("Partial").check();
  await page.getByLabel("Uncertain").check();
  await page.getByLabel("Reviewer note (optional)").fill("Synthetic release assessment note");
  await page.getByRole("button", { name: "Save assessment" }).click();
  await expect(page.getByRole("button", { name: "Edit human assessment" })).toBeFocused();
  await expect.poll(() => releaseFixture.humanAssessmentEventCount("fixture-completed-recovery"))
    .toBe(before + 1);
});
