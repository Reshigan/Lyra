import { expect, test } from "@playwright/test";
import { goto, loginAsAxisLead, loginAsFinanceController } from "./fixtures.js";

// J-X2 "the save desk" (docs/06-roles-and-journeys.md): the acceptance test
// this journey actually has (apps/api/src/journeys.test.ts:644-758) is a pair
// of dual-control refusals — axis.bind above threshold, dist.settlement_run
// always-gated — each resolved by delegating decide-rights to a third party.
// The docs' "churn-risk list + objection cards + bounded discount" prose has
// no UI behind it (no discount/objection-card affordance anywhere in
// apps/web/app/modules/axis.ts); per CLAUDE.md's TDD rule the test matches the
// established acceptance test's real scope, not the docs' aspirational one.
// This spec covers what is real end to end through the UI: both refusals.
// The delegation-then-retry finale is a gap, noted below, not attempted —
// staff.tsx's delegation form has no e2e coverage yet.

// axis.bind, dual control "above_threshold" @ 250_000_00 minor (packages/core
// src/approvals.ts:53): only axis.lead holds axis:policies:create.
test("J-X2 an above-threshold policy is refused for dual control (axis.bind) @journey:J-X2", async ({ page }) => {
  await loginAsAxisLead(page);

  await goto(page, "/axis/policies");
  const policyNo = `J-X2-${Date.now()}`;
  await page.getByText("New — Policies").click();
  await page.getByLabel("Policy number*", { exact: true }).fill(policyNo);
  await page.getByLabel("Customer*", { exact: true }).fill("cust-jx2");
  await page.getByLabel("Provider*", { exact: true }).fill("prov-jx2");
  await page.getByLabel("Starts*", { exact: true }).fill("2026-08-01");
  await page.getByLabel("Ends*", { exact: true }).fill("2027-08-01");
  // Above the 250,000.00-minor-unit threshold, so this is refused, not raised.
  await page.getByLabel("Premium*", { exact: true }).fill("40000000");
  await page.getByLabel("Currency*", { exact: true }).fill("AED");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // toContainText, not toHaveText: the alert also carries a requestId line
  // (module.tsx's Problem component) alongside the policy key.
  await expect(page.getByRole("alert")).toContainText("axis.bind");
  // Nothing was written: the refused policy number never appears.
  await goto(page, `/axis/policies?q=${encodeURIComponent(policyNo)}`);
  await expect(page.getByRole("row", { name: new RegExp(policyNo) })).toHaveCount(0);
});

// dist.settlement_run, dual control "always" + neverAutoApprove (packages/core
// src/approvals.ts:66). The gate sits on *approving* a settlement
// (apps/api/src/engines/settlement.ts:421), not on drafting one — drafting
// posts to /v1/settlement/runs, a plain engine call with no gate() in it
// (confirmed live: a draft attempt here succeeds and opens the settlement).
// So the refusal is exercised on the drafted settlement's own "Approve"
// button, via settlement-detail.tsx's shared <Gate> notice.
//
// The "Approve" transition only ever renders for a draft with netMinor > 0
// (settlement.tsx transitionsFor: a zero-net period is a no-op the engine
// 409s on, so the UI never offers it). A settlement drafted here through the
// form for a brand-new channel has no commission entries, hence net AED 0.00
// and no Approve button. The seed already carries one non-zero draft —
// packages/core/src/seed/settlement.ts's `stlDraft`, channel brokerAlpha,
// period "2026-01" (the seed clock's `now`, not the real date) — so this
// opens that row instead of drafting a fresh, entry-less one.
test("J-X2 approving a settlement run is always refused for dual control (dist.settlement_run) @journey:J-X2", async ({
  page
}) => {
  await loginAsFinanceController(page);

  await goto(page, "/ledger/settlement");
  const row = page.getByRole("row", { name: /2026-01/ }).filter({ hasText: "Draft" });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Open" }).click();

  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.getByRole("status").getByText("Waiting on an approval")).toBeVisible();
  await expect(page.getByRole("status").getByText(/dist\.settlement_run/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the approval queue" })).toBeVisible();

  // Gap: the delegation round-trip (staff.tsx "Grant a delegation" ->
  // delegate decides dist:commissions:settle -> retry succeeds) is the real
  // finale in journeys.test.ts:688-757, but has no e2e coverage yet — not
  // attempted here.
});
