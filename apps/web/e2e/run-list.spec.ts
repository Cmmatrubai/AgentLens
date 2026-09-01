import { expect, expectNoHorizontalOverflow, openBootstrapped, test } from "./fixtures.js";

test("one-use bootstrap opens the evidence ledger, filters it, and expires on reload", async ({ page, productionUi }) => {
  const failures: string[] = [];
  page.on("request", (request) => {
    const requested = new URL(request.url());
    if (["http:", "https:"].includes(requested.protocol) && requested.origin !== productionUi.origin) {
      failures.push(`external request: ${requested.origin}`);
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(productionUi.origin) && response.status() >= 400) {
      failures.push(`failed response: ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) failures.push(message.text());
  });
  await openBootstrapped(page, productionUi);
  await page.getByLabel("Run status").selectOption("completed");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=completed/);
  await expect(page.getByText("Latest likely test: passed · 1 previous failure")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Authentication expired" })).toBeVisible();
  expect(failures).toEqual([]);
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
