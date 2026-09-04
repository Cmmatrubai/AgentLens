import type { Page, Request } from "@playwright/test";
import {
  trajectoryPageV1Schema,
  type TrajectoryEventV1,
  type TrajectoryPageV1
} from "../../../packages/api-contract/src/index.js";

import { expect, expectNoHorizontalOverflow, navigateToRun, openBootstrapped, test } from "./fixtures.js";

interface VisibleAnchor {
  readonly eventId: string;
  readonly offset: number;
}

interface CapturedTrajectoryPage {
  readonly page: TrajectoryPageV1;
  readonly request: Request;
}

function expectedEventId(sequence: number): string {
  if (sequence < 997) return `fixture-trajectory-1000-event-${sequence}`;
  if (sequence === 997) return "fixture-trajectory-1000-process-exit";
  if (sequence === 998) return "fixture-trajectory-1000-provider-terminal";
  return "fixture-trajectory-1000-reconciled";
}

async function captureTrajectoryPages(page: Page): Promise<CapturedTrajectoryPage[]> {
  const captured: CapturedTrajectoryPage[] = [];
  await page.route("**/api/v1/runs/fixture-trajectory-1000/events**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/runs/fixture-trajectory-1000/events") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.body();
    if (response.status() !== 200) {
      throw new Error(`Trajectory capture expected status 200, received ${response.status()}.`);
    }
    captured.push({
      page: trajectoryPageV1Schema.parse(JSON.parse(body.toString("utf8"))),
      request: route.request()
    });
    await route.fulfill({ response, body });
  });
  return captured;
}

async function capturedResponsePage(
  captured: readonly CapturedTrajectoryPage[],
  request: Request
): Promise<TrajectoryPageV1> {
  const match = captured.find((entry) => entry.request === request);
  if (match === undefined) throw new Error("The trajectory response body was not registered synchronously.");
  return match.page;
}

async function stubTerminalTrajectoryTotal(
  page: Page,
  totalEventCount: 101 | 201,
  holdFinalPage = false
): Promise<Readonly<{
  releaseFinalPage: () => void;
  waitForFinalPageRequest: () => Promise<void>;
  cursorRequestCount: () => number;
}>> {
  let cursorRequestCount = 0;
  let resolveFinalPageRequest!: () => void;
  const finalPageRequested = new Promise<void>((resolve) => { resolveFinalPageRequest = resolve; });
  let releaseFinalPage!: () => void;
  const finalPageRelease = new Promise<void>((resolve) => { releaseFinalPage = resolve; });
  const runPath = "/api/v1/runs/fixture-trajectory-1000";
  await page.route("**/api/v1/runs/fixture-trajectory-1000", async (route) => {
    if (new URL(route.request().url()).pathname !== runPath) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = JSON.parse((await response.body()).toString("utf8")) as Record<string, unknown>;
    body.eventCount = totalEventCount;
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
  await page.route("**/api/v1/runs/fixture-trajectory-1000/events**", async (route) => {
    if (new URL(route.request().url()).pathname !== runPath + "/events") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const current = trajectoryPageV1Schema.parse(JSON.parse((await response.body()).toString("utf8")));
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === null) {
      const initialPage = trajectoryPageV1Schema.parse({
        ...current,
        items: current.items.slice(0, 100),
        window: {
          state: "nonempty",
          minSequence: 0,
          maxSequence: 99,
          latestCommittedSequence: totalEventCount - 1,
          hasEarlier: false,
          hasLater: true,
          earlierCursor: null,
          laterCursor: current.window.state === "nonempty" ? current.window.laterCursor : null
        }
      });
      await route.fulfill({ response, body: JSON.stringify(initialPage) });
      return;
    }
    cursorRequestCount += 1;
    resolveFinalPageRequest();
    if (holdFinalPage) await finalPageRelease;
    const item = current.items[0];
    if (item === undefined) throw new Error("The synthetic final trajectory page needs a source event.");
    const reconciled: TrajectoryEventV1 = {
      ...item,
      eventId: "fixture-trajectory-1000-reconciled",
      sequence: 100,
      kind: "run.reconciled",
      provenance: "recorder",
      presentationClass: "recorder",
      safeSummary: "Synthetic terminal run reconciliation"
    };
    const finalPage = trajectoryPageV1Schema.parse({
      ...current,
      mode: "cursor",
      items: [reconciled],
      window: {
        state: "nonempty",
        minSequence: 100,
        maxSequence: 100,
        latestCommittedSequence: 100,
        hasEarlier: true,
        hasLater: false,
        earlierCursor: current.window.state === "nonempty" ? current.window.earlierCursor : null,
        laterCursor: null
      }
    });
    await route.fulfill({ response, body: JSON.stringify(finalPage) });
  });
  return {
    releaseFinalPage,
    waitForFinalPageRequest: () => finalPageRequested,
    cursorRequestCount: () => cursorRequestCount
  };
}

async function visibleAnchor(page: Page, eventId: string): Promise<VisibleAnchor | null> {
  return page.locator(".trajectory-viewport").evaluate((viewport, selectedEventId) => {
    const viewportBounds = viewport.getBoundingClientRect();
    const anchor = viewport.querySelector<HTMLElement>(`[role="option"][data-event-id="${selectedEventId}"]`);
    if (anchor === null) return null;
    const bounds = anchor.getBoundingClientRect();
    if (bounds.bottom <= viewportBounds.top || bounds.top >= viewportBounds.bottom) return null;
    return {
      eventId: anchor.dataset.eventId!,
      offset: Math.round((anchor.getBoundingClientRect().top - viewportBounds.top) * 100) / 100
    };
  }, eventId);
}

test("a 1000-event run proves exact pages, stable anchors, bounded virtualization, and keyboard identity", async ({
  page,
  productionUi,
  requestLifecycle
}) => {
  const captured = await captureTrajectoryPages(page);
  await openBootstrapped(page, productionUi);
  const initialCheckpoint = requestLifecycle.checkpoint();
  await navigateToRun(page, "fixture-trajectory-1000");
  const initialRequest = await requestLifecycle.waitForTerminal(initialCheckpoint, {
    method: "GET",
    origin: productionUi.origin,
    pathname: "/api/v1/runs/fixture-trajectory-1000/events",
    search: "?limit=100"
  });
  const pages: TrajectoryPageV1[] = [await capturedResponsePage(captured, initialRequest.request)];
  const requestedCursors: string[] = [];
  await expect(page.getByRole("heading", { name: "Execution trajectory" })).toBeVisible();
  const loadLater = page.getByRole("button", { name: "Load later" });
  const viewport = page.locator(".trajectory-viewport");
  const rows = page.getByRole("option");
  await expect(page.getByText("100 of 1,000 immutable events loaded")).toBeVisible();
  expect(await rows.count()).toBeLessThan(30);

  for (let pageIndex = 1; pageIndex < 10; pageIndex += 1) {
    await viewport.evaluate((element) => {
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight * 1.5);
      element.dispatchEvent(new Event("scroll"));
    });
    const rovingAnchor = page.locator('[role="option"][tabindex="0"]');
    await expect.poll(async () => Number(await rovingAnchor.getAttribute("data-sequence")))
      .toBeGreaterThanOrEqual(pageIndex * 100 - 20);
    await rovingAnchor.scrollIntoViewIfNeeded();
    await expect(rovingAnchor).toBeInViewport();
    const anchorEventId = await rovingAnchor.getAttribute("data-event-id");
    if (anchorEventId === null) throw new Error("A roving trajectory anchor requires an event identity.");
    const before = await visibleAnchor(page, anchorEventId);
    if (before === null) throw new Error("The roving trajectory anchor must be visible before paging.");
    const previous = pages.at(-1)!;
    if (previous.window.state !== "nonempty" || previous.window.laterCursor === null) {
      throw new Error("Every non-terminal fixture page must expose a later cursor.");
    }
    const requestCursor = previous.window.laterCursor;
    const checkpoint = requestLifecycle.checkpoint();
    await loadLater.click();
    const completedRequest = await requestLifecycle.waitForTerminal(checkpoint, {
      method: "GET",
      origin: productionUi.origin,
      pathname: "/api/v1/runs/fixture-trajectory-1000/events",
      predicate: (record) => new URL(record.url).searchParams.get("cursor") === requestCursor
    });
    requestedCursors.push(new URL(completedRequest.url).searchParams.get("cursor")!);
    pages.push(await capturedResponsePage(captured, completedRequest.request));
    await expect(page.getByText(`${((pageIndex + 1) * 100).toLocaleString()} of 1,000 immutable events loaded`))
     .toBeVisible();
    await expect.poll(async () => {
      const after = await visibleAnchor(page, before.eventId);
      return after !== null && after.eventId === before.eventId && Math.abs(after.offset - before.offset) <= 1;
    }, `page ${pageIndex + 1} must preserve visible anchor ${before.eventId} and its offset`).toBe(true);
    expect(await rows.count()).toBeLessThan(30);
  }

  expect(pages).toHaveLength(10);
  expect(captured).toHaveLength(10);
  const expectedIds = Array.from({ length: 1_000 }, (_, sequence) => expectedEventId(sequence));
  const expectedSequences = Array.from({ length: 1_000 }, (_, sequence) => sequence);
  const returnedIds = pages.flatMap(({ items }) => items.map(({ eventId }) => eventId));
  const returnedSequences = pages.flatMap(({ items }) => items.map(({ sequence }) => sequence));
  expect(returnedIds).toEqual(expectedIds);
  expect(returnedSequences).toEqual(expectedSequences);
  expect(new Set(returnedIds).size).toBe(1_000);
  expect(new Set(returnedSequences).size).toBe(1_000);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const trajectoryPage = pages[pageIndex]!;
    expect(trajectoryPage.mode).toBe(pageIndex === 0 ? "head" : "cursor");
    expect(trajectoryPage.items.map(({ eventId }) => eventId))
      .toEqual(expectedIds.slice(pageIndex * 100, (pageIndex + 1) * 100));
    expect(trajectoryPage.items.map(({ sequence }) => sequence))
      .toEqual(expectedSequences.slice(pageIndex * 100, (pageIndex + 1) * 100));
    expect(trajectoryPage.window.state).toBe("nonempty");
    if (trajectoryPage.window.state !== "nonempty") throw new Error("Fixture page unexpectedly became empty.");
    expect(trajectoryPage.window).toMatchObject({
      minSequence: pageIndex * 100,
      maxSequence: pageIndex * 100 + 99,
      latestCommittedSequence: 999,
      hasEarlier: pageIndex > 0,
      hasLater: pageIndex < 9
    });
    expect(trajectoryPage.window.earlierCursor === null).toBe(pageIndex === 0);
    expect(trajectoryPage.window.laterCursor === null).toBe(pageIndex === 9);
    if (pageIndex > 0) {
      const previous = pages[pageIndex - 1]!;
      if (previous.window.state !== "nonempty") throw new Error("Previous fixture page unexpectedly became empty.");
      expect(requestedCursors[pageIndex - 1]).toBe(previous.window.laterCursor);
    }
  }
  const laterCursors = pages.slice(0, -1).map((trajectoryPage) => {
    if (trajectoryPage.window.state !== "nonempty" || trajectoryPage.window.laterCursor === null) {
      throw new Error("A non-terminal page must expose its authenticated later boundary.");
    }
    return trajectoryPage.window.laterCursor;
  });
  expect(new Set(laterCursors).size).toBe(9);

  const currentlyMounted = rows.first();
  await currentlyMounted.focus();
  await page.keyboard.press("Home");
  const first = page.locator(`[role="option"][data-event-id="${expectedIds[0]}"]`);
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const second = page.locator(`[role="option"][data-event-id="${expectedIds[1]}"]`);
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("event")).toBe(expectedIds[1]);
  await expect(page.locator(".event-inspector").getByText(expectedIds[1]!, { exact: true })).toBeVisible();

  await page.keyboard.press("End");
  const last = page.locator(`[role="option"][data-event-id="${expectedIds[999]}"]`);
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("event")).toBe(expectedIds[999]);
  await expect(page.locator(".event-inspector").getByText(expectedIds[999]!, { exact: true })).toBeVisible();
  expect(await rows.count()).toBeLessThan(30);
  await expectNoHorizontalOverflow(page);
});

test("a sanitized 101-event terminal run automatically loads its final reconciliation page", async ({
  page,
  productionUi
}) => {
  const trajectory = await stubTerminalTrajectoryTotal(page, 101, true);
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-trajectory-1000");

  await expect(page.getByText("100 of 101 immutable events loaded")).toBeVisible();
  await trajectory.waitForFinalPageRequest();
  expect(trajectory.cursorRequestCount()).toBe(1);
  await expect(page.getByRole("button", { name: "Load later" })).toBeDisabled();
  trajectory.releaseFinalPage();

  await expect(page.getByText("101 of 101 immutable events loaded")).toBeVisible();
  await page.getByRole("button", { name: "Jump to latest event" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("event"))
    .toBe("fixture-trajectory-1000-reconciled");
  await expect(page.locator(".event-inspector").getByText("run.reconciled", { exact: true })).toBeVisible();
  expect(trajectory.cursorRequestCount()).toBe(1);
});

test("a sanitized 201-event terminal run does not request a second trajectory page automatically", async ({
  page,
  productionUi
}) => {
  const trajectory = await stubTerminalTrajectoryTotal(page, 201);
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-trajectory-1000");

  await expect(page.getByText("100 of 201 immutable events loaded")).toBeVisible();
  await page.waitForTimeout(250);

  expect(trajectory.cursorRequestCount()).toBe(0);
  await expect(page.getByRole("button", { name: "Load later" })).toBeEnabled();
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
