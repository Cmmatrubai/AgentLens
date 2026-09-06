import type { Locator, Page } from "@playwright/test";

import {
  expect, expectNoHorizontalOverflow, navigateToRun, openBootstrapped,
  syntheticMixedGraphRunId as runId, test
} from "./fixtures.js";

const failureId = `${runId}-command-failed`;
const eventNode = (page: Page, id: string) => page.locator(`[role="option"][data-event-id="${id}"]`);

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Required graph geometry is unavailable.");
  return box;
}

async function visibleNodes(page: Page) {
  return page.locator(".trajectory-viewport").evaluate((viewport) => {
    const frame = viewport.getBoundingClientRect();
    return [...viewport.querySelectorAll<HTMLElement>('[role="option"]')].flatMap((node) => {
      const box = node.getBoundingClientRect();
      return box.top >= frame.top && box.bottom <= frame.bottom ? [{
        key: node.dataset.graphNode!, eventId: node.dataset.eventId!,
        x: box.x, y: box.y, width: box.width, height: box.height
      }] : [];
    });
  });
}

async function openMixedGraph(page: Page, productionUi: Parameters<typeof openBootstrapped>[1]) {
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, runId);
  await expect(page.getByRole("checkbox", { name: "Group routine events" })).toBeChecked();
  await expect(eventNode(page, failureId)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Node clarification" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load command evidence" })).toBeVisible();
}

for (const width of [1440, 1024, 768, 390]) {
  test(`synthetic graph preserves paths, clarification, and evidence layout at ${width}px`, async ({ page, productionUi }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await openMixedGraph(page, productionUi);
    const viewport = page.locator(".trajectory-viewport");
    const clarification = page.getByRole("region", { name: "Node clarification" });
    await expect(viewport).toHaveAttribute("data-clarification-layout", width === 1440 ? "adjacent" : "below");
    const card = await bounds(eventNode(page, failureId));
    const detail = await bounds(clarification);
    expect(card.width).toBeGreaterThan(150);
    expect(card.width).toBeLessThanOrEqual(300);
    const transitions = await eventNode(page, failureId).locator(".execution-node__card").evaluate((element) => {
      const style = getComputedStyle(element);
      return { durations: style.transitionDuration.split(",").map((value) => Number.parseFloat(value)),
        properties: style.transitionProperty.split(",").map((value) => value.trim()) };
    });
    expect(transitions.durations.every((duration) => duration <= 0.2)).toBe(true);
    expect(transitions.properties.some((property) => ["all", "height", "width", "transform", "top", "left"].includes(property))).toBe(false);
    const spine = page.locator('[data-graph-backbone="chronological"]');
    await expect(spine).toBeVisible();
    expect(await spine.evaluate((path) => (path as SVGPathElement).getTotalLength())).toBeGreaterThan(300);
    const branches = page.locator(`[data-graph-edge="derived_from"][data-target="${failureId}"]`);
    await expect(branches).toHaveCount(2);
    for (const branch of await branches.all()) {
      await expect(branch).toBeVisible();
      expect(await branch.evaluate((path) => (path as SVGPathElement).getTotalLength())).toBeGreaterThan(20);
    }
    expect(await clarification.evaluate((element) => element.closest('[role="listbox"]'))).toBeNull();
    expect(await page.getByRole("option").count()).toBeLessThan(30);

    if (width === 1440) {
      expect(detail.x).toBeGreaterThanOrEqual(card.x + card.width + 24);
      expect(Math.abs(detail.y - card.y)).toBeLessThanOrEqual(24);
      const inspector = page.locator(".trajectory-inspector");
      const inspectorBefore = await bounds(inspector);
      expect(detail.x + detail.width).toBeLessThanOrEqual(inspectorBefore.x);
      for (const branch of await branches.all()) {
        const sourceId = await branch.getAttribute("data-source");
        if (!sourceId) throw new Error("A branch must retain its exact source identity.");
        expect((await bounds(eventNode(page, sourceId))).x).toBeGreaterThan(card.x);
      }
      const before = await visibleNodes(page);
      expect(before.length).toBeGreaterThanOrEqual(2);
      for (const [index, node] of before.entries()) {
        expect(node.width).toBeLessThanOrEqual(300);
        if (index > 0) expect(node.y - (before[index - 1]!.y + before[index - 1]!.height))
          .toBeGreaterThanOrEqual(24);
      }
      const neighbor = before.find(({ eventId }) => eventId !== failureId);
      if (!neighbor) throw new Error("A visible neighboring node is required for stability acceptance.");
      await eventNode(page, neighbor.eventId).click();
      await expect(eventNode(page, neighbor.eventId)).toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => {
        const after = await visibleNodes(page);
        return before.every((node) => {
          const current = after.find(({ key }) => key === node.key);
          return current !== undefined && (["x", "y", "width", "height"] as const)
            .every((coordinate) => Math.abs(current[coordinate] - node[coordinate]) <= 1);
        });
      }).toBe(true);
      // Exact branches remain present when their endpoints are no longer selected.
      await expect(branches).toHaveCount(2);
      for (const branch of await branches.all()) await expect(branch).toBeVisible();
      const inspectorAfter = await bounds(inspector);
      for (const coordinate of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(inspectorAfter[coordinate] - inspectorBefore[coordinate])).toBeLessThanOrEqual(1);
      }
    } else {
      expect(detail.y).toBeGreaterThanOrEqual(card.y + card.height);
      const frame = await bounds(viewport);
      expect(detail.x).toBeGreaterThanOrEqual(frame.x);
      expect(detail.x + detail.width).toBeLessThanOrEqual(frame.x + frame.width);
      if (width <= 800) {
        const inline = page.getByTestId("inline-event-inspector");
        await expect(inline).toBeVisible();
        expect((await bounds(inline)).y).toBeGreaterThanOrEqual(detail.y + detail.height);
        expect(await inline.evaluate((element) => element.closest('[role="listbox"]'))).toBeNull();
      } else {
        const inspector = await bounds(page.locator(".trajectory-inspector"));
        expect(frame.x + frame.width).toBeLessThanOrEqual(inspector.x);
      }
    }
    await expectNoHorizontalOverflow(page);
    // Source prepared only: these artifacts require the separately cleared browser gate.
    await page.screenshot({ path: testInfo.outputPath(`synthetic-graph-${width}.png`), fullPage: true });
  });
}

test("routine and successful lifecycle members expand and keyboard branches retain exact identities", async ({ page, productionUi }) => {
  await openMixedGraph(page, productionUi);
  await eventNode(page, failureId).focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(eventNode(page, `${runId}-routine-0`)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Enter");
  await expect(eventNode(page, `${runId}-routine-1`)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-cluster-member]")).toHaveCount(3);
  await page.getByRole("button", { name: `Select immutable event ${runId}-routine-2 · #2`, exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("event")).toBe(`${runId}-routine-2`);
  await page.getByRole("button", { name: "Collapse routine events", exact: true }).click();
  await expect(page.locator("[data-cluster-member]")).toHaveCount(0);

  const lifecycle = eventNode(page, `${runId}-successful-command-completed`);
  await lifecycle.click();
  await lifecycle.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Enter");
  await expect(eventNode(page, `${runId}-successful-command-started`)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Expand lifecycle events", exact: true }).click();
  await expect(page.locator("[data-lifecycle-member]")).toHaveCount(2);
  await page.getByRole("button", { name: "Collapse lifecycle events", exact: true }).click();
  await expect(page.locator("[data-lifecycle-member]")).toHaveCount(0);

  await page.getByRole("button", { name: "Jump to first failure" }).click();
  const incoming = page.locator(`[data-graph-edge="derived_from"][data-target="${failureId}"]`).first();
  const derivedId = await incoming.getAttribute("data-source");
  if (!derivedId) throw new Error("An exact incoming derived event is required.");
  await eventNode(page, failureId).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(eventNode(page, derivedId)).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get("event")).toBe(derivedId);
  await page.keyboard.press("ArrowRight");
  await expect(eventNode(page, failureId)).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get("event")).toBe(failureId);
});

test("clarification adds no detail or raw requests and raw evidence stays explicitly loaded", async ({ page, productionUi, requestLifecycle }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === productionUi.origin && url.pathname.startsWith("/api/v1/")) requests.push(url.pathname);
  });
  await openMixedGraph(page, productionUi);
  await expect.poll(() => requestLifecycle.describeActive(productionUi.origin)).toEqual([]);
  const detailPath = `/api/v1/runs/${runId}/events/${failureId}`;
  expect(requests.filter((path) => path === detailPath)).toHaveLength(1);
  expect(requests.filter((path) => /\/events\/[^/]+$/.test(path))).toEqual([detailPath]);
  const rawPaths = () => requests.filter((path) => /\/(content|native|assessment-note|note|artifacts?)(\/|$)|\/git\//.test(path));
  expect(rawPaths()).toEqual([]);
  await page.getByRole("button", { name: "Focus evidence inspector →" }).click();
  await expect(page.getByRole("tab", { name: "Evidence", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 768, height: 1000 });
  await expect(page.getByTestId("inline-event-inspector").getByRole("tab", { name: "Evidence", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".trajectory-inspector").getByRole("tab", { name: "Evidence", exact: true })).toBeFocused();
  await expect.poll(() => requestLifecycle.describeActive(productionUi.origin)).toEqual([]);
  expect(requests.filter((path) => path === detailPath)).toHaveLength(1);
  expect(rawPaths()).toEqual([]);

  let checkpoint = requestLifecycle.checkpoint();
  await page.getByRole("button", { name: "Load command evidence" }).click();
  await requestLifecycle.waitForTerminal(checkpoint, {
    method: "GET", origin: productionUi.origin, pathname: `${detailPath}/content`
  });
  await expect(page.getByRole("region", { name: "Redacted command output", exact: true }))
    .toContainText("FAIL synthetic graph fixture");
  expect(rawPaths()).toEqual([`${detailPath}/content`]);
  checkpoint = requestLifecycle.checkpoint();
  await page.getByRole("tab", { name: "Redacted provider payload", exact: true }).click();
  await requestLifecycle.waitForTerminal(checkpoint, {
    method: "GET", origin: productionUi.origin, pathname: `${detailPath}/native`
  });
  await expect(page.locator(".native-evidence")).toContainText("FAIL synthetic graph fixture");
  expect(rawPaths()).toEqual([`${detailPath}/content`, `${detailPath}/native`]);
});

test("reduced motion removes graph transitions and moving or looping connectors", async ({ page, productionUi }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMixedGraph(page, productionUi);
  const clarification = page.getByRole("region", { name: "Node clarification" });
  await expect(clarification).toHaveAttribute("data-motion", "reduced");
  await expect(clarification).toHaveCSS("opacity", "1");
  const styles = await page.locator(".execution-node__card, .execution-graph-edges path, .node-clarification")
    .evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return { durations: style.transitionDuration.split(",").map((value) => Number.parseFloat(value)),
        animationName: style.animationName, activeAnimations: element.getAnimations().filter((animation) =>
          animation.playState === "running" || animation.pending).length };
    }));
  expect(styles.length).toBeGreaterThan(3);
  for (const style of styles) {
    expect(style.durations.every((duration) => duration === 0)).toBe(true);
    expect(style.animationName).toBe("none");
    expect(style.activeAnimations).toBe(0);
  }
});
