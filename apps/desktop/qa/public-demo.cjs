// Acceptance against a generic static server. No Electron bridge or private data.
const { chromium, expect } = require("@playwright/test");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");
const url = process.env.AGENTLENS_DEMO_URL || "http://127.0.0.1:5188/showcase/";
const output = path.resolve(__dirname, "../.local/public-demo-qa");
(async () => {
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1120 },
    });
    page = await context.newPage();
    const requests = [],
      errors = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("pageerror", (e) => errors.push(e.message));
    await mkdir(output, { recursive: true });
    await page.goto(url);
    await expect(
      page.getByRole("heading", {
        name: "Both passed. Their approaches differed.",
      }),
    ).toBeVisible();
    await expect(page.locator(".finding-card")).toHaveCount(3);
    expect(await page.evaluate(() => typeof window.agentlens)).toBe(
      "undefined",
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            ...document.querySelectorAll(
              ".demo-main > div, .finding-card, [role=dialog]",
            ),
          ].every((e) => getComputedStyle(e).opacity === "1"),
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(output, "case-wide.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Compare evidence: Implementation" })
      .click();
    await expect(page.locator(".finding-evidence-side")).toHaveCount(2);
    await expect(
      page.getByText("stream.pause()", { exact: false }).first(),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            ...document.querySelectorAll(
              ".demo-main > div, .finding-card, [role=dialog]",
            ),
          ].every((e) => getComputedStyle(e).opacity === "1"),
        ),
      )
      .toBe(true);
    await page.screenshot({ path: path.join(output, "paired-evidence.png") });
    await page
      .getByRole("button", { name: "Back to findings", exact: true })
      .click();
    await page.getByRole("link", { name: "Evidence", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Follow the evidence." }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Independent comparison results" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: /GPT-5.6 Sol: Discard oversized stdout safely/,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Independent check evidence" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close evidence", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Inspect attempt", exact: true })
      .first()
      .click();
    await expect(
      page.getByText(/This public selection includes 3 events/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close evidence", exact: true })
      .click();
    await page
      .getByRole("link", { name: "About AgentLens", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "A model comparison you can inspect.",
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "A model comparison you can inspect.",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Quick navigation", exact: true })
      .click();
    await page.getByPlaceholder("Find a page…").fill("Case study");
    await page.keyboard.press("Enter");
    await expect(page.locator(".finding-card")).toHaveCount(3);
    await page.goto(url + "#/setup");
    await expect(
      page.getByRole("heading", {
        name: "Both passed. Their approaches differed.",
      }),
    ).toBeVisible();
    expect(page.url().endsWith("#/case")).toBe(true);
    for (const width of [820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".demo-main").scrollWidth <= document.querySelector(".demo-main").clientWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll(
                ".demo-main > div, .finding-card, [role=dialog]",
              ),
            ].every((e) => getComputedStyle(e).opacity === "1"),
          ),
        )
        .toBe(true);
      await page.screenshot({ path: path.join(output, `case-${width}.png`) });
      await page
        .getByRole("button", { name: "Compare evidence: Implementation" })
        .click();
      await expect(
        page.getByRole("button", { name: "Back to findings", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".demo-main").scrollWidth <= document.querySelector(".demo-main").clientWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll(
                ".demo-main > div, .finding-card, [role=dialog]",
              ),
            ].every((e) => getComputedStyle(e).opacity === "1"),
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: path.join(output, `evidence-${width}.png`),
      });
      await page
        .getByRole("button", { name: "Back to findings", exact: true })
        .click();
      await page.getByRole("link", { name: "Evidence", exact: true }).click();
      await expect(page.getByRole("table")).toBeVisible();
      await page.getByRole("table").scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".demo-main").scrollWidth <= document.querySelector(".demo-main").clientWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll(
                ".demo-main > div, .finding-card, [role=dialog]",
              ),
            ].every((e) => getComputedStyle(e).opacity === "1"),
          ),
        )
        .toBe(true);
      await page.screenshot({ path: path.join(output, `checks-${width}.png`) });
      await page.getByRole("link", { name: "Case study", exact: true }).click();
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator(".finding-card")).toHaveCount(3);
    const origin = new URL(url).origin;
    expect(
      requests.filter(
        (u) =>
          new URL(u).origin !== origin || new URL(u).pathname.includes("/api/"),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    // Reject mismatched releases before showing any findings.
    await page.route("**/demo/comparison.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Comparison evidence is unavailable.",
      }),
    ).toBeVisible();
    await expect(page.locator(".finding-card")).toHaveCount(0);
    console.log(
      JSON.stringify({
        staticURL: url,
        widths: [1440, 820, 390],
        pairedEvidence: true,
        checks: true,
        attemptSelectionDisclosure: true,
        deepLinkRefresh: true,
        legacyRouteRedirect: true,
        commandPalette: true,
        reducedMotion: true,
        tamperedSnapshotRejected: true,
        apiRequests: 0,
        externalRequests: 0,
        pageErrors: errors,
        screenshots: output,
      }),
    );
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, "failure.png") });
      console.log(
        JSON.stringify(
          await page.evaluate(() => ({
            hash: location.hash,
            dialogs: document.querySelectorAll("[role=dialog]").length,
            hidden: [...document.querySelectorAll("[aria-hidden=true]")].map(
              (e) => ({ tag: e.tagName, cls: e.className }),
            ),
            links: [...document.querySelectorAll("a")].map(
              (a) => a.textContent,
            ),
          })),
        ),
      );
    }
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
