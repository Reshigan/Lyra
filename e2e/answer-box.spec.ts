import { expect, test } from "@playwright/test";
import { goto, loginAsSignalLead } from "./fixtures.js";

// J-M3 "own the answer box" (docs/06-roles-and-journeys.md:69): "pick query
// cluster -> AEO content unit -> ...". The acceptance test this journey
// actually has (apps/api/src/journeys.test.ts:895-940) is two unrelated `it`s:
//
//   1. an AEO page is authored against a query cluster (POST
//      /v1/signal/aeo-pages with queryCluster/contentRef/status) — real UI:
//      the aeo-pages resource (apps/web/app/modules/signal.ts:401-427) has a
//      create form (signal:aeo:write, held by signal.lead per
//      packages/core/src/rbac.ts:385) with exactly queryCluster and contentRef
//      as required fields. `status`/`locale` are not on the create form at all
//      (signal.ts:417-421) but both default server-side (packages/db/src/
//      schema/signal.ts:119,124: locale "en", status "draft"), so a plain
//      create reproduces the test's row shape without ever typing a status.
//
//   2. the creative agent is invoked and its suggestion measured (POST
//      /v1/ai/runs, POST /v1/ai/suggestions, POST .../outcome, then GET
//      /v1/ai/suggestions/acceptance as tenant.admin). There is no UI behind
//      any of this: the admin "runs" resource is read-only (no `create` in
//      admin.ts:1303-1345), the "suggestions" resource only allows editing an
//      already-shown row's outcome by hand (admin.ts:1362-1393, no `create`),
//      and nothing renders the acceptance rollup. Ambient suggestions
//      (docs/15) are surfaced and resolved by the runtime itself, not typed in
//      by an operator — so, per CLAUDE.md's TDD rule, this half of the
//      journey has no UI to exercise and is not attempted here.
//
// This spec covers what is real: authoring an AEO page end to end through the
// list's create form and the record it lands on.
test("J-M3 an AEO page is authored against a query cluster @journey:J-M3", async ({ page }) => {
  await loginAsSignalLead(page);

  await goto(page, "/signal/aeo-pages");

  const suffix = Date.now();
  const cluster = `car insurance dubai excess ${suffix}`;
  const contentRef = `cms:aeo/excess-explained-${suffix}`;

  await page.locator("summary", { hasText: "New" }).click();
  await page.getByLabel("Query cluster*", { exact: true }).fill(cluster);
  await page.getByLabel("Content*", { exact: true }).fill(contentRef);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const row = page.getByRole("row", { name: new RegExp(String(suffix)) });
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();
  // Client-side <Link> navigation (pushState, no full load) — wait for the URL
  // to actually change before reading it, or this races the router.
  await page.waitForURL(/\/signal\/aeo-pages\/.+/);

  // Defaulted server-side (schema.aeoPages.status.default("draft")), never
  // typed into the create form — humanise("draft") renders as "Draft".
  await expect(page.locator("dl").getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.locator("dl").getByText(cluster, { exact: true })).toBeVisible();
  await expect(page.locator("dl").getByText(contentRef, { exact: true })).toBeVisible();
});

// The measure half of J-M3, on /signal/answer-engines: citation share is
// derived on the way out (signal.shared.ts aeoCoverage: cited / published,
// rounded), never stored, so what is under test is that the wall agrees with
// its own parts and moves when a page is published.
test("J-M3 publishing an answer page moves the citation-share read @journey:J-M3 @accept:M4", async ({ page }) => {
  await loginAsSignalLead(page);

  const suffix = Date.now();
  const cluster = `motor excess citation share ${suffix}`;
  await goto(page, "/signal/aeo-pages");
  await page.locator("summary", { hasText: "New" }).click();
  await page.getByLabel("Query cluster*", { exact: true }).fill(cluster);
  await page.getByLabel("Content*", { exact: true }).fill(`cms:aeo/share-${suffix}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(String(suffix)) })).toBeVisible();

  await goto(page, "/signal/answer-engines");
  // KPIWall is a plain grid div (packages/ui/src/data.tsx) with no accessible
  // name, so its inline template is what pins these reads to the wall rather
  // than to the table below, where "Published" is also a badge. Stat draws the
  // label span then the value span.
  const wall = page.locator("div[style*='auto-fill']");
  const stat = async (label: string) =>
    Number(
      (await wall.getByText(label, { exact: true }).locator("xpath=following-sibling::span[1]").innerText()).replace(
        /[^0-9]/g,
        ""
      )
    );
  const published = await stat("Published");
  const cited = await stat("Cited");
  expect(await stat("Citation share")).toBe(published === 0 ? 0 : Math.round((cited / published) * 100));

  // The page just authored is a draft nothing has cited, so publishing it adds
  // to the denominator only: the share must fall, not hold.
  const row = page.getByRole("row", { name: new RegExp(String(suffix)) });
  await row.getByRole("button", { name: "Publish", exact: true }).click();
  // The revalidation is done when the move that was just made is no longer
  // offered on that row (StatusControls drops "Publish" once published).
  await expect(row.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  expect(await stat("Published")).toBe(published + 1);
  expect(await stat("Citation share")).toBe(Math.round((cited / (published + 1)) * 100));
});
