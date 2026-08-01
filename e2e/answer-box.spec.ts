import { expect, test } from "@playwright/test";
import { loginAsSignalLead } from "./fixtures.js";

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
test("J-M3 an AEO page is authored against a query cluster", async ({ page }) => {
  await loginAsSignalLead(page);

  await page.goto("/signal/aeo-pages");

  const suffix = Date.now();
  const cluster = `car insurance dubai excess ${suffix}`;
  const contentRef = `cms:aeo/excess-explained-${suffix}`;

  await page.getByText("New — Answer pages").click();
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
