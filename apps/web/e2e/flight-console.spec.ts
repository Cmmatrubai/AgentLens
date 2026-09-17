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
  await expect(page.getByText("Test-bearing commands").first()).toBeVisible();
  await expect(page.getByText("Human review").first()).toBeVisible();
  await expect(page.getByText("Git").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("trajectory nodes have bounded widths, breathing room, and stable adjacent coordinates", async ({ page, productionUi }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-trajectory-50");
  await page.getByRole("checkbox", { name: "Group routine events" }).uncheck();
  const viewport = page.locator(".trajectory-viewport");
  await viewport.scrollIntoViewIfNeeded();
  const visible = await viewport.evaluate((viewportElement) => {
    const viewportBox = viewportElement.getBoundingClientRect();
    const rows = [...viewportElement.querySelectorAll<HTMLElement>('[role="option"]')];
    return rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.top >= viewportBox.top && box.bottom <= viewportBox.bottom;
    }).map((row) => {
      const box = row.getBoundingClientRect();
      return { y: box.y, width: box.width, height: box.height };
    });
  });
  expect(visible.length).toBeGreaterThanOrEqual(2);
  expect(await page.getByRole("option").count()).toBeLessThan(30);
  for (const [index, node] of visible.entries()) {
    expect(node.width).toBeLessThanOrEqual(300);
    expect(node.width).toBeGreaterThan(180);
    if (index > 0) expect(node.y - (visible[index - 1]!.y + visible[index - 1]!.height))
      .toBeGreaterThanOrEqual(24);
  }
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
  await page.getByRole("checkbox", { name: "Group routine events" }).uncheck();

  const inspector = page.locator(".trajectory-inspector");
  await inspector.scrollIntoViewIfNeeded();
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

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1100, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const metrics = await inspector.evaluate((element) => {
      const required = <T extends Element>(selector: string): T => {
        const match = element.querySelector<T>(selector);
        if (match === null) throw new Error(`missing inspector element: ${selector}`);
        return match;
      };
      const body = required<HTMLElement>(".event-inspector__body");
      const trajectory = element.closest(".run-workspace")?.querySelector<HTMLElement>(".trajectory-viewport");
      if (trajectory === null || trajectory === undefined) throw new Error("missing trajectory viewport");
      return {
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        headingHeight: required<HTMLElement>(".event-inspector h2").getBoundingClientRect().height,
        summaryHeight: required<HTMLElement>(".event-inspector__summary").getBoundingClientRect().height,
        tabsHeight: required<HTMLElement>(".inspector-tabs").getBoundingClientRect().height,
        inspectorHeight: element.getBoundingClientRect().height,
        trajectoryHeight: trajectory.getBoundingClientRect().height
      };
    });
    const label = `${viewport.width}×${viewport.height}`;
    expect.soft(metrics.headingHeight, `${label} inspector heading height`).toBeGreaterThanOrEqual(18);
    expect.soft(metrics.summaryHeight, `${label} inspector summary height`).toBeGreaterThanOrEqual(16);
    expect.soft(metrics.tabsHeight, `${label} inspector tabs height`).toBeGreaterThanOrEqual(36);
    expect.soft(metrics.bodyClientHeight, `${label} inspector body visible height`)
      .toBeGreaterThanOrEqual(Math.min(metrics.bodyScrollHeight, 120));
    expect.soft(Math.abs(metrics.inspectorHeight - metrics.trajectoryHeight), `${label} matched frame height`)
      .toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 800, height: 900 });
  const inline = page.getByTestId("inline-event-inspector");
  await expect(inline).toBeVisible();
  const selectedEventId = await page.getByRole("option", { selected: true }).getAttribute("data-event-id");
  if (selectedEventId === null) throw new Error("selected inline event identity unavailable");
  await expect(inline.locator(".event-inspector__body"))
    .toHaveAttribute("data-inspector-event", selectedEventId);
  const inlineMetrics = await inline.evaluate((element) => {
    const body = element.querySelector<HTMLElement>(".event-inspector__body");
    const tabs = element.querySelector<HTMLElement>(".inspector-tabs");
    if (body === null || tabs === null) throw new Error("inline inspector body or tabs missing");
    return {
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      tabsHeight: tabs.getBoundingClientRect().height,
      anchorEventId: element.closest("[data-inline-evidence-anchor-for]")
        ?.getAttribute("data-inline-evidence-anchor-for") ?? null
    };
  });
  expect(inlineMetrics.tabsHeight).toBeGreaterThanOrEqual(36);
  expect(inlineMetrics.bodyClientHeight)
    .toBeGreaterThanOrEqual(Math.min(inlineMetrics.bodyScrollHeight, 120));
  expect(inlineMetrics.anchorEventId).toBe(selectedEventId);
});
