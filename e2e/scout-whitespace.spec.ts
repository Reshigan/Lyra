import { expect, test } from "@playwright/test";
import { loginAsScoutLead } from "./fixtures.js";

// J-P1 "the pivot" (docs/06-roles-and-journeys.md): a whitespace candidate
// moves toward promotion as evidence firms up. Whitespace has no create (it's
// derived from clusters); the only write is the promote action
// (apps/web/app/modules/scout.ts:199-228: status/owner/promotedAt editable).
//
// Known UI-vs-API gap: the status select only offers
// ["candidate","validating","validated","parked"] (scout.ts:203,224) — it
// never offers "promoted", even though the API accepts that status
// (apps/api/src/journeys.test.ts:966-973). This spec exercises what the UI
// can actually reach — candidate -> validated, with an owner and a promoted
// stamp — and does not fabricate a "promoted" assertion the UI has no path to.
test("J-P1 a whitespace candidate is validated and given an owner", async ({ page }) => {
  await loginAsScoutLead(page);

  // Seeded, unpromoted candidate with a uniquely-worded description
  // (packages/core/src/seed/scout.ts). whitespaces has no `searchable` columns
  // (apps/api/src/resources.ts:319-322), so `?q=` is rejected with 400 — the
  // full, unfiltered list (well under the default page size of 50) is located
  // by row text instead.
  await page.goto("/scout/whitespaces");
  const row = page.getByRole("row", { name: /Domestic helper package/ });
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();

  // Status renders as a Radix combobox (packages/ui/src/primitives.tsx Select),
  // not a native <select> — selectOption doesn't apply.
  // Radix Select's listbox repositions itself after Playwright's pre-click
  // stability check — under CPU contention (parallel workers) the click can
  // land on stale coordinates, register as an outside click, and close the
  // listbox before landing on the option. Retry the open+select as a unit.
  await expect(async () => {
    await page.getByLabel("Status", { exact: true }).click();
    await page.getByRole("option", { name: "Validated", exact: true }).click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.getByLabel("Owner", { exact: true }).fill("tariq.mansour");
  await page.getByLabel("Promoted", { exact: true }).fill("2026-08-01T09:00");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.locator("dl").getByText("Validated", { exact: true })).toBeVisible();
  await expect(page.locator("dl").getByText("tariq.mansour", { exact: true })).toBeVisible();
});
