import { createRequire } from "node:module";

import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("run ledger and detail have no serious axe violations and preserve semantic focus", async ({ page, productionUi }) => {
  await page.addInitScript({ path: axePath });
  await openBootstrapped(page, productionUi);
  const ledger = await page.evaluate(async () => (window as typeof window & { axe: { run(): Promise<{ violations: Array<{ impact: string | null }> }> } }).axe.run());
  expect(ledger.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  await navigateToRun(page, "fixture-trajectory-50");
  const first = page.getByRole("option").first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[role="option"][tabindex="0"]')).toBeFocused();
  await expect(page.getByRole("region", { name: "Node clarification" })).toHaveCSS("opacity", "1");
  const detail = await page.evaluate(async () => (window as typeof window & { axe: { run(): Promise<{ violations: Array<{ impact: string | null }> }> } }).axe.run());
  expect(detail.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
});
