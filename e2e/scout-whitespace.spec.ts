import { expect, test } from "@playwright/test";
import { chooseOption, content, goto, loginAsScoutLead } from "./fixtures.js";

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
//
// The write is gated by scout.whitespace_promote (packages/core/src
// /approvals.ts:118), single control — dualControl "never", so the same scout
// lead decides it. The full round trip is: refused, self-approved via
// /approvals, retried.
test("J-P1 a whitespace candidate is validated and given an owner @journey:J-P1 @accept:M5", async ({ page }) => {
  await loginAsScoutLead(page);

  // Seeded, unpromoted candidate with a uniquely-worded description
  // (packages/core/src/seed/scout.ts). whitespaces has no `searchable` columns
  // (apps/api/src/resources.ts:319-322), so `?q=` is rejected with 400 — the
  // full, unfiltered list (well under the default page size of 50) is located
  // by row text instead.
  await goto(page, "/scout/whitespaces");
  const row = page.getByRole("row", { name: /Domestic helper package/ });
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();
  // Client-side <Link> navigation (pushState, no full load) — wait for the URL
  // to change before reading it, or this races the router.
  await page.waitForURL(/\/scout\/whitespaces\/.+/);
  const recordUrl = page.url();
  const whitespaceId = recordUrl.split("/").pop()!;

  // Status renders as a Radix combobox (packages/ui/src/primitives.tsx Select),
  // not a native <select> — selectOption doesn't apply; chooseOption picks it
  // from the keyboard rather than racing the popper (e2e/fixtures.ts).
  await chooseOption(page, "Status", "Validated");
  await page.getByLabel("Owner", { exact: true }).fill("tariq.mansour");
  await page.getByLabel("Promoted", { exact: true }).fill("2026-08-01T09:00");
  // Wait for the POST itself, not just the click: under a full parallel run the
  // action takes longer than an assertion's timeout, and the refusal is only
  // rendered once it lands (React Router posts to "<path>.data").
  await Promise.all([
    page.waitForResponse((res) => res.url() === `${recordUrl}.data` && res.request().method() === "POST"),
    page.getByRole("button", { name: "Save changes" }).click()
  ]);

  // Refused, and said as a queued action rather than an error: record.tsx's
  // shared <Gate> (routes/module.tsx).
  await expect(page.getByRole("status").getByText("Waiting on an approval")).toBeVisible();
  await expect(page.getByRole("status").getByText(/scout\.whitespace_promote/)).toBeVisible();
  await content(page).getByRole("link", { name: "Open the approval queue" }).click();

  // Single control — the same scout lead decides it. The card is headed by the
  // policy read as words with the module dropped (approvals.tsx policyTitle).
  // Scope the region by the
  // subject, in case another scout.whitespace_promote request is pending.
  const request = page
    .getByRole("region", { name: "Whitespace promote" })
    .filter({ hasText: whitespaceId });
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Approved. The action may now proceed.");

  // Retry the same edit; it now goes through.
  await goto(page, recordUrl);
  await chooseOption(page, "Status", "Validated");
  await page.getByLabel("Owner", { exact: true }).fill("tariq.mansour");
  await page.getByLabel("Promoted", { exact: true }).fill("2026-08-01T09:00");
  // .click() only waits for the click event, not the Form's async action and
  // revalidation — wait for the POST itself (React Router posts to "<path>.data").
  await Promise.all([
    page.waitForResponse((res) => res.url() === `${recordUrl}.data` && res.request().method() === "POST"),
    page.getByRole("button", { name: "Save changes" }).click()
  ]);

  await expect(page.locator("dl").getByText("Validated", { exact: true })).toBeVisible();
  await expect(page.locator("dl").getByText("tariq.mansour", { exact: true })).toBeVisible();
});

// The close of J-P1: a promoted whitespace runs as a bounded experiment and
// someone records the call on it (/scout/experiments). The decision is logged
// against the person making it (scout-experiments.tsx "xp.decideHint"), so the
// screen states it as a form, not as a row edit.
test("J-P1 a scout lead records a decision on an experiment @journey:J-P1 @accept:M5", async ({ page }) => {
  await loginAsScoutLead(page);
  await goto(page, "/scout/experiments");

  const table = page.getByRole("table", { name: "Experiments", exact: true });
  const first = table.locator("tbody tr").first();
  await expect(first).toBeVisible();
  // The picker's default is the same first row (defaultValue rows[0].id), so
  // only the decision has to be chosen — and it has to be a decision this
  // experiment is not already sitting on, or the assertion would pass without
  // anything happening.
  const parked = (await first.innerText()).includes("Parked");
  const decision = parked ? "Running" : "Parked";

  // The star is part of the label text Field renders for a required field
  // (packages/ui/src/primitives.tsx), and getByLabel reads label text.
  await chooseOption(page, "Decision*", decision);
  await page.getByRole("button", { name: "Record a decision", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Decision recorded.");
  await expect(table.locator("tbody tr").first()).toContainText(decision);
});
