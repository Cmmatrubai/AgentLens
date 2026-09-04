import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";

test("one deliberate assessment update appends one human evidence event", async ({
  page,
  productionUi,
  releaseFixture,
  requestLifecycle
}) => {
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-completed-recovery");
  const before = await releaseFixture.humanAssessmentEventCount("fixture-completed-recovery");
  await page.getByRole("button", { name: "Edit human assessment" }).click();
  await page.getByLabel("Partial").check();
  await page.getByLabel("Uncertain").check();
  await page.getByLabel("Reviewer note (optional)").fill("Synthetic release assessment note");
  const checkpoint = requestLifecycle.checkpoint();
  await page.getByRole("button", { name: "Save assessment" }).click();
  await expect(page.getByRole("button", { name: "Edit human assessment" })).toBeFocused();
  await Promise.all([
    requestLifecycle.waitForTerminal(checkpoint, {
      method: "PUT",
      origin: productionUi.origin,
      pathname: "/api/v1/runs/fixture-completed-recovery/assessment",
      search: ""
    }),
    requestLifecycle.waitForTerminal(checkpoint, {
      method: "GET",
      origin: productionUi.origin,
      pathname: "/api/v1/runs/fixture-completed-recovery",
      search: ""
    }),
    requestLifecycle.waitForTerminal(checkpoint, {
      method: "GET",
      origin: productionUi.origin,
      predicate: (record) => {
        const requested = new URL(record.url);
        return requested.search === "" &&
          /^\/api\/v1\/runs\/fixture-completed-recovery\/events\/[^/]+$/u.test(requested.pathname);
      }
    }),
    requestLifecycle.waitForTerminal(checkpoint, {
      method: "GET",
      origin: productionUi.origin,
      predicate: (record) => {
        const requested = new URL(record.url);
        return requested.pathname === "/api/v1/runs/fixture-completed-recovery/events" &&
          requested.searchParams.get("limit") === "100" &&
          requested.searchParams.has("aroundSequence");
      }
    })
  ]);
  await expect.poll(() => releaseFixture.humanAssessmentEventCount("fixture-completed-recovery"))
    .toBe(before + 1);
});
