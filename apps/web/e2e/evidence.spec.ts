import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";

test("failure, recovery, explicit content, provider payload, and Final Git evidence stay distinct", async ({ page, productionUi }) => {
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-completed-recovery");
  await page.getByRole("button", { name: "Jump to first failure" }).click();
  await expect(page.getByText("Command failed", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Load command evidence" }).click();
  await expect(page.getByRole("heading", { name: "Redacted command", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Redacted provider payload" }).click();
  await expect(page.getByRole("tabpanel", { name: "Redacted provider payload" })).toBeVisible();
  await page.getByRole("button", { name: "Jump to recorder recovery" }).click();
  await expect(page.getByText("Recorder recovery", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Open tracked final diff" }).click();
  await expect(page.getByRole("heading", { name: "Final Git evidence · tracked final diff" })).toBeVisible();
  await expect(page.getByText("Final-state Git evidence does not establish authorship.")).toBeVisible();
});
