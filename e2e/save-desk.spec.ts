import { expect, test } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { makeLibsqlDb } from "@lyra/db/libsql";
import type { Ctx } from "@lyra/core";
import { monthKey } from "@lyra/core";
import { sweepRenewals } from "../apps/api/src/engines/renewals.js";
import { LIBSQL_URL, TENANT_SLUG } from "./env.js";
import {
  content,
  goto,
  loginAsAxisLead,
  loginAsFinanceController,
  loginAsOrbitRetention,
  shortRef
} from "./fixtures.js";

// J-X2 "the save desk" (docs/06-roles-and-journeys.md): the acceptance test
// this journey actually has (apps/api/src/journeys.test.ts:644-758) is a pair
// of dual-control refusals — axis.bind above threshold, dist.settlement_run
// always-gated — each resolved by delegating decide-rights to a third party.
// The docs' "churn-risk list ... outcome logged" half now has a real screen
// behind it — apps/web/app/routes/orbit-save.tsx, the save desk at
// /orbit/save: a churn-scored queue, a confirmation-gated offer, and an
// accepted/lost outcome with a reason. The third test below covers it. Only
// the docs' "objection cards" and "bounded price-match" remain unbuilt (no
// re-quote exists — the desk says so itself in its "No offer figures yet"
// notice), so the first two tests stay on the established acceptance test's
// scope: both refusals, end to end through the UI.
// The delegation-then-retry finale is a gap, noted below, not attempted —
// staff.tsx's delegation form has no e2e coverage yet.

// axis.bind, dual control "above_threshold" @ 250_000_00 minor (packages/core
// src/approvals.ts:53): only axis.lead holds axis:policies:create.
test("J-X2 an above-threshold policy is refused for dual control (axis.bind) @journey:J-X2", async ({ page }) => {
  await loginAsAxisLead(page);

  await goto(page, "/axis/policies");
  const policyNo = `J-X2-${Date.now()}`;
  await page.locator("summary", { hasText: "New" }).click();
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
// period = the month the database was seeded in — so this opens that row
// instead of drafting a fresh, entry-less one.
test("J-X2 approving a settlement run is always refused for dual control (dist.settlement_run) @journey:J-X2", async ({
  page
}) => {
  await loginAsFinanceController(page);

  await goto(page, "/ledger/settlement");
  // The draft settlement run is always the seed clock's current month.
  const row = page.getByRole("row", { name: new RegExp(monthKey(Date.now())) }).filter({ hasText: "Draft" });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Open" }).click();

  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.getByRole("status").getByText("Waiting on an approval")).toBeVisible();
  await expect(page.getByRole("status").getByText(/dist\.settlement_run/)).toBeVisible();
  await expect(content(page).getByRole("link", { name: "Open the approval queue" })).toBeVisible();

  // Gap: the delegation round-trip (staff.tsx "Grant a delegation" ->
  // delegate decides dist:commissions:settle -> retry succeeds) is the real
  // finale in journeys.test.ts:688-757, but has no e2e coverage yet — not
  // attempted here.
});

// orbit_renewals is not seeded — the nightly sweep raises those rows from the
// policy book (seed/orbit.ts's header, apps/api/src/engines/renewals.ts), so a
// fresh e2e database has an empty save desk. The other renewal specs
// (renewal-portal, axis-lifecycle, orbit-journeys) all sweep off the
// soonest-expiring policy and then work that one row; this one sweeps off the
// latest-expiring policy instead, so the row it offers on and closes is nobody
// else's, and — the sweep window being the 45 days *after* the instant swept —
// no policy but that one is raised. It sorts last by expiry, where the other
// specs' `.first()` reads cannot reach it.
async function raiseLatestRenewal(): Promise<string> {
  const db = makeLibsqlDb(LIBSQL_URL);
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG));
  if (!tenant) throw new Error(`no tenant with slug ${TENANT_SLUG}`);

  const [latest] = await db
    .select({ id: schema.axisPolicies.id, endAt: schema.axisPolicies.endAt })
    .from(schema.axisPolicies)
    .where(and(eq(schema.axisPolicies.tenantId, tenant.id), eq(schema.axisPolicies.status, "active")))
    .orderBy(desc(schema.axisPolicies.endAt))
    .limit(1);
  if (!latest) throw new Error("no active policy to raise a renewal from");

  // The e2e database is not wiped between local runs (global-setup.ts) and this
  // test closes the row it raises, so without the delete the sweep's per-policy
  // dedupe sees the settled row on a repeat run and raises nothing.
  await db.delete(schema.orbitRenewals).where(eq(schema.orbitRenewals.policyRef, latest.id));

  await sweepRenewals({
    db: db as unknown as Ctx["db"],
    tenantId: tenant.id,
    actor: { kind: "system", id: "e2e-save-desk", tenantId: tenant.id, grants: [] },
    requestId: "e2e-save-desk",
    now: latest.endAt,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  });
  return latest.id;
}

// The docs' J-X2 spine that does exist: churn-risk list -> offer -> outcome
// logged. Every renewal the sweep raises is `auto_requote` or `human` (only a
// consent record makes one do_not_contact), so the raised row is offerable.
test("J-X2 the save desk offers on a churn-risk renewal and logs the outcome @journey:J-X2", async ({ page }) => {
  const policyId = await raiseLatestRenewal();
  await loginAsOrbitRetention(page);
  await goto(page, "/orbit/save");

  // The desk's action buttons carry the policy ref in their accessible name
  // (orbit-save.tsx `${l("offer")}: ${who}`), which is what pins this test to
  // the row it raised while other specs work their own rows in parallel.
  const rowFor = (table: string, action: string) =>
    page
      .getByRole("table", { name: table, exact: true })
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: `${action}: ${policyId}`, exact: true }) });

  const queued = rowFor("Save queue", "Make the offer");
  await expect(queued).toBeVisible();

  // An outbound price promise, so the offer is confirmation-gated.
  await queued.getByRole("button", { name: /^Make the offer:/ }).click();
  await expect(page.getByRole("alert")).toContainText("Tick the confirmation before the offer goes out.");

  await queued.getByRole("checkbox", { name: "I have checked the price and want this to go out" }).check();
  await queued.getByRole("button", { name: /^Make the offer:/ }).click();
  await expect(page.getByRole("status").getByText("Recorded.")).toBeVisible();

  // Offered, so the row has left the queue for the outstanding desk.
  const offered = rowFor("Offers outstanding", "Record the outcome");
  await expect(offered).toBeVisible();
  // The selects default to accepted / saved_discount — the outcome this books.
  await offered.getByRole("button", { name: /^Record the outcome:/ }).click();
  await expect(page.getByRole("status").getByText("Recorded.")).toBeVisible();

  // The settled table has no buttons to pin on, but every desk row prints the
  // policy ref under the customer name (orbit-save.tsx's customer column).
  const settled = page
    .getByRole("table", { name: "Recently settled", exact: true })
    .getByRole("row")
    .filter({ hasText: shortRef(policyId) });
  await expect(settled).toContainText("Renewed");
  await expect(settled).toContainText("Saved with a discount");
});
